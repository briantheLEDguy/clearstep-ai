create or replace function private.enqueue_job(
  p_job_type text,
  p_payload jsonb,
  p_dedupe_key text default null,
  p_available_at timestamptz default now()
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_message_id bigint;
  v_delay_seconds integer;
begin
  insert into private.automation_jobs (job_type, payload, dedupe_key, available_at)
  values (p_job_type, p_payload, p_dedupe_key, p_available_at)
  on conflict (dedupe_key) do nothing
  returning id into v_job_id;

  if v_job_id is null and p_dedupe_key is not null then
    select id into v_job_id
    from private.automation_jobs
    where dedupe_key = p_dedupe_key
    for update;
  end if;

  perform 1
  from private.automation_jobs
  where id = v_job_id
  for update;

  if v_job_id is not null and not exists (
    select 1
    from private.automation_jobs
    where id = v_job_id and pgmq_message_id is not null
  ) then
    v_delay_seconds := greatest(
      0,
      ceil(extract(epoch from (p_available_at - now())))::integer
    );

    select * into v_message_id
    from pgmq.send(
      queue_name => 'clearstep_automation',
      msg => jsonb_build_object('job_id', v_job_id, 'job_type', p_job_type),
      delay => v_delay_seconds
    );

    update private.automation_jobs
       set pgmq_message_id = v_message_id, updated_at = now()
     where id = v_job_id and pgmq_message_id is null;
  end if;

  return v_job_id;
end;
$$;

revoke execute on function private.enqueue_job(text, jsonb, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.staff_has_role(
  p_user_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.staff_members sm
    where sm.user_id = p_user_id
      and sm.status = 'active'
      and (p_roles is null or sm.role = any(p_roles))
  );
$$;

revoke execute on function private.staff_has_role(uuid, text[])
  from public, anon, authenticated, service_role;

create or replace function public.create_checkout_hold(
  p_session_id uuid,
  p_user_id uuid,
  p_email text,
  p_offer_token_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_hold private.seat_holds%rowtype;
  v_checkout private.checkout_attempts%rowtype;
  v_waitlist public.waitlist_entries%rowtype;
  v_offer private.waitlist_offers%rowtype;
  v_used integer;
  v_hold_expires_at timestamptz;
  v_booking_deadline_at timestamptz;
  v_source text := 'standard';
begin
  if p_user_id is null or p_email is null or length(trim(p_email)) < 4 then
    raise exception using errcode = 'P0001', message = 'invalid_customer';
  end if;

  select
    s.id,
    s.capacity,
    s.status,
    s.start_at,
    s.end_at,
    s.timezone,
    s.format,
    s.venue,
    c.id as course_id,
    c.title as course_title,
    c.price_cents,
    c.currency,
    c.stripe_product_id,
    c.stripe_price_id,
    c.status as course_status
  into v_session
  from public.workshop_sessions s
  join public.courses c on c.id = s.course_id
  where s.id = p_session_id
  for update of s;

  if not found or v_session.status not in ('scheduled', 'sold_out')
     or v_session.course_status <> 'published' or v_session.start_at <= now() then
    raise exception using errcode = 'P0001', message = 'session_not_bookable';
  end if;

  if v_session.stripe_product_id is null or v_session.stripe_price_id is null then
    raise exception using errcode = 'P0001', message = 'stripe_price_not_configured';
  end if;

  v_booking_deadline_at := v_session.start_at - interval '32 minutes';

  if not private.session_calendar_ready(p_session_id) then
    raise exception using errcode = 'P0001', message = 'session_calendar_not_provisioned';
  end if;

  if exists (
    select 1
    from public.enrollments e
    where e.session_id = p_session_id
      and e.user_id = p_user_id
      and e.status in ('pending_payment', 'confirmed')
  ) then
    raise exception using errcode = 'P0001', message = 'already_enrolled';
  end if;

  update private.checkout_attempts
     set status = 'expired', updated_at = now()
   where session_id = p_session_id
     and user_id = p_user_id
     and (
       (status = 'creating' and expires_at <= now())
       or (status = 'open' and grace_expires_at <= now())
     );

  select ca.*
  into v_checkout
  from private.checkout_attempts ca
  where ca.session_id = p_session_id
    and ca.user_id = p_user_id
    and ca.status in ('creating', 'open', 'payment_pending')
  order by ca.created_at desc
  limit 1
  for update;

  if found then
    select h.*
    into v_hold
    from private.seat_holds h
    where h.id = v_checkout.hold_id;

    return jsonb_build_object(
      'reused', true,
      'checkout_id', v_checkout.id,
      'checkout_status', v_checkout.status,
      'stripe_checkout_session_id', v_checkout.stripe_checkout_session_id,
      'hold_id', v_checkout.hold_id,
      'hold_expires_at', v_checkout.expires_at,
      'checkout_expires_at', v_checkout.expires_at,
      'booking_deadline_at', v_booking_deadline_at,
      'source', v_hold.source,
      'course_id', v_session.course_id,
      'course_title', v_session.course_title,
      'session_id', v_session.id,
      'start_at', v_session.start_at,
      'end_at', v_session.end_at,
      'timezone', v_session.timezone,
      'format', v_session.format,
      'venue', v_session.venue,
      'amount_cents', v_checkout.amount_cents,
      'currency', v_checkout.currency,
      'stripe_product_id', v_session.stripe_product_id,
      'stripe_price_id', v_session.stripe_price_id
    );
  end if;

  if now() >= v_booking_deadline_at then
    raise exception using errcode = 'P0001', message = 'session_booking_closed';
  end if;

  update private.seat_holds
     set status = 'expired', updated_at = now()
   where session_id = p_session_id
     and status = 'active'
     and expires_at <= now();

  select w.*
  into v_waitlist
  from public.waitlist_entries w
  where w.session_id = p_session_id
    and w.user_id = p_user_id
    and w.status = 'offered'
    and w.offer_expires_at > now()
  for update;

  if found then
    select o.*
    into v_offer
    from private.waitlist_offers o
    where o.waitlist_entry_id = v_waitlist.id
      and o.status = 'active'
      and o.expires_at > now()
    order by o.created_at desc
    limit 1;

    if not found or p_offer_token_hash is null or v_offer.token_hash <> p_offer_token_hash then
      raise exception using errcode = 'P0001', message = 'invalid_waitlist_offer';
    end if;

    v_source := 'waitlist';
  else
    if exists (
      select 1
      from public.waitlist_entries w
      where w.session_id = p_session_id
        and w.status = 'waiting'
    ) then
      raise exception using errcode = 'P0001', message = 'waitlist_priority';
    end if;
  end if;

  -- Stripe requires at least a 30-minute Checkout lifetime. New creation closes
  -- 32 minutes before start, leaving a one-minute network cushion while still
  -- ensuring the Checkout itself expires before the workshop begins.
  v_hold_expires_at := least(
    now() + interval '31 minutes',
    v_session.start_at - interval '1 minute',
    case
      when v_source = 'waitlist' then v_offer.expires_at
      else 'infinity'::timestamptz
    end
  );

  if v_hold_expires_at <= now() + interval '30 minutes' then
    raise exception using errcode = 'P0001', message = 'waitlist_offer_expiring';
  end if;

  v_used := private.session_occupied_seats(p_session_id, p_user_id);

  if v_used >= v_session.capacity then
    update public.workshop_sessions
       set status = 'sold_out', updated_at = now()
     where id = p_session_id and status = 'scheduled';
    raise exception using errcode = 'P0001', message = 'session_full';
  end if;

  insert into private.seat_holds (
    session_id,
    user_id,
    waitlist_entry_id,
    source,
    status,
    expires_at
  )
  values (
    p_session_id,
    p_user_id,
    case when v_source = 'waitlist' then v_waitlist.id else null end,
    v_source,
    'active',
    v_hold_expires_at
  )
  on conflict (session_id, user_id) do update
    set waitlist_entry_id = excluded.waitlist_entry_id,
        source = excluded.source,
        status = 'active',
        expires_at = excluded.expires_at,
        updated_at = now()
  returning * into v_hold;

  insert into private.checkout_attempts (
    hold_id,
    session_id,
    user_id,
    customer_email,
    amount_cents,
    currency,
    expires_at,
    grace_expires_at
  )
  values (
    v_hold.id,
    p_session_id,
    p_user_id,
    lower(trim(p_email)),
    v_session.price_cents,
    v_session.currency,
    v_hold.expires_at,
    least(v_hold.expires_at + interval '15 minutes', v_session.start_at)
  )
  returning * into v_checkout;

  insert into private.analytics_events (
    event_name, user_id, page_path, properties, occurred_at
  ) values (
    'checkout_started',
    p_user_id,
    '/checkout',
    jsonb_build_object('session_id', p_session_id, 'course_id', v_session.course_id),
    now()
  );

  return jsonb_build_object(
    'reused', false,
    'checkout_id', v_checkout.id,
    'hold_id', v_hold.id,
    'hold_expires_at', v_hold.expires_at,
    'checkout_expires_at', v_checkout.expires_at,
    'booking_deadline_at', v_booking_deadline_at,
    'source', v_hold.source,
    'course_id', v_session.course_id,
    'course_title', v_session.course_title,
    'session_id', v_session.id,
    'start_at', v_session.start_at,
    'end_at', v_session.end_at,
    'timezone', v_session.timezone,
    'format', v_session.format,
    'venue', v_session.venue,
    'amount_cents', v_session.price_cents,
    'currency', v_session.currency,
    'stripe_product_id', v_session.stripe_product_id,
    'stripe_price_id', v_session.stripe_price_id
  );
end;
$$;

revoke execute on function public.create_checkout_hold(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_checkout_hold(uuid, uuid, text, text)
  to service_role;

create or replace function public.attach_stripe_checkout(
  p_checkout_id uuid,
  p_user_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_customer_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkout private.checkout_attempts%rowtype;
begin
  update private.checkout_attempts
     set stripe_checkout_session_id = p_stripe_checkout_session_id,
         stripe_customer_id = p_stripe_customer_id,
         status = 'open',
         updated_at = now()
   where id = p_checkout_id
     and user_id = p_user_id
     and status = 'creating'
     and expires_at > now()
  returning * into v_checkout;

  if not found then
    raise exception using errcode = 'P0001', message = 'checkout_attempt_not_attachable';
  end if;

  return jsonb_build_object(
    'checkout_id', v_checkout.id,
    'stripe_checkout_session_id', v_checkout.stripe_checkout_session_id,
    'expires_at', v_checkout.expires_at
  );
end;
$$;

revoke execute on function public.attach_stripe_checkout(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_stripe_checkout(uuid, uuid, text, text)
  to service_role;

create or replace function public.fail_checkout_attempt(
  p_checkout_id uuid,
  p_user_id uuid,
  p_reason text default null,
  p_expected_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkout private.checkout_attempts%rowtype;
begin
  update private.checkout_attempts
     set status = 'failed', updated_at = now()
   where id = p_checkout_id
     and user_id = p_user_id
     and status in ('creating', 'open')
     and (p_expected_status is null or status = p_expected_status)
  returning * into v_checkout;

  if v_checkout.id is not null then
    update private.seat_holds
       set status = 'released', updated_at = now()
     where id = v_checkout.hold_id and status = 'active';
  else
    select ca.*
    into v_checkout
    from private.checkout_attempts ca
    where ca.id = p_checkout_id
      and ca.user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'released', v_checkout.status = 'failed',
    'checkout_status', v_checkout.status,
    'stripe_checkout_session_id', v_checkout.stripe_checkout_session_id,
    'reason', left(p_reason, 200)
  );
end;
$$;

revoke execute on function public.fail_checkout_attempt(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_checkout_attempt(uuid, uuid, text, text)
  to service_role;

create or replace function public.join_session_waitlist(
  p_session_id uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_entry public.waitlist_entries%rowtype;
  v_used integer;
  v_position integer;
begin
  select s.id, s.capacity, s.status, s.start_at, c.title as course_title, c.status as course_status
  into v_session
  from public.workshop_sessions s
  join public.courses c on c.id = s.course_id
  where s.id = p_session_id
  for update of s;

  if not found or v_session.status not in ('scheduled', 'sold_out')
     or v_session.course_status <> 'published'
     or v_session.start_at <= now() + interval '63 minutes' then
    raise exception using errcode = 'P0001', message = 'session_not_waitlistable';
  end if;

  if not private.session_calendar_ready(p_session_id) then
    raise exception using errcode = 'P0001', message = 'session_calendar_not_provisioned';
  end if;

  if exists (
    select 1 from public.enrollments
    where session_id = p_session_id and user_id = p_user_id
      and status in ('pending_payment', 'confirmed')
  ) then
    raise exception using errcode = 'P0001', message = 'already_enrolled';
  end if;

  update private.seat_holds
     set status = 'expired', updated_at = now()
   where session_id = p_session_id and status = 'active' and expires_at <= now();

  v_used := private.session_occupied_seats(p_session_id);

  if v_used < v_session.capacity then
    raise exception using errcode = 'P0001', message = 'seats_available';
  end if;

  insert into public.waitlist_entries (
    session_id, user_id, email, full_name, status, joined_at, offered_at, offer_expires_at
  ) values (
    p_session_id, p_user_id, lower(trim(p_email)), nullif(trim(p_full_name), ''), 'waiting', now(), null, null
  )
  on conflict (session_id, user_id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.waitlist_entries.full_name),
        status = case
          when public.waitlist_entries.status = 'offered' then public.waitlist_entries.status
          else 'waiting'
        end,
        joined_at = case
          when public.waitlist_entries.status in ('accepted', 'expired', 'removed') then now()
          else public.waitlist_entries.joined_at
        end,
        offered_at = case
          when public.waitlist_entries.status = 'offered' then public.waitlist_entries.offered_at
          else null
        end,
        offer_expires_at = case
          when public.waitlist_entries.status = 'offered' then public.waitlist_entries.offer_expires_at
          else null
        end,
        accepted_at = case
          when public.waitlist_entries.status = 'offered' then public.waitlist_entries.accepted_at
          else null
        end,
        updated_at = now()
  returning * into v_entry;

  select count(*)::integer
  into v_position
  from public.waitlist_entries w
  where w.session_id = p_session_id
    and w.status = 'waiting'
    and (w.joined_at, w.id) <= (v_entry.joined_at, v_entry.id);

  perform private.enqueue_job(
    'email',
    jsonb_build_object(
      'template', 'waitlist_joined',
      'to', v_entry.email,
      'full_name', v_entry.full_name,
      'course_title', v_session.course_title,
      'session_id', p_session_id,
      'position', v_position
    ),
    'waitlist-joined:' || v_entry.id::text || ':' ||
      extract(epoch from v_entry.joined_at)::numeric::text
  );

  insert into private.analytics_events (
    event_name, user_id, page_path, properties, occurred_at
  ) values (
    'waitlist_joined',
    p_user_id,
    '/workshops',
    jsonb_build_object('session_id', p_session_id, 'position', v_position),
    now()
  );

  return jsonb_build_object(
    'waitlist_entry_id', v_entry.id,
    'status', v_entry.status,
    'position', v_position
  );
end;
$$;

revoke execute on function public.join_session_waitlist(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.join_session_waitlist(uuid, uuid, text, text)
  to service_role;

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
     or length(trim(coalesce(p_payload ->> 'goals', ''))) < 10
     or coalesce((p_payload ->> 'consent_to_contact')::boolean, false) is not true then
    raise exception using errcode = 'P0001', message = 'invalid_private_workshop_request';
  end if;

  if p_request_fingerprint is not null then
    if p_request_fingerprint !~ '^[a-f0-9]{64}$' then
      raise exception using errcode = 'P0001', message = 'invalid_request_fingerprint';
    end if;

    -- Serialize each short-lived abuse bucket so concurrent submissions cannot
    -- step past the limit. This hash is never linked to the customer record.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_request_fingerprint, 0)
    );

    delete from private.private_request_rate_limits
    where request_fingerprint = p_request_fingerprint
      and created_at <= now() - interval '24 hours';

    if (
      select count(*)
      from private.private_request_rate_limits r
      where r.request_fingerprint = p_request_fingerprint
        and r.created_at > now() - interval '1 hour'
    ) >= 5 then
      raise exception using errcode = 'P0001', message = 'request_rate_limited';
    end if;

    insert into private.private_request_rate_limits (request_fingerprint)
    values (p_request_fingerprint);
  end if;

  insert into private.private_workshop_requests (
    contact_name,
    email,
    phone,
    organization,
    attendee_count,
    preferred_format,
    preferred_timing,
    goals,
    notes,
    consent_to_contact
  ) values (
    trim(p_payload ->> 'contact_name'),
    v_email,
    nullif(trim(p_payload ->> 'phone'), ''),
    trim(p_payload ->> 'organization'),
    nullif(p_payload ->> 'attendee_count', '')::integer,
    nullif(p_payload ->> 'preferred_format', ''),
    nullif(trim(p_payload ->> 'preferred_timing'), ''),
    trim(p_payload ->> 'goals'),
    nullif(trim(p_payload ->> 'notes'), ''),
    (p_payload ->> 'consent_to_contact')::boolean
  )
  returning * into v_request;

  insert into private.analytics_events (
    event_name, page_path, properties, occurred_at
  ) values (
    'private_request_submitted',
    '/private-workshops',
    jsonb_build_object(
      'preferred_format', v_request.preferred_format,
      'attendee_count', v_request.attendee_count
    ),
    now()
  );

  perform private.enqueue_job(
    'email',
    jsonb_build_object(
      'template', 'private_request_received',
      'to', v_request.email,
      'contact_name', v_request.contact_name,
      'organization', v_request.organization,
      'request_id', v_request.id
    ),
    'private-request-received:' || v_request.id::text
  );

  perform private.enqueue_job(
    'email',
    jsonb_build_object(
      'template', 'private_request_admin_alert',
      'to_role', 'workspace_admin',
      'contact_name', v_request.contact_name,
      'email', v_request.email,
      'organization', v_request.organization,
      'attendee_count', v_request.attendee_count,
      'preferred_format', v_request.preferred_format,
      'goals', v_request.goals,
      'request_id', v_request.id
    ),
    'private-request-admin:' || v_request.id::text
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'status', v_request.status,
    'received_at', v_request.created_at
  );
end;
$$;

revoke execute on function public.submit_private_workshop_request(jsonb, text)
  from public, anon, authenticated;
grant execute on function public.submit_private_workshop_request(jsonb, text)
  to service_role;

create or replace function public.resolve_private_quote_checkout(
  p_token_hash text,
  p_user_id uuid,
  p_user_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote private.private_workshop_quotes%rowtype;
  v_slug text;
begin
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id
      and lower(u.email) = lower(trim(p_user_email))
      and u.email_confirmed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'verified_email_required';
  end if;

  select q.* into v_quote
  from private.private_workshop_quotes q
  join private.private_workshop_requests r on r.id = q.request_id
  where q.checkout_token_hash = p_token_hash
    and q.status = 'sent'
    and q.checkout_expires_at > now()
    and q.valid_until >= current_date
    and lower(r.email::text) = lower(trim(p_user_email))
    and (q.customer_user_id is null or q.customer_user_id = p_user_id)
  for update of q;

  if not found then
    raise exception using errcode = 'P0001', message = 'private_quote_invalid_or_expired';
  end if;

  update private.private_workshop_quotes
     set customer_user_id = p_user_id, updated_at = now()
   where id = v_quote.id;

  select c.slug into v_slug
  from public.courses c
  where c.id = v_quote.course_id
    and c.visibility = 'private'
    and c.status = 'published';

  if v_slug is null or v_quote.session_id is null then
    raise exception using errcode = 'P0001', message = 'private_quote_not_payable';
  end if;

  if not private.session_calendar_ready(v_quote.session_id) then
    raise exception using errcode = 'P0001', message = 'session_calendar_not_provisioned';
  end if;

  return jsonb_build_object(
    'quote_id', v_quote.id,
    'session_id', v_quote.session_id,
    'workshop_slug', v_slug,
    'checkout_expires_at', v_quote.checkout_expires_at
  );
end;
$$;

revoke execute on function public.resolve_private_quote_checkout(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_private_quote_checkout(text, uuid, text)
  to service_role;

create or replace function public.process_stripe_event(
  p_stripe_event_id text,
  p_event_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_object jsonb := p_payload #> '{data,object}';
  v_checkout private.checkout_attempts%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_payment private.payment_records%rowtype;
  v_session record;
  v_target_status text;
  v_was_confirmed boolean := false;
  v_event_status text := 'processed';
  v_payment_intent_id text;
  v_refund_email text;
  v_course_title text;
  v_refund_session_id uuid;
  v_charge_amount integer;
  v_refunded_amount integer;
  v_occupied_other integer;
  v_requires_refund boolean := false;
  v_post_start_conflict boolean := false;
  v_remediation_reason text;
begin
  insert into private.stripe_webhook_events (stripe_event_id, event_type, payload)
  values (p_stripe_event_id, p_event_type, p_payload)
  on conflict (stripe_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('duplicate', true, 'event_id', p_stripe_event_id);
  end if;

  if p_event_type not in (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired',
    'charge.refunded'
  ) then
    update private.stripe_webhook_events
       set status = 'ignored', processed_at = now()
     where id = v_event_id;
    return jsonb_build_object('duplicate', false, 'ignored', true, 'event_id', p_stripe_event_id);
  end if;

  if p_event_type = 'charge.refunded' then
    v_payment_intent_id := nullif(v_object ->> 'payment_intent', '');
    v_charge_amount := coalesce(nullif(v_object ->> 'amount', '')::integer, 0);
    v_refunded_amount := coalesce(nullif(v_object ->> 'amount_refunded', '')::integer, 0);

    if v_payment_intent_id is null
       or v_charge_amount <= 0
       or v_refunded_amount <= 0
       or v_refunded_amount > v_charge_amount
       or upper(coalesce(v_object ->> 'currency', '')) <> 'EUR' then
      update private.stripe_webhook_events
         set status = 'ignored', error_message = 'invalid_refund_payload', processed_at = now()
       where id = v_event_id;
      return jsonb_build_object(
        'duplicate', false,
        'ignored', true,
        'reason', 'invalid_refund_payload',
        'event_id', p_stripe_event_id
      );
    end if;

    select ca.*
    into v_checkout
    from private.checkout_attempts ca
    where ca.stripe_payment_intent_id = v_payment_intent_id
       or ca.id::text = v_object #>> '{metadata,checkout_id}'
    order by ca.created_at desc
    limit 1
    for update;

    select e.*
    into v_enrollment
    from public.enrollments e
    where e.stripe_payment_intent_id = v_payment_intent_id
       or (
         v_checkout.id is not null
         and e.session_id = v_checkout.session_id
         and e.user_id = v_checkout.user_id
       )
    order by e.created_at desc
    limit 1
    for update;

    if v_checkout.id is null
       and v_enrollment.id is null
       and not exists (
         select 1
         from private.payment_records pr
         where pr.stripe_payment_intent_id = v_payment_intent_id
       ) then
      insert into private.audit_logs (action, target_type, target_id, metadata)
      values (
        'stripe.unmatched_refund_ignored',
        'stripe_event',
        p_stripe_event_id,
        jsonb_build_object(
          'stripe_payment_intent_id', v_payment_intent_id,
          'stripe_charge_id', v_object ->> 'id'
        )
      );

      update private.stripe_webhook_events
         set status = 'ignored', error_message = 'clearstep_payment_not_found', processed_at = now()
       where id = v_event_id;

      return jsonb_build_object(
        'duplicate', false,
        'ignored', true,
        'reason', 'clearstep_payment_not_found',
        'event_id', p_stripe_event_id
      );
    end if;

    insert into private.payment_records (
      checkout_attempt_id,
      enrollment_id,
      stripe_payment_intent_id,
      stripe_checkout_session_id,
      stripe_charge_id,
      amount_cents,
      amount_refunded_cents,
      currency,
      status,
      last_stripe_event_id,
      paid_at,
      refunded_at
    ) values (
      v_checkout.id,
      v_enrollment.id,
      v_payment_intent_id,
      v_checkout.stripe_checkout_session_id,
      v_object ->> 'id',
      v_charge_amount,
      v_refunded_amount,
      'EUR',
      case when v_refunded_amount >= v_charge_amount then 'refunded' else 'partially_refunded' end,
      p_stripe_event_id,
      coalesce(v_enrollment.confirmed_at, now()),
      now()
    )
    on conflict (stripe_payment_intent_id) do update
      set checkout_attempt_id = coalesce(excluded.checkout_attempt_id, private.payment_records.checkout_attempt_id),
          enrollment_id = coalesce(excluded.enrollment_id, private.payment_records.enrollment_id),
          stripe_checkout_session_id = coalesce(excluded.stripe_checkout_session_id, private.payment_records.stripe_checkout_session_id),
          stripe_charge_id = coalesce(excluded.stripe_charge_id, private.payment_records.stripe_charge_id),
          amount_cents = greatest(private.payment_records.amount_cents, excluded.amount_cents),
          amount_refunded_cents = greatest(private.payment_records.amount_refunded_cents, excluded.amount_refunded_cents),
          status = case
            when greatest(private.payment_records.amount_refunded_cents, excluded.amount_refunded_cents)
                 >= greatest(private.payment_records.amount_cents, excluded.amount_cents)
              then 'refunded'
            else 'partially_refunded'
          end,
          last_stripe_event_id = excluded.last_stripe_event_id,
          paid_at = coalesce(private.payment_records.paid_at, excluded.paid_at),
          refunded_at = coalesce(private.payment_records.refunded_at, excluded.refunded_at),
          updated_at = now()
    returning * into v_payment;

    if v_enrollment.id is null and v_payment.enrollment_id is not null then
      select e.* into v_enrollment
      from public.enrollments e
      where e.id = v_payment.enrollment_id
      for update;
    end if;

    if v_payment.status = 'refunded'
       and v_enrollment.id is not null
       and v_enrollment.stripe_payment_intent_id = v_payment_intent_id then
      update public.enrollments
         set status = 'refunded', updated_at = now()
       where id = v_enrollment.id
      returning * into v_enrollment;

      if v_checkout.hold_id is not null then
        update private.seat_holds
           set status = 'released', updated_at = now()
         where id = v_checkout.hold_id and status in ('active', 'converted');
      end if;

      -- A fully refunded waitlist enrollment ends that queue lifecycle. Keep
      -- the unique row for history, but make a later join start at the FIFO tail
      -- with fresh notification and offer timestamps.
      update public.waitlist_entries
         set status = 'removed',
             offered_at = null,
             offer_expires_at = null,
             accepted_at = null,
             updated_at = now()
       where session_id = v_enrollment.session_id
         and user_id = v_enrollment.user_id
         and status = 'accepted';

      perform private.enqueue_job(
        'calendar_enrollment_remove',
        jsonb_build_object(
          'enrollment_id', v_enrollment.id,
          'session_id', v_enrollment.session_id,
          'attendee_email', v_enrollment.attendee_email,
          'attendee_name', v_enrollment.attendee_name,
          'payment_id', v_payment.id,
          'stripe_payment_intent_id', v_payment_intent_id,
          'amount_refunded_cents', v_payment.amount_refunded_cents
        ),
        'calendar-enrollment-remove:' || v_enrollment.id::text || ':' || v_payment.id::text
      );
    end if;

    if not exists (
      select 1
      from private.checkout_attempts remediation_checkout
      left join private.payment_records remediation_payment
        on remediation_payment.checkout_attempt_id = remediation_checkout.id
      where remediation_checkout.status = 'paid_unallocated'
        and (
          remediation_payment.id is null
          or remediation_payment.status <> 'refunded'
        )
    ) then
      perform public.record_integration_health(
        'stripe_refund_remediation',
        true,
        null,
        jsonb_build_object(
          'resolved_by_event_id', p_stripe_event_id,
          'stripe_payment_intent_id', v_payment_intent_id
        )
      );
    end if;

    if v_enrollment.id is not null then
      v_refund_email := v_enrollment.attendee_email::text;
      v_refund_session_id := v_enrollment.session_id;
    elsif v_checkout.id is not null then
      v_refund_email := v_checkout.customer_email::text;
      v_refund_session_id := v_checkout.session_id;
    end if;

    if v_refund_session_id is not null then
      select c.title into v_course_title
      from public.workshop_sessions s
      join public.courses c on c.id = s.course_id
      where s.id = v_refund_session_id;
    end if;

    insert into private.audit_logs (action, target_type, target_id, metadata)
    values (
      'stripe.refund_recorded',
      'payment',
      v_payment.id::text,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'stripe_payment_intent_id', v_payment_intent_id,
        'amount_refunded_cents', v_payment.amount_refunded_cents,
        'amount_cents', v_payment.amount_cents,
        'status', v_payment.status,
        'enrollment_id', v_enrollment.id
      )
    );

    insert into private.analytics_events (
      event_name, user_id, page_path, properties, occurred_at
    ) values (
      'refund_processed',
      v_enrollment.user_id,
      '/operations/stripe',
      jsonb_build_object(
        'session_id', v_refund_session_id,
        'payment_id', v_payment.id,
        'amount_refunded_cents', v_payment.amount_refunded_cents,
        'currency', v_payment.currency,
        'status', v_payment.status
      ),
      now()
    );

    if v_refund_email is not null then
      perform private.enqueue_job(
        'email',
        jsonb_build_object(
          'template', 'refund_processed',
          'to', v_refund_email,
          'course_title', v_course_title,
          'amount_refunded_cents', v_payment.amount_refunded_cents,
          'currency', v_payment.currency,
          'refund_status', v_payment.status
        ),
        'refund-customer:' || v_payment.id::text || ':' || v_payment.amount_refunded_cents::text
      );
    end if;

    perform private.enqueue_job(
      'email',
      jsonb_build_object(
        'template', 'refund_admin_alert',
        'to_role', 'workspace_admin',
        'customer_email', v_refund_email,
        'course_title', v_course_title,
        'amount_refunded_cents', v_payment.amount_refunded_cents,
        'currency', v_payment.currency,
        'refund_status', v_payment.status,
        'stripe_payment_intent_id', v_payment_intent_id
      ),
      'refund-admin:' || v_payment.id::text || ':' || v_payment.amount_refunded_cents::text
    );

    update private.stripe_webhook_events
       set status = 'processed', processed_at = now()
     where id = v_event_id;

    return jsonb_build_object(
      'duplicate', false,
      'processed', true,
      'event_id', p_stripe_event_id,
      'payment_id', v_payment.id,
      'enrollment_id', v_enrollment.id,
      'refund_status', v_payment.status,
      'amount_refunded_cents', v_payment.amount_refunded_cents
    );
  end if;

  select ca.*
  into v_checkout
  from private.checkout_attempts ca
  where ca.stripe_checkout_session_id = v_object ->> 'id'
     or ca.id::text = v_object #>> '{metadata,checkout_id}'
  order by ca.created_at desc
  limit 1
  for update;

  if not found then
    update private.stripe_webhook_events
       set status = 'ignored',
           error_message = 'checkout_not_found',
           processed_at = now()
     where id = v_event_id;
    return jsonb_build_object('duplicate', false, 'ignored', true, 'reason', 'checkout_not_found');
  end if;

  select
    s.*,
    c.title as course_title,
    c.id as course_id
  into v_session
  from public.workshop_sessions s
  join public.courses c on c.id = s.course_id
  where s.id = v_checkout.session_id
  for update of s;

  -- Stripe may deliver an unpaid `completed` event after an async failure or
  -- expiry. That stale event must not reopen the terminal checkout, recreate a
  -- pending enrollment, or consume a seat. A genuinely paid completion and the
  -- later async success event still take the normal allocation path.
  if p_event_type = 'checkout.session.completed'
     and coalesce(v_object ->> 'payment_status', 'unpaid') <> 'paid'
     and (
       v_checkout.status in ('failed', 'expired')
       or exists (
         select 1
         from private.payment_records terminal_payment
         where terminal_payment.checkout_attempt_id = v_checkout.id
           and terminal_payment.status = 'failed'
       )
     ) then
    update private.stripe_webhook_events
       set status = 'ignored',
           error_message = 'stale_unpaid_terminal_checkout',
           processed_at = now()
     where id = v_event_id;

    return jsonb_build_object(
      'duplicate', false,
      'ignored', true,
      'reason', 'stale_unpaid_terminal_checkout',
      'checkout_id', v_checkout.id,
      'event_id', p_stripe_event_id
    );
  end if;

  if p_event_type in (
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded'
  ) and (
    nullif(v_object ->> 'amount_total', '') is null
    or (v_object ->> 'amount_total')::integer <> v_checkout.amount_cents
    or upper(coalesce(v_object ->> 'currency', '')) <> v_checkout.currency
  ) then
    v_payment_intent_id := nullif(v_object ->> 'payment_intent', '');
    v_charge_amount := greatest(coalesce(nullif(v_object ->> 'amount_total', '')::integer, 0), 1);

    if v_payment_intent_id is not null then
      insert into private.payment_records (
        checkout_attempt_id,
        stripe_payment_intent_id,
        stripe_checkout_session_id,
        amount_cents,
        currency,
        status,
        last_stripe_event_id
      ) values (
        v_checkout.id,
        v_payment_intent_id,
        v_checkout.stripe_checkout_session_id,
        v_charge_amount,
        v_checkout.currency,
        'mismatch',
        p_stripe_event_id
      )
      on conflict (stripe_payment_intent_id) do update
        set checkout_attempt_id = excluded.checkout_attempt_id,
            stripe_checkout_session_id = excluded.stripe_checkout_session_id,
            status = 'mismatch',
            last_stripe_event_id = excluded.last_stripe_event_id,
            updated_at = now();
    end if;

    update private.checkout_attempts
       set status = 'failed', updated_at = now()
     where id = v_checkout.id;

    update private.seat_holds
       set status = 'released', updated_at = now()
     where id = v_checkout.hold_id and status = 'active';

    insert into private.audit_logs (action, target_type, target_id, metadata)
    values (
      'stripe.amount_mismatch',
      'checkout',
      v_checkout.id::text,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'stripe_payment_intent_id', v_payment_intent_id,
        'expected_amount_cents', v_checkout.amount_cents,
        'received_amount_cents', nullif(v_object ->> 'amount_total', '')::integer,
        'expected_currency', v_checkout.currency,
        'received_currency', upper(coalesce(v_object ->> 'currency', ''))
      )
    );

    insert into private.analytics_events (
      event_name, user_id, page_path, properties, occurred_at
    ) values (
      'payment_mismatch',
      v_checkout.user_id,
      '/operations/stripe',
      jsonb_build_object(
        'session_id', v_checkout.session_id,
        'checkout_id', v_checkout.id,
        'expected_amount_cents', v_checkout.amount_cents,
        'received_amount_cents', nullif(v_object ->> 'amount_total', '')::integer
      ),
      now()
    );

    perform private.enqueue_job(
      'email',
      jsonb_build_object(
        'template', 'payment_mismatch_admin',
        'to_role', 'workspace_admin',
        'customer_email', v_checkout.customer_email,
        'course_title', v_session.course_title,
        'expected_amount_cents', v_checkout.amount_cents,
        'received_amount_cents', nullif(v_object ->> 'amount_total', '')::integer,
        'expected_currency', v_checkout.currency,
        'received_currency', upper(coalesce(v_object ->> 'currency', '')),
        'stripe_payment_intent_id', v_payment_intent_id
      ),
      'payment-mismatch:' || v_checkout.id::text
    );

    update private.stripe_webhook_events
       set status = 'failed', error_message = 'checkout_amount_or_currency_mismatch', processed_at = now()
     where id = v_event_id;

    return jsonb_build_object(
      'duplicate', false,
      'processed', false,
      'amount_mismatch', true,
      'event_id', p_stripe_event_id,
      'checkout_id', v_checkout.id
    );
  end if;

  update private.checkout_attempts
     set stripe_payment_intent_id = coalesce(nullif(v_object ->> 'payment_intent', ''), stripe_payment_intent_id),
         stripe_customer_id = coalesce(nullif(v_object ->> 'customer', ''), stripe_customer_id),
         updated_at = now()
   where id = v_checkout.id;

  if p_event_type in ('checkout.session.async_payment_failed', 'checkout.session.expired') then
    if v_checkout.status in ('paid', 'paid_unallocated') then
      update private.stripe_webhook_events
         set status = 'ignored',
             error_message = 'checkout_already_payment_terminal',
             processed_at = now()
       where id = v_event_id;
      return jsonb_build_object(
        'duplicate', false,
        'ignored', true,
        'reason', 'checkout_already_payment_terminal',
        'checkout_id', v_checkout.id
      );
    end if;

    update private.checkout_attempts
       set status = case when p_event_type = 'checkout.session.expired' then 'expired' else 'failed' end,
           updated_at = now()
     where id = v_checkout.id;

    update private.seat_holds
       set status = 'released', updated_at = now()
     where id = v_checkout.hold_id and status in ('active', 'converted');

    update public.enrollments
       set status = 'cancelled', cancelled_at = now(), updated_at = now()
     where session_id = v_checkout.session_id
       and user_id = v_checkout.user_id
       and status = 'pending_payment';

    update public.waitlist_entries w
       set status = 'expired', offer_expires_at = now(), updated_at = now()
      from private.seat_holds h
     where h.id = v_checkout.hold_id
       and w.id = h.waitlist_entry_id
       and w.status = 'offered';

    v_payment_intent_id := coalesce(
      nullif(v_object ->> 'payment_intent', ''),
      v_checkout.stripe_payment_intent_id
    );
    if v_payment_intent_id is not null then
      insert into private.payment_records (
        checkout_attempt_id,
        stripe_payment_intent_id,
        stripe_checkout_session_id,
        amount_cents,
        currency,
        status,
        last_stripe_event_id
      ) values (
        v_checkout.id,
        v_payment_intent_id,
        v_checkout.stripe_checkout_session_id,
        v_checkout.amount_cents,
        v_checkout.currency,
        'failed',
        p_stripe_event_id
      )
      on conflict (stripe_payment_intent_id) do update
        set status = case
              when private.payment_records.status in ('paid', 'mismatch', 'requires_refund', 'partially_refunded', 'refunded')
                then private.payment_records.status
              else 'failed'
            end,
            last_stripe_event_id = excluded.last_stripe_event_id,
            updated_at = now();
    end if;

    perform private.enqueue_job(
      'email',
      jsonb_build_object(
        'template', 'payment_failed',
        'to', v_checkout.customer_email,
        'course_title', v_session.course_title,
        'session_id', v_session.id
      ),
      'payment-failed:' || v_checkout.id::text
    );
  else
    v_target_status := case
      when p_event_type = 'checkout.session.async_payment_succeeded'
        or v_object ->> 'payment_status' = 'paid' then 'confirmed'
      else 'pending_payment'
    end;

    select exists (
      select 1 from public.enrollments e
      where e.session_id = v_checkout.session_id
        and e.user_id = v_checkout.user_id
        and e.status = 'confirmed'
    ) into v_was_confirmed;

    v_payment_intent_id := coalesce(
      nullif(v_object ->> 'payment_intent', ''),
      v_checkout.stripe_payment_intent_id
    );
    v_occupied_other := private.session_occupied_seats(
      v_checkout.session_id,
      v_checkout.user_id
    );
    v_post_start_conflict := v_session.start_at <= now();

    -- The session row is locked above. This is the final allocation check for
    -- webhooks that arrive after both the Stripe expiry and local seat grace,
    -- or after the workshop itself has begun.
    if not v_was_confirmed and (
      v_post_start_conflict or v_occupied_other >= v_session.capacity
    ) then
      v_remediation_reason := case
        when v_post_start_conflict and v_target_status = 'confirmed'
          then 'post_start_payment_settlement'
        when v_post_start_conflict
          then 'post_start_pending_payment'
        when v_target_status = 'confirmed'
          then 'late_payment_capacity_conflict'
        else 'pending_payment_capacity_conflict'
      end;

      if v_payment_intent_id is not null then
        insert into private.payment_records (
          checkout_attempt_id,
          enrollment_id,
          stripe_payment_intent_id,
          stripe_checkout_session_id,
          amount_cents,
          amount_refunded_cents,
          currency,
          status,
          last_stripe_event_id,
          paid_at
        ) values (
          v_checkout.id,
          null,
          v_payment_intent_id,
          v_checkout.stripe_checkout_session_id,
          v_checkout.amount_cents,
          0,
          v_checkout.currency,
          case when v_target_status = 'confirmed' then 'requires_refund' else 'pending' end,
          p_stripe_event_id,
          case when v_target_status = 'confirmed' then now() else null end
        )
        on conflict (stripe_payment_intent_id) do update
          set checkout_attempt_id = excluded.checkout_attempt_id,
              enrollment_id = null,
              stripe_checkout_session_id = excluded.stripe_checkout_session_id,
              amount_cents = greatest(private.payment_records.amount_cents, excluded.amount_cents),
              currency = excluded.currency,
              status = case
                when private.payment_records.status in ('paid', 'mismatch', 'requires_refund', 'partially_refunded', 'refunded')
                  then private.payment_records.status
                else excluded.status
              end,
              last_stripe_event_id = excluded.last_stripe_event_id,
              paid_at = coalesce(private.payment_records.paid_at, excluded.paid_at),
              updated_at = now()
        returning * into v_payment;
      end if;

      v_requires_refund := v_target_status = 'confirmed'
        and (v_payment.id is null or v_payment.status <> 'refunded');

      update private.checkout_attempts
         set status = case when v_target_status = 'confirmed' then 'paid_unallocated' else 'failed' end,
             updated_at = now()
       where id = v_checkout.id;

      update private.seat_holds
         set status = 'released', updated_at = now()
       where id = v_checkout.hold_id and status in ('active', 'converted');

      update public.enrollments
         set status = 'cancelled', cancelled_at = now(), updated_at = now()
       where session_id = v_checkout.session_id
         and user_id = v_checkout.user_id
         and status = 'pending_payment';

      update public.waitlist_entries w
         set status = 'expired', offer_expires_at = now(), updated_at = now()
        from private.seat_holds h
       where h.id = v_checkout.hold_id
         and w.id = h.waitlist_entry_id
         and w.status = 'offered';

      update public.workshop_sessions
         set status = 'sold_out', updated_at = now()
       where id = v_checkout.session_id
         and status = 'scheduled'
         and v_occupied_other >= v_session.capacity;

      insert into private.audit_logs (action, target_type, target_id, metadata)
      values (
        'stripe.' || v_remediation_reason,
        'checkout',
        v_checkout.id::text,
        jsonb_build_object(
          'stripe_event_id', p_stripe_event_id,
          'stripe_payment_intent_id', v_payment_intent_id,
          'session_id', v_checkout.session_id,
          'capacity', v_session.capacity,
          'occupied_by_other_users', v_occupied_other,
          'post_start_conflict', v_post_start_conflict,
          'remediation_reason', v_remediation_reason,
          'requires_refund', v_requires_refund
        )
      );

      if v_requires_refund then
        perform private.enqueue_job(
          'email',
          jsonb_build_object(
            'template', 'late_payment_refund_required',
            'to', v_checkout.customer_email,
            'course_title', v_session.course_title,
            'amount_cents', v_checkout.amount_cents,
            'currency', v_checkout.currency,
            'stripe_payment_intent_id', v_payment_intent_id,
            'checkout_id', v_checkout.id,
            'remediation_reason', v_remediation_reason
          ),
          'late-payment-refund-customer:' || v_checkout.id::text
        );

        perform private.enqueue_job(
          'email',
          jsonb_build_object(
            'template', 'late_payment_refund_admin',
            'to_role', 'workspace_admin',
            'customer_email', v_checkout.customer_email,
            'course_title', v_session.course_title,
            'amount_cents', v_checkout.amount_cents,
            'currency', v_checkout.currency,
            'stripe_payment_intent_id', v_payment_intent_id,
            'checkout_id', v_checkout.id,
            'payment_id', v_payment.id,
            'remediation_reason', v_remediation_reason
          ),
          'late-payment-refund-admin:' || v_checkout.id::text
        );

        perform public.record_integration_health(
          'stripe_refund_remediation',
          false,
          v_remediation_reason,
          jsonb_build_object(
            'checkout_id', v_checkout.id,
            'payment_id', v_payment.id,
            'stripe_payment_intent_id', v_payment_intent_id,
            'session_id', v_checkout.session_id,
            'remediation_reason', v_remediation_reason
          )
        );

      end if;

      if v_target_status = 'confirmed' then
        insert into private.analytics_events (
          event_name, user_id, page_path, properties, occurred_at
        ) values (
          v_remediation_reason,
          v_checkout.user_id,
          '/operations/stripe',
          jsonb_build_object(
            'session_id', v_checkout.session_id,
            'checkout_id', v_checkout.id,
            'payment_id', v_payment.id,
            'post_start_conflict', v_post_start_conflict,
            'remediation_reason', v_remediation_reason,
            'requires_refund', v_requires_refund
          ),
          now()
        );
      end if;

      update private.stripe_webhook_events
         set status = 'processed',
             error_message = v_remediation_reason,
             processed_at = now()
       where id = v_event_id;

      return jsonb_build_object(
        'duplicate', false,
        'processed', true,
        'capacity_conflict', v_occupied_other >= v_session.capacity,
        'post_start_conflict', v_post_start_conflict,
        'requires_refund', v_requires_refund,
        'remediation_reason', v_remediation_reason,
        'event_id', p_stripe_event_id,
        'checkout_id', v_checkout.id,
        'payment_id', v_payment.id
      );
    end if;

    insert into public.enrollments (
      session_id,
      user_id,
      attendee_email,
      attendee_name,
      status,
      amount_cents,
      currency,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      stripe_customer_id,
      confirmed_at
    )
    select
      v_checkout.session_id,
      v_checkout.user_id,
      v_checkout.customer_email,
      p.full_name,
      v_target_status,
      v_checkout.amount_cents,
      v_checkout.currency,
      v_checkout.stripe_checkout_session_id,
      coalesce(nullif(v_object ->> 'payment_intent', ''), v_checkout.stripe_payment_intent_id),
      coalesce(nullif(v_object ->> 'customer', ''), v_checkout.stripe_customer_id),
      case when v_target_status = 'confirmed' then now() else null end
    from public.profiles p
    where p.id = v_checkout.user_id
    on conflict (session_id, user_id) do update
      set status = case
            when public.enrollments.status = 'confirmed' then 'confirmed'
            else excluded.status
          end,
          attendee_email = excluded.attendee_email,
          attendee_name = coalesce(excluded.attendee_name, public.enrollments.attendee_name),
          amount_cents = excluded.amount_cents,
          currency = excluded.currency,
          booked_at = case
            when public.enrollments.status in ('cancelled', 'refunded')
              then now()
            else public.enrollments.booked_at
          end,
          stripe_checkout_session_id = excluded.stripe_checkout_session_id,
          stripe_payment_intent_id = coalesce(excluded.stripe_payment_intent_id, public.enrollments.stripe_payment_intent_id),
          stripe_customer_id = coalesce(excluded.stripe_customer_id, public.enrollments.stripe_customer_id),
          confirmed_at = case
            when excluded.status = 'confirmed' and public.enrollments.status = 'confirmed'
              then public.enrollments.confirmed_at
            when excluded.status = 'confirmed'
              then now()
            when public.enrollments.status in ('cancelled', 'refunded')
              then null
            else public.enrollments.confirmed_at
          end,
          cancelled_at = case
            when public.enrollments.status in ('cancelled', 'refunded') then null
            else public.enrollments.cancelled_at
          end,
          updated_at = now()
    returning * into v_enrollment;

    if v_enrollment.id is null then
      raise exception using errcode = 'P0001', message = 'enrollment_profile_missing';
    end if;

    if v_payment_intent_id is not null then
      insert into private.payment_records (
        checkout_attempt_id,
        enrollment_id,
        stripe_payment_intent_id,
        stripe_checkout_session_id,
        amount_cents,
        amount_refunded_cents,
        currency,
        status,
        last_stripe_event_id,
        paid_at
      ) values (
        v_checkout.id,
        v_enrollment.id,
        v_payment_intent_id,
        v_checkout.stripe_checkout_session_id,
        v_checkout.amount_cents,
        0,
        v_checkout.currency,
        case when v_enrollment.status = 'confirmed' then 'paid' else 'pending' end,
        p_stripe_event_id,
        case when v_enrollment.status = 'confirmed' then now() else null end
      )
      on conflict (stripe_payment_intent_id) do update
        set checkout_attempt_id = excluded.checkout_attempt_id,
            enrollment_id = excluded.enrollment_id,
            stripe_checkout_session_id = excluded.stripe_checkout_session_id,
            amount_cents = greatest(private.payment_records.amount_cents, excluded.amount_cents),
            currency = excluded.currency,
            status = case
              when private.payment_records.status in ('mismatch', 'requires_refund', 'partially_refunded', 'refunded')
                then private.payment_records.status
              else excluded.status
            end,
            last_stripe_event_id = excluded.last_stripe_event_id,
            paid_at = coalesce(private.payment_records.paid_at, excluded.paid_at),
            updated_at = now()
      returning * into v_payment;

      if v_payment.status = 'refunded' then
        update public.enrollments
           set status = 'refunded', updated_at = now()
         where id = v_enrollment.id
        returning * into v_enrollment;
      end if;
    end if;

    update private.seat_holds
       set status = case when v_enrollment.status = 'refunded' then 'released' else 'converted' end,
           updated_at = now()
     where id = v_checkout.hold_id;

    update private.checkout_attempts
       set status = case
             when v_enrollment.status in ('confirmed', 'refunded') then 'paid'
             else 'payment_pending'
           end,
           updated_at = now()
     where id = v_checkout.id;

    if v_enrollment.status = 'confirmed' then
      update private.private_workshop_quotes
         set status = 'accepted', accepted_at = coalesce(accepted_at, now()), updated_at = now()
       where session_id = v_enrollment.session_id
         and customer_user_id = v_enrollment.user_id
         and status in ('sent', 'accepted');

      update public.waitlist_entries w
         set status = 'accepted', accepted_at = now(), updated_at = now()
        from private.seat_holds h
       where h.id = v_checkout.hold_id
         and w.id = h.waitlist_entry_id;

      update private.waitlist_offers o
         set status = 'accepted', accepted_at = now()
        from private.seat_holds h
       where h.id = v_checkout.hold_id
         and o.id = (
           select latest_offer.id
           from private.waitlist_offers latest_offer
           where latest_offer.waitlist_entry_id = h.waitlist_entry_id
           order by latest_offer.created_at desc, latest_offer.id desc
           limit 1
         )
         and o.status in ('active', 'expired');

      if not v_was_confirmed and exists (
        select 1 from private.seat_holds h
        where h.id = v_checkout.hold_id and h.source = 'waitlist'
      ) then
        insert into private.analytics_events (
          event_name, user_id, page_path, properties, occurred_at
        ) values (
          'waitlist_offer_accepted',
          v_enrollment.user_id,
          '/checkout/success',
          jsonb_build_object('session_id', v_enrollment.session_id),
          now()
        );
      end if;

      if not v_was_confirmed then
        perform private.enqueue_job(
          'email',
          jsonb_build_object(
            'template', 'enrollment_confirmation',
            'to', v_enrollment.attendee_email,
            'attendee_name', v_enrollment.attendee_name,
            'course_title', v_session.course_title,
            'session_id', v_session.id,
            'checkout_id', v_checkout.id,
            'payment_id', v_payment.id,
            'stripe_payment_intent_id', v_payment_intent_id,
            'start_at', v_session.start_at,
            'end_at', v_session.end_at,
            'timezone', v_session.timezone,
            'format', v_session.format,
            'venue', v_session.venue
          ),
          'enrollment-confirmation:' || v_enrollment.id::text || ':' || v_checkout.id::text
        );

        perform private.enqueue_job(
          'email',
          jsonb_build_object(
            'template', 'booking_admin_alert',
            'to_role', 'workspace_admin',
            'attendee_email', v_enrollment.attendee_email,
            'attendee_name', v_enrollment.attendee_name,
            'course_title', v_session.course_title,
            'session_id', v_session.id,
            'checkout_id', v_checkout.id,
            'payment_id', v_payment.id,
            'stripe_payment_intent_id', v_payment_intent_id,
            'start_at', v_session.start_at,
            'amount_cents', v_enrollment.amount_cents,
            'currency', v_enrollment.currency
          ),
          'booking-admin-alert:' || v_enrollment.id::text || ':' || v_checkout.id::text
        );

        perform private.enqueue_job(
          'calendar_enrollment',
          jsonb_build_object(
            'enrollment_id', v_enrollment.id,
            'session_id', v_session.id,
            'checkout_id', v_checkout.id,
            'payment_id', v_payment.id,
            'stripe_payment_intent_id', v_payment_intent_id,
            'attendee_email', v_enrollment.attendee_email,
            'attendee_name', v_enrollment.attendee_name,
            'course_title', v_session.course_title,
            'start_at', v_session.start_at,
            'end_at', v_session.end_at,
            'timezone', v_session.timezone,
            'format', v_session.format,
            'venue', v_session.venue
          ),
          'calendar-enrollment:' || v_enrollment.id::text || ':' || v_checkout.id::text
        );

        insert into private.analytics_events (
          event_name, user_id, page_path, properties, occurred_at
        ) values (
          'enrollment_confirmed',
          v_enrollment.user_id,
          '/checkout/success',
          jsonb_build_object(
            'course_id', v_session.course_id,
            'session_id', v_session.id,
            'amount_cents', v_enrollment.amount_cents,
            'currency', v_enrollment.currency
          ),
          now()
        );
      end if;
    end if;
  end if;

  update private.stripe_webhook_events
     set status = v_event_status, processed_at = now()
   where id = v_event_id;

  return jsonb_build_object(
    'duplicate', false,
    'processed', true,
    'event_id', p_stripe_event_id,
    'checkout_id', v_checkout.id,
    'enrollment_id', v_enrollment.id,
    'enrollment_status', v_enrollment.status
  );
exception
  when others then
    update private.stripe_webhook_events
       set status = 'failed', error_message = left(sqlerrm, 1000), processed_at = now()
     where id = v_event_id;
    raise;
end;
$$;

revoke execute on function public.process_stripe_event(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.process_stripe_event(text, text, jsonb)
  to service_role;
