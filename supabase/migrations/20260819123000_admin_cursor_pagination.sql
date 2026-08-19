-- Detail views are served through the Edge Function with its service client, so
-- this RPC repeats the active-staff/role check and returns only the fields each
-- workspace view needs. A timestamp + primary-key cursor (serialized as text)
-- is stable across rows that share a timestamp and avoids growing OFFSET scans.
create or replace function public.list_staff_page(
  p_actor_user_id uuid,
  p_resource text,
  p_cursor_at timestamptz default null,
  p_cursor_id text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_result jsonb;
  v_limit integer;
begin
  select sm.role into v_role
  from private.staff_members sm
  where sm.user_id = p_actor_user_id
    and sm.status = 'active';

  if v_role is null then
    raise exception using errcode = 'P0001', message = 'staff_access_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'staff_page_limit_invalid';
  end if;
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = 'P0001', message = 'staff_page_cursor_invalid';
  end if;
  v_limit := p_limit;

  case p_resource
    when 'enrollments' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      with page as (
        select e.id, e.session_id, e.attendee_email, e.attendee_name, e.status,
          e.amount_cents, e.currency, e.booked_at, e.confirmed_at,
          c.title as course_title, s.start_at, s.timezone, e.booked_at as cursor_at
        from public.enrollments e
        join public.workshop_sessions s on s.id = e.session_id
        join public.courses c on c.id = s.course_id
        where p_cursor_at is null
          or (e.booked_at, e.id) < (p_cursor_at, p_cursor_id::uuid)
        order by e.booked_at desc, e.id desc
        limit v_limit + 1
      ), visible as (
        select * from page
        order by cursor_at desc, id desc
        limit v_limit
      )
      select jsonb_build_object(
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', visible.id,
            'session_id', visible.session_id,
            'attendee_email', visible.attendee_email,
            'attendee_name', visible.attendee_name,
            'status', visible.status,
            'amount_cents', visible.amount_cents,
            'currency', visible.currency,
            'booked_at', visible.booked_at,
            'confirmed_at', visible.confirmed_at,
            'course_title', visible.course_title,
            'start_at', visible.start_at,
            'timezone', visible.timezone
          ) order by visible.cursor_at desc, visible.id desc)
          from visible
        ), '[]'::jsonb),
        'next_cursor', case when (select count(*) from page) > v_limit then (
          select jsonb_build_object('at', cursor_at, 'id', id::text)
          from visible order by cursor_at asc, id asc limit 1
        ) else null end
      ) into v_result;

    when 'waitlist' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      with ranked as (
        select w.id, w.session_id, w.email, w.full_name, w.status,
          w.joined_at, w.offered_at, w.offer_expires_at, w.accepted_at,
          c.slug as course_slug, c.title as course_title,
          s.start_at as session_start_at, s.timezone as session_timezone,
          case when w.status in ('waiting', 'offered') then (
            select count(*)::integer
            from public.waitlist_entries preceding
            where preceding.session_id = w.session_id
              and preceding.status in ('waiting', 'offered')
              and (preceding.joined_at, preceding.id) <= (w.joined_at, w.id)
          ) else null end as position,
          w.joined_at as cursor_at
        from public.waitlist_entries w
        join public.workshop_sessions s on s.id = w.session_id
        join public.courses c on c.id = s.course_id
      ), page as (
        select * from ranked
        where p_cursor_at is null
          or (joined_at, id) < (p_cursor_at, p_cursor_id::uuid)
        order by joined_at desc, id desc
        limit v_limit + 1
      ), visible as (
        select * from page
        order by cursor_at desc, id desc
        limit v_limit
      )
      select jsonb_build_object(
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', visible.id,
            'session_id', visible.session_id,
            'email', visible.email,
            'full_name', visible.full_name,
            'status', visible.status,
            'joined_at', visible.joined_at,
            'offered_at', visible.offered_at,
            'offer_expires_at', visible.offer_expires_at,
            'accepted_at', visible.accepted_at,
            'position', visible.position,
            'course_slug', visible.course_slug,
            'course_title', visible.course_title,
            'session_start_at', visible.session_start_at,
            'session_timezone', visible.session_timezone
          ) order by visible.cursor_at desc, visible.id desc)
          from visible
        ), '[]'::jsonb),
        'next_cursor', case when (select count(*) from page) > v_limit then (
          select jsonb_build_object('at', cursor_at, 'id', id::text)
          from visible order by cursor_at asc, id asc limit 1
        ) else null end
      ) into v_result;

    when 'private_requests' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      with page as (
        select r.id, r.contact_name, r.email, r.organization, r.attendee_count,
          r.preferred_format, r.preferred_timing, r.goals, r.status,
          r.created_at, r.updated_at, r.created_at as cursor_at
        from private.private_workshop_requests r
        where p_cursor_at is null
          or (r.created_at, r.id) < (p_cursor_at, p_cursor_id::uuid)
        order by r.created_at desc, r.id desc
        limit v_limit + 1
      ), visible as (
        select * from page
        order by cursor_at desc, id desc
        limit v_limit
      )
      select jsonb_build_object(
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', visible.id,
              'contact_name', visible.contact_name,
              'email', visible.email,
              'organization', visible.organization,
              'attendee_count', visible.attendee_count,
              'preferred_format', visible.preferred_format,
              'preferred_timing', visible.preferred_timing,
              'goals', visible.goals,
              'status', visible.status,
              'created_at', visible.created_at,
              'updated_at', visible.updated_at,
              'quotes', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', q.id,
                  'request_id', q.request_id,
                  'amount_cents', q.amount_cents,
                  'currency', q.currency,
                  'vat_inclusive', q.vat_inclusive,
                  'description', q.description,
                  'valid_until', q.valid_until,
                  'status', q.status,
                  'sent_at', q.sent_at,
                  'accepted_at', q.accepted_at,
                  'created_at', q.created_at
                ) order by q.created_at desc, q.id desc)
                from (
                  select q.id, q.request_id, q.amount_cents, q.currency,
                    q.vat_inclusive, q.description, q.valid_until, q.status,
                    q.sent_at, q.accepted_at, q.created_at
                  from private.private_workshop_quotes q
                  where q.request_id = visible.id
                  order by q.created_at desc, q.id desc
                  limit 20
                ) q
              ), '[]'::jsonb),
              'quote_count', (
                select count(*) from private.private_workshop_quotes quote_count
                where quote_count.request_id = visible.id
              ),
              'quotes_truncated', (
                select count(*) > 20 from private.private_workshop_quotes quote_count
                where quote_count.request_id = visible.id
              )
            )
            order by visible.cursor_at desc, visible.id desc
          ) from visible
        ), '[]'::jsonb),
        'next_cursor', case when (select count(*) from page) > v_limit then (
          select jsonb_build_object('at', cursor_at, 'id', id::text)
          from visible order by cursor_at asc, id asc limit 1
        ) else null end
      ) into v_result;

    when 'customer_requests' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      with page as (
        select r.id, r.kind, r.status, r.enrollment_id, r.details,
          r.created_at, r.updated_at, r.resolved_at, r.resolution_note,
          r.created_at as cursor_at
        from private.customer_requests r
        where (v_role = 'owner' or r.kind = 'cancellation')
          and (p_cursor_at is null or (r.created_at, r.id) < (p_cursor_at, p_cursor_id::uuid))
        order by r.created_at desc, r.id desc
        limit v_limit + 1
      ), visible as (
        select * from page
        order by cursor_at desc, id desc
        limit v_limit
      )
      select jsonb_build_object(
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', visible.id,
            'kind', visible.kind,
            'status', visible.status,
            'enrollment_id', visible.enrollment_id,
            'details', visible.details,
            'created_at', visible.created_at,
            'updated_at', visible.updated_at,
            'resolved_at', visible.resolved_at,
            'resolution_note', visible.resolution_note
          ) order by visible.cursor_at desc, visible.id desc)
          from visible
        ), '[]'::jsonb),
        'next_cursor', case when (select count(*) from page) > v_limit then (
          select jsonb_build_object('at', cursor_at, 'id', id::text)
          from visible order by cursor_at asc, id asc limit 1
        ) else null end
      ) into v_result;

    when 'audit' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      with page as (
        select a.id, a.actor_user_id, a.action, a.target_type, a.target_id,
          a.occurred_at, a.occurred_at as cursor_at
        from private.audit_logs a
        where p_cursor_at is null
          or (a.occurred_at, a.id) < (p_cursor_at, p_cursor_id::bigint)
        order by a.occurred_at desc, a.id desc
        limit v_limit + 1
      ), visible as (
        select * from page
        order by cursor_at desc, id desc
        limit v_limit
      )
      select jsonb_build_object(
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', visible.id::text,
            'actor_user_id', visible.actor_user_id,
            'action', visible.action,
            'target_type', visible.target_type,
            'target_id', visible.target_id,
            'occurred_at', visible.occurred_at
          ) order by visible.cursor_at desc, visible.id desc)
          from visible
        ), '[]'::jsonb),
        'next_cursor', case when (select count(*) from page) > v_limit then (
          select jsonb_build_object('at', cursor_at, 'id', id::text)
          from visible order by cursor_at asc, id asc limit 1
        ) else null end
      ) into v_result;

    when 'automation' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      with page as (
        select j.id, j.job_type, j.status, j.attempts, j.max_attempts,
          j.available_at, j.last_error, j.created_at, j.completed_at,
          ed.status as email_delivery_status, j.created_at as cursor_at
        from private.automation_jobs j
        left join private.email_deliveries ed on ed.automation_job_id = j.id
        where p_cursor_at is null
          or (j.created_at, j.id) < (p_cursor_at, p_cursor_id::uuid)
        order by j.created_at desc, j.id desc
        limit v_limit + 1
      ), visible as (
        select * from page
        order by cursor_at desc, id desc
        limit v_limit
      )
      select jsonb_build_object(
        'items', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', visible.id,
              'job_type', visible.job_type,
              'status', visible.status,
              'attempts', visible.attempts,
              'max_attempts', visible.max_attempts,
              'available_at', visible.available_at,
              'last_error', visible.last_error,
              'created_at', visible.created_at,
              'completed_at', visible.completed_at,
              'email_delivery_status', visible.email_delivery_status,
              'requires_reconciliation', visible.email_delivery_status = 'uncertain'
            )
            order by visible.cursor_at desc, visible.id desc
          ) from visible
        ), '[]'::jsonb),
        'next_cursor', case when (select count(*) from page) > v_limit then (
          select jsonb_build_object('at', cursor_at, 'id', id::text)
          from visible order by cursor_at asc, id asc limit 1
        ) else null end
      ) into v_result;

    else
      raise exception using errcode = 'P0001', message = 'staff_page_resource_invalid';
  end case;

  return coalesce(v_result, jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null));
