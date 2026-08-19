-- Customer rights and contractual acknowledgement controls. These private
-- records are service-only; a signed-in customer reaches them only through a
-- purpose-built Edge Function that verifies their identity.

create table private.legal_acceptances (
  id uuid primary key default extensions.gen_random_uuid(),
  checkout_id uuid not null references private.checkout_attempts(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  document_key text not null,
  document_version text not null,
  accepted_at timestamptz not null default now(),
  constraint legal_acceptances_document_key_valid
    check (document_key in ('terms', 'cancellation')),
  constraint legal_acceptances_document_version_valid
    check (length(trim(document_version)) between 1 and 64),
  constraint legal_acceptances_one_document_per_checkout unique (checkout_id, document_key)
);

create index legal_acceptances_user_id_idx
  on private.legal_acceptances (user_id, accepted_at desc);

create table private.customer_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null,
  enrollment_id uuid references public.enrollments(id) on delete restrict,
  details text,
  status text not null default 'submitted',
  reviewed_by uuid references auth.users(id) on delete set null,
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint customer_requests_kind_valid
    check (kind in ('access', 'correction', 'erasure', 'restriction', 'objection', 'cancellation')),
  constraint customer_requests_status_valid
    check (status in ('submitted', 'in_review', 'awaiting_customer', 'completed', 'declined')),
  constraint customer_requests_details_bounds
    check (details is null or length(trim(details)) between 1 and 1000),
  constraint customer_requests_resolution_bounds
    check (resolution_note is null or length(trim(resolution_note)) between 1 and 1000),
  constraint customer_requests_cancellation_enrollment
    check ((kind = 'cancellation') = (enrollment_id is not null)),
  constraint customer_requests_resolution_status
    check ((status in ('completed', 'declined')) = (resolved_at is not null))
);

create index customer_requests_user_status_idx
  on private.customer_requests (user_id, status, created_at desc);
create index customer_requests_staff_queue_idx
  on private.customer_requests (status, created_at asc);

create table private.customer_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references private.customer_requests(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  prior_status text,
  next_status text,
  occurred_at timestamptz not null default now(),
  constraint customer_request_events_action_valid
    check (action in ('submitted', 'status_updated'))
);

create index customer_request_events_request_idx
  on private.customer_request_events (request_id, occurred_at asc);

-- This registry makes the unresolved retention decision visible and auditable.
-- It intentionally carries no delete rule until counsel approves a category.
create table private.retention_registry (
  data_category text primary key,
  description text not null,
  status text not null default 'pending_counsel',
  retention_days integer,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint retention_registry_status_valid
    check (status in ('pending_counsel', 'approved', 'retired')),
  constraint retention_registry_approved_values
    check ((status = 'approved') = (retention_days is not null and retention_days > 0 and approved_at is not null))
);

insert into private.retention_registry (data_category, description)
values
  ('accounts_profiles', 'Account and profile records'),
  ('bookings_payments', 'Bookings, payment references, invoices, and refund records'),
  ('stripe_webhook_payloads', 'Raw Stripe webhook payloads and processing failures'),
  ('private_workshop_requests', 'Private workshop request records'),
  ('customer_rights_requests', 'Data-subject and cancellation request records'),
  ('email_delivery_records', 'Email delivery and automation records'),
  ('staff_audit_records', 'Staff audit-log records')
on conflict (data_category) do nothing;

alter table private.legal_acceptances enable row level security;
alter table private.customer_requests enable row level security;
alter table private.customer_request_events enable row level security;
alter table private.retention_registry enable row level security;

revoke all on table private.legal_acceptances, private.customer_requests,
  private.customer_request_events, private.retention_registry
  from public, anon, authenticated;
grant all on table private.legal_acceptances, private.customer_requests,
  private.customer_request_events, private.retention_registry
  to service_role;

alter table private.private_workshop_requests
  add constraint private_requests_goals_max_2000
    check (length(trim(goals)) <= 2000) not valid,
  add constraint private_requests_notes_max_1000
    check (notes is null or length(trim(notes)) <= 1000) not valid;

