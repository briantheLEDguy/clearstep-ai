-- Admin controls for managed Stripe price changes and deliberate automation
-- cancellation/reruns. All functions are service-only and repeat the staff
-- authorization check inside the database boundary.

alter table private.email_deliveries
  drop constraint email_deliveries_status_valid,
  add constraint email_deliveries_status_valid check (
    status in ('sending', 'sent', 'uncertain', 'retrying', 'failed', 'cancelled')
  );

create or replace function public.get_course_pricing_for_update(
  p_actor_user_id uuid,
  p_course_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course public.courses%rowtype;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner', 'admin']) then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;

  select * into v_course
  from public.courses
  where id = p_course_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'course_not_found';
  end if;

  return jsonb_build_object(
    'id', v_course.id,
    'slug', v_course.slug,
    'title', v_course.title,
    'price_cents', v_course.price_cents,
    'currency', v_course.currency,
    'stripe_product_id', v_course.stripe_product_id,
    'stripe_price_id', v_course.stripe_price_id
  );
end;
$$;

revoke execute on function public.get_course_pricing_for_update(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_course_pricing_for_update(uuid, uuid)
  to service_role;

create or replace function public.update_course_price(
  p_actor_user_id uuid,
  p_course_id uuid,
  p_price_cents integer,
  p_stripe_price_id text,
  p_expected_price_cents integer,
  p_expected_stripe_price_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course public.courses%rowtype;
  v_previous_price_cents integer;
  v_previous_stripe_price_id text;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner', 'admin']) then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;
  if p_price_cents < 1 then
    raise exception using errcode = 'P0001', message = 'course_price_invalid';
  end if;
  if p_stripe_price_id !~ '^price_[A-Za-z0-9]+$' then
    raise exception using errcode = 'P0001', message = 'stripe_price_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clearstep.course-price.' || p_course_id::text, 0)
  );

  select * into v_course
  from public.courses
  where id = p_course_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'course_not_found';
  end if;
  if v_course.stripe_product_id is null then
    raise exception using errcode = 'P0001', message = 'course_stripe_product_required';
  end if;
  if v_course.price_cents is distinct from p_expected_price_cents
     or v_course.stripe_price_id is distinct from p_expected_stripe_price_id then
    raise exception using errcode = 'P0001', message = 'course_price_changed';
  end if;

  v_previous_price_cents := v_course.price_cents;
  v_previous_stripe_price_id := v_course.stripe_price_id;

  update public.courses
     set price_cents = p_price_cents,
         stripe_price_id = p_stripe_price_id,
         updated_at = now()
   where id = p_course_id
  returning * into v_course;

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'course.price_updated',
    'course',
    p_course_id::text,
    jsonb_build_object(
      'previous_price_cents', v_previous_price_cents,
      'price_cents', v_course.price_cents,
      'previous_stripe_price_id', v_previous_stripe_price_id,
      'stripe_price_id', v_course.stripe_price_id
    )
  );

  return jsonb_build_object('course', to_jsonb(v_course));
end;
$$;

revoke execute on function public.update_course_price(uuid, uuid, integer, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.update_course_price(uuid, uuid, integer, text, integer, text)
  to service_role;

create or replace function public.cancel_automation_job(
  p_actor_user_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;

  select * into v_job
  from private.automation_jobs
  where id = p_job_id and status = 'pending'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_not_cancellable';
  end if;
  if v_job.pgmq_message_id is null
     or not pgmq.archive('clearstep_automation', v_job.pgmq_message_id) then
    raise exception using errcode = 'P0001', message = 'automation_queue_archive_failed';
  end if;

  update private.automation_jobs
     set status = 'cancelled',
         payload = case
           when job_type = 'email' then private.redact_automation_payload(payload)
           else payload
         end,
         locked_at = null,
         locked_by = null,
         last_error = 'cancelled_by_owner',
         completed_at = now(),
         updated_at = now()
   where id = v_job.id;

  update private.email_deliveries
     set status = 'cancelled',
         last_error = 'cancelled_by_owner',
         updated_at = now()
   where automation_job_id = v_job.id
     and status not in ('sent', 'cancelled');

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'automation.job_cancelled',
    'automation_job',
    v_job.id::text,
    jsonb_build_object('job_type', v_job.job_type, 'prior_status', v_job.status)
  );

  return jsonb_build_object('job_id', v_job.id, 'status', 'cancelled');
end;
$$;

revoke execute on function public.cancel_automation_job(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_automation_job(uuid, uuid)
  to service_role;

create or replace function public.rerun_non_email_automation_job(
  p_actor_user_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_message_id bigint;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;

  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and status in ('failed', 'completed', 'cancelled')
    and job_type <> 'email'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_not_rerunnable';
  end if;

  select * into v_message_id
  from pgmq.send(
    queue_name => 'clearstep_automation',
    msg => jsonb_build_object('job_id', v_job.id, 'job_type', v_job.job_type),
    delay => 0
  );

  update private.automation_jobs
     set status = 'pending',
         attempts = 0,
         available_at = now(),
         locked_at = null,
         locked_by = null,
         last_error = null,
         output = null,
         pgmq_message_id = v_message_id,
         completed_at = null,
         updated_at = now()
   where id = v_job.id;

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'automation.job_rerun',
    'automation_job',
    v_job.id::text,
    jsonb_build_object('job_type', v_job.job_type, 'prior_status', v_job.status)
  );

  return jsonb_build_object('job_id', v_job.id, 'status', 'pending');
end;
$$;

revoke execute on function public.rerun_non_email_automation_job(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.rerun_non_email_automation_job(uuid, uuid)
  to service_role;