end;
$$;

revoke execute on function public.list_staff_page(uuid, text, timestamptz, text, integer)
  from public, anon, authenticated;
grant execute on function public.list_staff_page(uuid, text, timestamptz, text, integer)
  to service_role;

-- Quote history is loaded separately from the bounded private-request summary.
-- It repeats the staff-role check because the Edge Function uses its service
-- client, and it emits only the fields the workspace needs to review or send
-- a quote (never a customer ID or checkout-token verifier).
create or replace function public.list_private_request_quotes_page(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_result jsonb;
  v_limit integer;
begin
  select sm.role into v_role
  from private.staff_members sm
  where sm.user_id = p_actor_user_id
    and sm.status = 'active';

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'private_request_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'private_request_quotes_page_limit_invalid';
  end if;
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = 'P0001', message = 'private_request_quotes_page_cursor_invalid';
  end if;
  v_limit := p_limit;

  with page as (
    select q.id, q.request_id, q.amount_cents, q.currency, q.vat_inclusive,
      q.description, q.valid_until, q.status, q.sent_at, q.accepted_at,
      q.created_at, q.created_at as cursor_at
    from private.private_workshop_quotes q
    where q.request_id = p_request_id
      and (
        p_cursor_at is null
        or (q.created_at, q.id) < (p_cursor_at, p_cursor_id)
      )
    order by q.created_at desc, q.id desc
    limit v_limit + 1
  ), visible as (
    select * from page
    order by cursor_at desc, id desc
    limit v_limit
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', visible.id,
        'request_id', visible.request_id,
        'amount_cents', visible.amount_cents,
        'currency', visible.currency,
        'vat_inclusive', visible.vat_inclusive,
        'description', visible.description,
        'valid_until', visible.valid_until,
        'status', visible.status,
        'sent_at', visible.sent_at,
        'accepted_at', visible.accepted_at,
        'created_at', visible.created_at
      ) order by visible.cursor_at desc, visible.id desc)
      from visible
    ), '[]'::jsonb),
    'next_cursor', case when (select count(*) from page) > v_limit then (
      select jsonb_build_object('at', cursor_at, 'id', id)
      from visible
      order by cursor_at asc, id asc
      limit 1
    ) else null end
  ) into v_result;

  return coalesce(v_result, jsonb_build_object('items', '[]'::jsonb, 'next_cursor', null));