create or replace function public.record_checkout_legal_acceptance(
  p_checkout_id uuid,
  p_user_id uuid,
  p_documents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkout private.checkout_attempts%rowtype;
  v_inserted integer;
begin
  if p_documents is null
     or jsonb_typeof(p_documents) <> 'array'
     or jsonb_array_length(p_documents) <> 2
     or not exists (
       select 1 from jsonb_array_elements(p_documents) item
       where item ->> 'document_key' = 'terms'
         and length(trim(coalesce(item ->> 'document_version', ''))) between 1 and 64
     )
     or not exists (
       select 1 from jsonb_array_elements(p_documents) item
       where item ->> 'document_key' = 'cancellation'
         and length(trim(coalesce(item ->> 'document_version', ''))) between 1 and 64
     ) then
    raise exception using errcode = 'P0001', message = 'legal_documents_invalid';
  end if;

  select * into v_checkout
  from private.checkout_attempts
  where id = p_checkout_id
    and user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'checkout_not_found';
  end if;

  insert into private.legal_acceptances (
    checkout_id, user_id, document_key, document_version
  )
  select
    p_checkout_id,
    p_user_id,
    item ->> 'document_key',
    trim(item ->> 'document_version')
  from jsonb_array_elements(p_documents) item
  on conflict (checkout_id, document_key) do nothing;
  get diagnostics v_inserted = row_count;

  update public.profiles
     set terms_accepted_at = greatest(coalesce(terms_accepted_at, '-infinity'::timestamptz), now()),
         updated_at = now()
   where id = p_user_id;

  if v_inserted > 0 then
    insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
    values (
      p_user_id,
      'legal.checkout_acknowledged',
      'checkout',
      p_checkout_id::text,
      jsonb_build_object('documents', p_documents)
    );
  end if;

  return jsonb_build_object('checkout_id', p_checkout_id, 'recorded_documents', v_inserted);
end;
$$;

revoke execute on function public.record_checkout_legal_acceptance(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_checkout_legal_acceptance(uuid, uuid, jsonb)
  to service_role;

create or replace function public.list_my_customer_requests(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'requests', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'kind', r.kind,
        'status', r.status,
        'enrollment_id', r.enrollment_id,
        'created_at', r.created_at,
        'updated_at', r.updated_at
      ) order by r.created_at desc
    ), '[]'::jsonb)
  )
  from private.customer_requests r
  where r.user_id = p_user_id;
$$;

revoke execute on function public.list_my_customer_requests(uuid)
  from public, anon, authenticated;
grant execute on function public.list_my_customer_requests(uuid)
  to service_role;

create or replace function public.create_customer_request(
  p_user_id uuid,
  p_kind text,
  p_enrollment_id uuid,
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.customer_requests%rowtype;
begin
  if p_kind is null
     or p_kind not in ('access', 'correction', 'erasure', 'restriction', 'objection', 'cancellation')
     or (p_details is not null and length(trim(p_details)) not between 1 and 1000)
     or ((p_kind = 'cancellation') <> (p_enrollment_id is not null)) then
    raise exception using errcode = 'P0001', message = 'invalid_customer_request';
  end if;

  if p_kind = 'cancellation' and not exists (
    select 1 from public.enrollments e
    where e.id = p_enrollment_id and e.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'customer_request_enrollment_not_found';
  end if;

  if exists (
    select 1 from private.customer_requests r
    where r.user_id = p_user_id
      and r.kind = p_kind
      and r.enrollment_id is not distinct from p_enrollment_id
      and r.status in ('submitted', 'in_review', 'awaiting_customer')
      and r.created_at > now() - interval '24 hours'
  ) then
    raise exception using errcode = 'P0001', message = 'customer_request_already_open';
  end if;

  insert into private.customer_requests (user_id, kind, enrollment_id, details)
  values (p_user_id, p_kind, p_enrollment_id, nullif(trim(p_details), ''))
  returning * into v_request;

  insert into private.customer_request_events (request_id, actor_user_id, action, next_status)
  values (v_request.id, p_user_id, 'submitted', v_request.status);
  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_user_id,
    'customer_request.submitted',
    'customer_request',
    v_request.id::text,
    jsonb_build_object('kind', v_request.kind, 'enrollment_id', v_request.enrollment_id)
  );

  return jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_request.id,
      'kind', v_request.kind,
      'status', v_request.status,
      'created_at', v_request.created_at
    )
  );
end;
$$;

revoke execute on function public.create_customer_request(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_customer_request(uuid, text, uuid, text)
  to service_role;

create or replace function public.list_customer_requests_for_staff(p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select role into v_role
  from private.staff_members
  where user_id = p_actor_user_id and status = 'active';
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;

  return jsonb_build_object(
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'kind', r.kind,
        'status', r.status,
        'enrollment_id', r.enrollment_id,
        'details', r.details,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'resolved_at', r.resolved_at,
        'resolution_note', r.resolution_note
      ) order by r.created_at asc)
      from private.customer_requests r
      where v_role = 'owner' or r.kind = 'cancellation'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.list_customer_requests_for_staff(uuid)
  from public, anon, authenticated;
grant execute on function public.list_customer_requests_for_staff(uuid)
  to service_role;

create or replace function public.update_customer_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_status text,
  p_resolution_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_request private.customer_requests%rowtype;
  v_prior_status text;
begin
  select role into v_role
  from private.staff_members
  where user_id = p_actor_user_id and status = 'active';
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;
  if p_status is null
     or p_status not in ('submitted', 'in_review', 'awaiting_customer', 'completed', 'declined')
     or (p_resolution_note is not null and length(trim(p_resolution_note)) not between 1 and 1000) then
    raise exception using errcode = 'P0001', message = 'invalid_customer_request_update';
  end if;

  select * into v_request
  from private.customer_requests
  where id = p_request_id
  for update;
  if not found or (v_role <> 'owner' and v_request.kind <> 'cancellation') then
    raise exception using errcode = 'P0001', message = 'customer_request_not_found';
  end if;
  v_prior_status := v_request.status;

  update private.customer_requests
     set status = p_status,
         reviewed_by = p_actor_user_id,
         resolution_note = nullif(trim(p_resolution_note), ''),
         resolved_at = case when p_status in ('completed', 'declined') then now() else null end,
         updated_at = now()
   where id = v_request.id
   returning * into v_request;

  insert into private.customer_request_events (
    request_id, actor_user_id, action, prior_status, next_status
  ) values (
    v_request.id, p_actor_user_id, 'status_updated',
    v_prior_status, v_request.status
  );
  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'customer_request.status_updated',
    'customer_request',
    v_request.id::text,
    jsonb_build_object('status', v_request.status)
  );

  return jsonb_build_object('request', jsonb_build_object(
    'id', v_request.id,
    'kind', v_request.kind,
    'status', v_request.status,
    'updated_at', v_request.updated_at,
    'resolved_at', v_request.resolved_at
  ));