end;
$$;

revoke execute on function public.list_private_request_quotes_page(uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_private_request_quotes_page(uuid, uuid, timestamptz, uuid, integer)
  to service_role;

-- These match the timestamp + primary-key predicates above. Existing indexes
-- support lifecycle-specific operations but not the staff workspace's global
-- keyset ordering.
create index if not exists enrollments_staff_page_idx
  on public.enrollments (booked_at desc, id desc);
create index if not exists waitlist_entries_staff_page_idx
  on public.waitlist_entries (joined_at desc, id desc);
create index if not exists waitlist_entries_active_position_idx
  on public.waitlist_entries (session_id, joined_at, id)
  where status in ('waiting', 'offered');
create index if not exists private_requests_staff_page_idx
  on private.private_workshop_requests (created_at desc, id desc);
create index if not exists private_quotes_request_page_idx
  on private.private_workshop_quotes (request_id, created_at desc, id desc);
create index if not exists customer_requests_staff_page_idx
  on private.customer_requests (created_at desc, id desc);
create index if not exists customer_requests_cancellation_staff_page_idx
  on private.customer_requests (created_at desc, id desc)
  where kind = 'cancellation';
create index if not exists audit_logs_staff_page_idx
  on private.audit_logs (occurred_at desc, id desc);
create index if not exists automation_jobs_staff_page_idx
  on private.automation_jobs (created_at desc, id desc);