end;
$$;

revoke execute on function public.update_customer_request(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_customer_request(uuid, uuid, text, text)
  to service_role;

create or replace function public.retention_review_status(p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;
  return jsonb_build_object(
    'pending_categories', coalesce((
      select jsonb_agg(data_category order by data_category)
      from private.retention_registry
      where status = 'pending_counsel'
    ), '[]'::jsonb),
    'approved_categories', coalesce((
      select jsonb_agg(jsonb_build_object('data_category', data_category, 'retention_days', retention_days) order by data_category)
      from private.retention_registry
      where status = 'approved'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.retention_review_status(uuid)
  from public, anon, authenticated;
grant execute on function public.retention_review_status(uuid)
  to service_role;

-- Keep the original short-lived fingerprint/rate-limit behavior, but remove
-- operational analytics writes and stop sending free-text goals in email.
create or replace function public.submit_private_workshop_request(
  p_payload jsonb,
  p_request_fingerprint text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.private_workshop_requests%rowtype;
  v_email text := lower(trim(coalesce(p_payload ->> 'email', '')));
begin
  if length(v_email) < 4
     or length(trim(coalesce(p_payload ->> 'contact_name', ''))) < 2
     or length(trim(coalesce(p_payload ->> 'organization', ''))) < 2
     or length(trim(coalesce(p_payload ->> 'goals', ''))) not between 10 and 2000
     or length(trim(coalesce(p_payload ->> 'notes', ''))) > 1000
     or coalesce((p_payload ->> 'consent_to_contact')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'invalid_private_workshop_request';
  end if;

  if p_request_fingerprint is not null then
    if p_request_fingerprint !~ '^[a-f0-9]{64}$' then
      raise exception using errcode = 'P0001', message = 'invalid_request_fingerprint';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_fingerprint, 0));
    delete from private.private_request_rate_limits
    where request_fingerprint = p_request_fingerprint
      and created_at <= now() - interval '24 hours';
    if (
      select count(*) from private.private_request_rate_limits r
      where r.request_fingerprint = p_request_fingerprint
        and r.created_at > now() - interval '1 hour'
    ) >= 5 then
      raise exception using errcode = 'P0001', message = 'request_rate_limited';
    end if;
    insert into private.private_request_rate_limits (request_fingerprint)
    values (p_request_fingerprint);
  end if;

  insert into private.private_workshop_requests (
    contact_name, email, phone, organization, attendee_count, preferred_format,
    preferred_timing, goals, notes, consent_to_contact
  ) values (
    trim(p_payload ->> 'contact_name'), v_email,
    nullif(trim(p_payload ->> 'phone'), ''), trim(p_payload ->> 'organization'),
    nullif(p_payload ->> 'attendee_count', '')::integer,
    nullif(p_payload ->> 'preferred_format', ''),
    nullif(trim(p_payload ->> 'preferred_timing'), ''), trim(p_payload ->> 'goals'),
    nullif(trim(p_payload ->> 'notes'), ''), (p_payload ->> 'consent_to_contact')::boolean
  ) returning * into v_request;

  perform private.enqueue_job(
    'email',
    jsonb_build_object(
      'template', 'private_request_received', 'to', v_request.email,
      'contact_name', v_request.contact_name, 'organization', v_request.organization,
      'request_id', v_request.id
    ),
    'private-request-received:' || v_request.id::text
  );
  perform private.enqueue_job(
    'email',
    jsonb_build_object(
      'template', 'private_request_admin_alert', 'to_role', 'workspace_admin',
      'contact_name', v_request.contact_name, 'email', v_request.email,
      'organization', v_request.organization, 'attendee_count', v_request.attendee_count,
      'preferred_format', v_request.preferred_format, 'request_id', v_request.id
    ),
    'private-request-admin:' || v_request.id::text
  );

  return jsonb_build_object(
    'request_id', v_request.id, 'status', v_request.status, 'received_at', v_request.created_at
  );
end;
$$;

revoke execute on function public.submit_private_workshop_request(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.submit_private_workshop_request(jsonb, text)
  to service_role;
