create or replace function public.create_staff_invite(
  p_actor_user_id uuid,
  p_email text,
  p_role text,
  p_token_hash text,
  p_invite_url text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite private.staff_invites%rowtype;
  v_expires_at timestamptz := now() + interval '7 days';
begin
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;

  if p_role not in ('admin', 'analyst')
     or length(trim(p_email)) < 4 then
    raise exception using errcode = 'P0001', message = 'invalid_staff_invite';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'clearstep.staff-invite:' || lower(trim(p_email)),
      0
    )
  );

  -- The actor may have waited behind another owner action.
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;

  if exists (
    select 1 from private.staff_members
    where lower(email::text) = lower(trim(p_email)) and status = 'active'
  ) then
    raise exception using errcode = 'P0001', message = 'staff_member_already_active';
  end if;

  update private.staff_invites
     set revoked_at = now()
   where lower(email::text) = lower(trim(p_email))
     and accepted_at is null
     and revoked_at is null;

  insert into private.staff_invites (
    email, role, token_hash, invited_by, expires_at
  ) values (
    lower(trim(p_email)), p_role, p_token_hash, p_actor_user_id, v_expires_at
  )
  returning * into v_invite;

  insert into private.staff_members (email, role, status, invited_by)
  values (lower(trim(p_email)), p_role, 'invited', p_actor_user_id)
  on conflict (email) do update
    set role = excluded.role,
        status = 'invited',
        invited_by = excluded.invited_by,
        updated_at = now();

  perform private.enqueue_job(
    'email',
    jsonb_build_object(
      'template', 'staff_invite',
      'to', lower(trim(p_email)),
      'role', p_role,
      'invite_url', p_invite_url,
      'expires_at', v_expires_at
    ),
    'staff-invite:' || v_invite.id::text
  );

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'staff.invite_created',
    'staff_invite',
    v_invite.id::text,
    jsonb_build_object('email', v_invite.email, 'role', v_invite.role, 'expires_at', v_invite.expires_at)
  );

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'email', v_invite.email,
    'role', v_invite.role,
    'expires_at', v_invite.expires_at
  );
end;
$$;

revoke execute on function public.create_staff_invite(uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_staff_invite(uuid, text, text, text, text, timestamptz)
  to service_role;

create or replace function public.accept_staff_invite(
  p_user_id uuid,
  p_user_email text,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite private.staff_invites%rowtype;
  v_member private.staff_members%rowtype;
begin
  select *
  into v_invite
  from private.staff_invites
  where token_hash = p_token_hash
    and accepted_at is null
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception using errcode = 'P0001', message = 'staff_invite_invalid_or_expired';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'clearstep.staff-invite:' || lower(v_invite.email::text),
      0
    )
  );

  select *
  into v_invite
  from private.staff_invites
  where token_hash = p_token_hash
    and accepted_at is null
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'staff_invite_invalid_or_expired';
  end if;

  if lower(v_invite.email::text) <> lower(trim(p_user_email)) then
    raise exception using errcode = 'P0001', message = 'staff_invite_email_mismatch';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and lower(u.email) = lower(trim(p_user_email))
      and u.email_confirmed_at is not null
  ) then
    raise exception using errcode = 'P0001', message = 'verified_email_required';
  end if;

  update private.staff_members
     set user_id = p_user_id,
         role = v_invite.role,
         status = 'active',
         activated_at = coalesce(activated_at, now()),
         updated_at = now()
   where lower(email::text) = lower(v_invite.email::text)
  returning * into v_member;

  if not found then
    insert into private.staff_members (user_id, email, role, status, invited_by, activated_at)
    values (p_user_id, v_invite.email, v_invite.role, 'active', v_invite.invited_by, now())
    returning * into v_member;
  end if;

  update private.staff_invites
     set accepted_at = now()
   where id = v_invite.id;

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_user_id,
    'staff.invite_accepted',
    'staff_member',
    v_member.id::text,
    jsonb_build_object('invite_id', v_invite.id, 'email', v_member.email, 'role', v_member.role)
  );

  return jsonb_build_object(
    'staff_member_id', v_member.id,
    'email', v_member.email,
    'role', v_member.role,
    'status', v_member.status
  );
end;
$$;

revoke execute on function public.accept_staff_invite(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.accept_staff_invite(uuid, text, text)
  to service_role;

create or replace function public.create_google_oauth_state(
  p_actor_user_id uuid,
  p_state_hash text,
  p_code_verifier text,
  p_redirect_uri text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state_id uuid;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;

  delete from private.google_oauth_states where expires_at <= now();

  insert into private.google_oauth_states (
    actor_user_id, state_hash, code_verifier, redirect_uri, expires_at
  ) values (
    p_actor_user_id, p_state_hash, p_code_verifier, p_redirect_uri, p_expires_at
  )
  returning id into v_state_id;

  return jsonb_build_object('state_id', v_state_id, 'expires_at', p_expires_at);
end;
$$;

revoke execute on function public.create_google_oauth_state(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_google_oauth_state(uuid, text, text, text, timestamptz)
  to service_role;

create or replace function public.consume_google_oauth_state(p_state_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state private.google_oauth_states%rowtype;
begin
  delete from private.google_oauth_states
  where state_hash = p_state_hash
    and expires_at > now()
  returning * into v_state;

  if not found then
    raise exception using errcode = 'P0001', message = 'google_oauth_state_invalid_or_expired';
  end if;

  return jsonb_build_object(
    'actor_user_id', v_state.actor_user_id,
    'code_verifier', v_state.code_verifier,
    'redirect_uri', v_state.redirect_uri
  );
end;
$$;

revoke execute on function public.consume_google_oauth_state(text)
  from public, anon, authenticated;
grant execute on function public.consume_google_oauth_state(text)
  to service_role;

create or replace function public.save_google_connection(
  p_actor_user_id uuid,
  p_connected_email text,
  p_encrypted_access_token text,
  p_encrypted_refresh_token text,
  p_token_expires_at timestamptz,
  p_scopes text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection private.google_connections%rowtype;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;

  insert into private.google_connections (
    connected_by,
    connected_email,
    encrypted_access_token,
    encrypted_refresh_token,
    token_expires_at,
    scopes,
    status
  ) values (
    p_actor_user_id,
    lower(trim(p_connected_email)),
    p_encrypted_access_token,
    p_encrypted_refresh_token,
    p_token_expires_at,
    p_scopes,
    'active'
  )
  on conflict (connected_email) do update
    set connected_by = excluded.connected_by,
        encrypted_access_token = excluded.encrypted_access_token,
        encrypted_refresh_token = coalesce(excluded.encrypted_refresh_token, private.google_connections.encrypted_refresh_token),
        token_expires_at = excluded.token_expires_at,
        scopes = excluded.scopes,
        status = 'active',
        updated_at = now()
  returning * into v_connection;

  return jsonb_build_object(
    'connection_id', v_connection.id,
    'connected_email', v_connection.connected_email,
    'status', v_connection.status,
    'scopes', v_connection.scopes
  );
end;
$$;

revoke execute on function public.save_google_connection(uuid, text, text, text, timestamptz, text[])
  from public, anon, authenticated;
grant execute on function public.save_google_connection(uuid, text, text, text, timestamptz, text[])
  to service_role;

create or replace function public.get_google_connection(p_connected_email text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'connection_id', gc.id,
    'connected_email', gc.connected_email,
    'encrypted_access_token', gc.encrypted_access_token,
    'encrypted_refresh_token', gc.encrypted_refresh_token,
    'token_expires_at', gc.token_expires_at,
    'scopes', gc.scopes,
    'status', gc.status
  )
  from private.google_connections gc
  where lower(gc.connected_email::text) = lower(trim(p_connected_email))
    and gc.status = 'active'
  limit 1;
$$;

revoke execute on function public.get_google_connection(text)
  from public, anon, authenticated;
grant execute on function public.get_google_connection(text)
  to service_role;

create or replace function public.update_google_access_token(
  p_connection_id uuid,
  p_encrypted_access_token text,
  p_token_expires_at timestamptz,
  p_encrypted_refresh_token text default null,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.google_connections
     set encrypted_access_token = p_encrypted_access_token,
         encrypted_refresh_token = coalesce(p_encrypted_refresh_token, encrypted_refresh_token),
         token_expires_at = p_token_expires_at,
         status = p_status,
         updated_at = now()
   where id = p_connection_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'google_connection_not_found';
  end if;

  return jsonb_build_object('updated', true, 'connection_id', p_connection_id, 'status', p_status);
end;
$$;

revoke execute on function public.update_google_access_token(uuid, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.update_google_access_token(uuid, text, timestamptz, text, text)
  to service_role;

create or replace function public.ingest_analytics_event(
  p_event_name text,
  p_anonymous_id text,
  p_user_id uuid,
  p_page_path text,
  p_referrer text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_properties jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
  v_properties jsonb := coalesce(p_properties, '{}'::jsonb);
  v_course_id uuid;
begin
  if p_event_name !~ '^[a-z][a-z0-9_]{1,63}$'
     or jsonb_typeof(coalesce(p_properties, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_properties, '{}'::jsonb)::text) > 8192
     or p_occurred_at < now() - interval '7 days'
     or p_occurred_at > now() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'invalid_analytics_event';
  end if;

  if p_anonymous_id is not null
     and p_anonymous_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using errcode = 'P0001', message = 'invalid_analytics_session';
  end if;

  if p_event_name = 'course_view' then
    -- The public client supplies only the slug. Resolve it server-side so
    -- retained aggregates remain attached to the course if its slug changes.
    v_properties := v_properties - 'course_id';
    select c.id into v_course_id
    from public.courses c
    where c.slug = nullif(v_properties ->> 'course_slug', '')
    limit 1;

    if v_course_id is not null then
      v_properties := v_properties || jsonb_build_object('course_id', v_course_id);
    end if;
  end if;

  insert into private.analytics_events (
    event_name,
    anonymous_id,
    user_id,
    page_path,
    referrer,
    utm_source,
    utm_medium,
    utm_campaign,
    properties,
    occurred_at
  ) values (
    p_event_name,
    nullif(p_anonymous_id, '')::uuid,
    p_user_id,
    left(nullif(p_page_path, ''), 500),
    left(nullif(p_referrer, ''), 1000),
    left(nullif(p_utm_source, ''), 200),
    left(nullif(p_utm_medium, ''), 200),
    left(nullif(p_utm_campaign, ''), 200),
    v_properties,
    p_occurred_at
  )
  returning id into v_event_id;

  return jsonb_build_object('event_id', v_event_id, 'accepted', true);
end;
$$;

revoke execute on function public.ingest_analytics_event(text, text, uuid, text, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_analytics_event(text, text, uuid, text, text, text, text, text, jsonb, timestamptz)
  to service_role;

create or replace function public.get_staff_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select sm.role
  from private.staff_members sm
  where sm.user_id = p_user_id
    and sm.status = 'active'
  limit 1;
$$;

revoke execute on function public.get_staff_role(uuid)
  from public, anon, authenticated;
grant execute on function public.get_staff_role(uuid)
  to service_role;

create or replace function public.staff_admin_action(
  p_actor_user_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_course public.courses%rowtype;
  v_course_title text;
  v_session public.workshop_sessions%rowtype;
  v_request private.private_workshop_requests%rowtype;
  v_quote private.private_workshop_quotes%rowtype;
  v_quote_id uuid;
  v_checkout_token text;
  v_checkout_token_hash text;
  v_checkout_expires_at timestamptz;
  v_member private.staff_members%rowtype;
  v_invite private.staff_invites%rowtype;
  v_entry public.waitlist_entries%rowtype;
  v_offer_expires_at timestamptz;
  v_offer_token text;
  v_offer_token_hash text;
  v_active_owner_count integer;
  v_used integer;
  v_has_paid_enrollment boolean;
  v_job private.automation_jobs%rowtype;
  v_queue_message_id bigint;
  v_from timestamptz;
  v_to timestamptz;
  v_analytics_retention_start timestamptz;
  v_analytics_range_end timestamptz;
  v_result jsonb;
begin
  select role into v_role
  from private.staff_members
  where user_id = p_actor_user_id and status = 'active';

  if v_role is null then
    raise exception using errcode = 'P0001', message = 'staff_access_required';
  end if;

  -- Analysts are deliberately limited to aggregate analytics and their own
  -- role context. This deny-by-default guard also protects future actions.
  if v_role = 'analyst' and p_action not in ('analytics_summary', 'staff_context') then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;

  case p_action
    when 'catalog_list' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      select jsonb_build_object(
        'courses',
        coalesce(jsonb_agg(
          to_jsonb(c) || jsonb_build_object(
            'sessions', coalesce((
              select jsonb_agg(to_jsonb(s) order by s.start_at)
              from public.workshop_sessions s
              where s.course_id = c.id
            ), '[]'::jsonb)
          )
          order by c.created_at desc
        ), '[]'::jsonb)
      ) into v_result
      from public.courses c;

    when 'course_upsert' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;

      if coalesce(nullif(p_payload ->> 'status', ''), 'draft') = 'published'
         and (
           nullif(p_payload ->> 'stripe_product_id', '') is null
           or nullif(p_payload ->> 'stripe_price_id', '') is null
         ) then
        raise exception using errcode = 'P0001', message = 'published_course_requires_stripe_price';
      end if;

      if nullif(p_payload ->> 'id', '') is null then
        insert into public.courses (
          slug, title, summary, description, outcomes, level, audience, agenda, duration_minutes,
          price_cents, currency, stripe_product_id, stripe_price_id, status,
          seo_title, seo_description, created_by
        ) values (
          p_payload ->> 'slug',
          p_payload ->> 'title',
          p_payload ->> 'summary',
          p_payload ->> 'description',
          array(select jsonb_array_elements_text(coalesce(p_payload -> 'outcomes', '[]'::jsonb))),
          p_payload ->> 'level',
          p_payload ->> 'audience',
          coalesce(p_payload -> 'agenda', '[]'::jsonb),
          (p_payload ->> 'duration_minutes')::integer,
          (p_payload ->> 'price_cents')::integer,
          'EUR',
          nullif(p_payload ->> 'stripe_product_id', ''),
          nullif(p_payload ->> 'stripe_price_id', ''),
          coalesce(nullif(p_payload ->> 'status', ''), 'draft'),
          nullif(p_payload ->> 'seo_title', ''),
          nullif(p_payload ->> 'seo_description', ''),
          p_actor_user_id
        ) returning * into v_course;
      else
        update public.courses
           set slug = p_payload ->> 'slug',
               title = p_payload ->> 'title',
               summary = p_payload ->> 'summary',
               description = p_payload ->> 'description',
               outcomes = array(select jsonb_array_elements_text(coalesce(p_payload -> 'outcomes', '[]'::jsonb))),
               level = p_payload ->> 'level',
               audience = p_payload ->> 'audience',
               agenda = coalesce(p_payload -> 'agenda', '[]'::jsonb),
               duration_minutes = (p_payload ->> 'duration_minutes')::integer,
               price_cents = (p_payload ->> 'price_cents')::integer,
               currency = 'EUR',
               stripe_product_id = nullif(p_payload ->> 'stripe_product_id', ''),
               stripe_price_id = nullif(p_payload ->> 'stripe_price_id', ''),
               status = p_payload ->> 'status',
               seo_title = nullif(p_payload ->> 'seo_title', ''),
               seo_description = nullif(p_payload ->> 'seo_description', ''),
               updated_at = now()
         where id = (p_payload ->> 'id')::uuid
        returning * into v_course;
      end if;

      if v_course.id is null then
        raise exception using errcode = 'P0001', message = 'course_not_found';
      end if;
      v_result := jsonb_build_object('course', to_jsonb(v_course));

    when 'session_upsert' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;

      if nullif(p_payload ->> 'id', '') is null then
        insert into public.workshop_sessions (
          course_id, format, start_at, end_at, timezone, venue, capacity, status, created_by
        ) values (
          (p_payload ->> 'course_id')::uuid,
          p_payload ->> 'format',
          (p_payload ->> 'start_at')::timestamptz,
          (p_payload ->> 'end_at')::timestamptz,
          coalesce(nullif(p_payload ->> 'timezone', ''), 'Europe/Amsterdam'),
          nullif(p_payload ->> 'venue', ''),
          (p_payload ->> 'capacity')::integer,
          coalesce(nullif(p_payload ->> 'status', ''), 'draft'),
          p_actor_user_id
        ) returning * into v_session;
      else
        select * into v_session
        from public.workshop_sessions
        where id = (p_payload ->> 'id')::uuid
        for update;

        if not found then
          raise exception using errcode = 'P0001', message = 'session_not_found';
        end if;

        v_used := private.session_occupied_seats(v_session.id);

        if (p_payload ->> 'capacity')::integer < v_used then
          raise exception using errcode = 'P0001', message = 'session_capacity_below_occupied';
        end if;

        select
          exists (
            select 1
            from public.enrollments e
            where e.session_id = v_session.id
              and e.status in ('confirmed', 'refunded')
          ) or exists (
            select 1
            from private.payment_records pr
            join private.checkout_attempts ca on ca.id = pr.checkout_attempt_id
            where ca.session_id = v_session.id
              and pr.status in ('paid', 'mismatch', 'requires_refund', 'partially_refunded', 'refunded')
          )
        into v_has_paid_enrollment;

        if (v_used > 0 or v_has_paid_enrollment)
           and v_session.status is distinct from p_payload ->> 'status' then
          raise exception using errcode = 'P0001', message = 'occupied_session_status_immutable';
        end if;

        if (v_used > 0 or v_has_paid_enrollment) and (
          v_session.course_id is distinct from (p_payload ->> 'course_id')::uuid
          or v_session.format is distinct from p_payload ->> 'format'
          or v_session.start_at is distinct from (p_payload ->> 'start_at')::timestamptz
          or v_session.end_at is distinct from (p_payload ->> 'end_at')::timestamptz
          or v_session.timezone is distinct from coalesce(
            nullif(p_payload ->> 'timezone', ''),
            'Europe/Amsterdam'
          )
          or v_session.venue is distinct from nullif(p_payload ->> 'venue', '')
        ) then
          raise exception using errcode = 'P0001', message = 'occupied_session_identity_immutable';
        end if;

        update public.workshop_sessions
           set course_id = (p_payload ->> 'course_id')::uuid,
               format = p_payload ->> 'format',
               start_at = (p_payload ->> 'start_at')::timestamptz,
               end_at = (p_payload ->> 'end_at')::timestamptz,
               timezone = coalesce(nullif(p_payload ->> 'timezone', ''), 'Europe/Amsterdam'),
               venue = nullif(p_payload ->> 'venue', ''),
               capacity = (p_payload ->> 'capacity')::integer,
               status = p_payload ->> 'status',
               updated_at = now()
         where id = (p_payload ->> 'id')::uuid
        returning * into v_session;
      end if;

      if v_session.id is null then
        raise exception using errcode = 'P0001', message = 'session_not_found';
      end if;

      if v_session.status in ('scheduled', 'sold_out') then
        select c.title into strict v_course_title
        from public.courses c
        where c.id = v_session.course_id;

        perform private.enqueue_job(
          'calendar_session',
          jsonb_build_object(
            'session_id', v_session.id,
            'course_title', v_course_title,
            'start_at', v_session.start_at,
            'end_at', v_session.end_at,
            'timezone', v_session.timezone,
            'format', v_session.format,
            'venue', v_session.venue
          ),
          'calendar-session:' || v_session.id::text || ':' ||
            encode(extensions.digest(to_jsonb(v_session)::text, 'sha256'), 'hex')
        );
      end if;
      v_result := jsonb_build_object('session', to_jsonb(v_session));

    when 'private_requests_list' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      select jsonb_build_object(
        'requests',
        coalesce(jsonb_agg(
          to_jsonb(r) || jsonb_build_object(
            'quotes', coalesce((
              select jsonb_agg(to_jsonb(q) order by q.created_at desc)
              from private.private_workshop_quotes q
              where q.request_id = r.id
            ), '[]'::jsonb)
          ) order by r.created_at desc
        ), '[]'::jsonb)
      ) into v_result
      from (
        select * from private.private_workshop_requests
        order by created_at desc
        limit 100
      ) r;

    when 'private_request_update' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      update private.private_workshop_requests
         set status = p_payload ->> 'status',
             owner_user_id = coalesce(nullif(p_payload ->> 'owner_user_id', '')::uuid, owner_user_id),
             updated_at = now()
       where id = (p_payload ->> 'request_id')::uuid
      returning * into v_request;
      if v_request.id is null then
        raise exception using errcode = 'P0001', message = 'private_request_not_found';
      end if;
      v_result := jsonb_build_object('request', to_jsonb(v_request));

    when 'quote_create' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      select * into v_request
      from private.private_workshop_requests
      where id = (p_payload ->> 'request_id')::uuid
      for update;
      if not found then
        raise exception using errcode = 'P0001', message = 'private_request_not_found';
      end if;

      v_quote_id := extensions.gen_random_uuid();

      insert into public.courses (
        id, slug, title, summary, description, outcomes, level, audience, agenda,
        duration_minutes, price_cents, currency, stripe_product_id, stripe_price_id,
        visibility, status, created_by
      ) values (
        extensions.gen_random_uuid(),
        'private-' || replace(v_quote_id::text, '-', ''),
        coalesce(nullif(p_payload ->> 'course_title', ''), 'Private AI workshop for ' || v_request.organization),
        left(p_payload ->> 'description', 500),
        p_payload ->> 'description',
        array(select jsonb_array_elements_text(coalesce(p_payload -> 'outcomes', '[]'::jsonb))),
        coalesce(nullif(p_payload ->> 'level', ''), 'Tailored'),
        coalesce(nullif(p_payload ->> 'audience', ''), 'Team at ' || v_request.organization),
        coalesce(p_payload -> 'agenda', '[]'::jsonb),
        greatest(1, extract(epoch from (
          (p_payload ->> 'end_at')::timestamptz - (p_payload ->> 'start_at')::timestamptz
        ))::integer / 60),
        (p_payload ->> 'amount_cents')::integer,
        'EUR',
        p_payload ->> 'stripe_product_id',
        p_payload ->> 'stripe_price_id',
        'private',
        'published',
        p_actor_user_id
      ) returning * into v_course;

      insert into public.workshop_sessions (
        course_id, format, start_at, end_at, timezone, venue, capacity, status, created_by
      ) values (
        v_course.id,
        p_payload ->> 'format',
        (p_payload ->> 'start_at')::timestamptz,
        (p_payload ->> 'end_at')::timestamptz,
        coalesce(nullif(p_payload ->> 'timezone', ''), 'Europe/Amsterdam'),
        nullif(p_payload ->> 'venue', ''),
        coalesce(nullif(p_payload ->> 'capacity', '')::integer, v_request.attendee_count, 1),
        'scheduled',
        p_actor_user_id
      ) returning * into v_session;

      insert into private.private_workshop_quotes (
        id, request_id, course_id, session_id, amount_cents, currency,
        vat_inclusive, description, valid_until, status, created_by
      ) values (
        v_quote_id,
        v_request.id,
        v_course.id,
        v_session.id,
        (p_payload ->> 'amount_cents')::integer,
        'EUR',
        true,
        p_payload ->> 'description',
        (p_payload ->> 'valid_until')::date,
        'draft',
        p_actor_user_id
      ) returning * into v_quote;

      perform private.enqueue_job(
        'calendar_session',
        jsonb_build_object(
          'session_id', v_session.id,
          'course_title', v_course.title,
          'start_at', v_session.start_at,
          'end_at', v_session.end_at,
          'timezone', v_session.timezone,
          'format', v_session.format,
          'venue', v_session.venue
        ),
        'calendar-session:' || v_session.id::text || ':private-quote'
      );
      update private.private_workshop_requests
         set status = 'quoted', updated_at = now()
       where id = v_quote.request_id and status in ('new', 'contacted', 'qualified');
      v_result := jsonb_build_object('quote', to_jsonb(v_quote));

    when 'quote_send' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;

      -- Serialize resends before replacing the only valid token. The token hash
      -- also becomes this send lifecycle's durable email dedupe revision.
      select q.* into v_quote
      from private.private_workshop_quotes q
      where q.id = (p_payload ->> 'quote_id')::uuid
        and q.status in ('draft', 'sent')
        and q.valid_until >= (now() at time zone 'Europe/Amsterdam')::date
        and q.course_id is not null
        and q.session_id is not null
      for update;

      if not found then
        raise exception using errcode = 'P0001', message = 'quote_not_sendable';
      end if;

      select s.* into v_session
      from public.workshop_sessions s
      where s.id = v_quote.session_id
        and s.status in ('scheduled', 'sold_out')
        and s.start_at > now() + interval '32 minutes'
        and private.session_calendar_ready(s.id)
      for update;

      if not found then
        raise exception using errcode = 'P0001', message = 'quote_not_sendable';
      end if;

      v_checkout_expires_at := least(
        (v_quote.valid_until + 1)::timestamp at time zone 'Europe/Amsterdam',
        now() + interval '30 days',
        v_session.start_at - interval '1 minute'
      );
      v_checkout_token := encode(extensions.gen_random_bytes(32), 'hex');
      v_checkout_token_hash := encode(extensions.digest(v_checkout_token, 'sha256'), 'hex');

      update private.private_workshop_quotes
         set status = 'sent',
             sent_at = now(),
             checkout_token_hash = v_checkout_token_hash,
             checkout_expires_at = v_checkout_expires_at,
             updated_at = now()
       where id = v_quote.id
      returning * into v_quote;

      select * into v_request
      from private.private_workshop_requests
      where id = v_quote.request_id;
      perform private.enqueue_job(
        'email',
        jsonb_build_object(
          'template', 'private_quote',
          'to', v_request.email,
          'contact_name', v_request.contact_name,
          'organization', v_request.organization,
          'quote_id', v_quote.id,
          'amount_cents', v_quote.amount_cents,
          'currency', v_quote.currency,
          'vat_inclusive', v_quote.vat_inclusive,
          'description', v_quote.description,
          'valid_until', v_quote.valid_until,
          'payment_url', rtrim(p_payload ->> 'payment_url_base', '/') ||
            '?quote=' || v_checkout_token
        ),
        'private-quote:' || v_quote.id::text || ':' || v_checkout_token_hash
      );
      v_result := jsonb_build_object('quote', to_jsonb(v_quote));

    when 'analytics_summary' then
      v_from := coalesce(nullif(p_payload ->> 'from', '')::timestamptz, now() - interval '30 days');
      v_to := coalesce(nullif(p_payload ->> 'to', '')::timestamptz, now());
      v_analytics_retention_start := (
        (
          (now() at time zone 'Europe/Amsterdam')::date - interval '24 months'
        )::date::timestamp at time zone 'Europe/Amsterdam'
      );
      v_analytics_range_end := (
        ((now() at time zone 'Europe/Amsterdam')::date + 1)::timestamp
          at time zone 'Europe/Amsterdam'
      );

      if v_from >= v_to
         or v_from < v_analytics_retention_start
         or v_to > v_analytics_range_end then
        raise exception using errcode = 'P0001', message = 'invalid_analytics_range';
      end if;

      select jsonb_build_object(
        'from', v_from,
        'to', v_to,
        'page_views', private.analytics_event_count('page_view', v_from, v_to),
        'course_views', private.analytics_event_count('course_view', v_from, v_to),
        'checkout_starts', private.analytics_event_count('checkout_started', v_from, v_to),
        'private_requests', (select count(*) from private.private_workshop_requests where created_at >= v_from and created_at < v_to),
        'waitlist_joins', (select count(*) from public.waitlist_entries where joined_at >= v_from and joined_at < v_to),
        'waitlist_offers', (select count(*) from public.waitlist_entries where offered_at >= v_from and offered_at < v_to),
        'waitlist_acceptances', (select count(*) from public.waitlist_entries where accepted_at >= v_from and accepted_at < v_to),
        'automation_failures', (select count(*) from private.automation_jobs where status = 'failed' and updated_at >= v_from and updated_at < v_to),
        'confirmed_enrollments', (select count(*) from public.enrollments where status = 'confirmed' and confirmed_at >= v_from and confirmed_at < v_to),
        'gross_revenue_cents', coalesce((select sum(amount_cents) from private.payment_records where status in ('paid', 'partially_refunded', 'refunded') and paid_at >= v_from and paid_at < v_to), 0),
        'refund_count', (select count(*) from private.payment_records where amount_refunded_cents > 0 and refunded_at >= v_from and refunded_at < v_to),
        'refunded_cents', coalesce((select sum(amount_refunded_cents) from private.payment_records where refunded_at >= v_from and refunded_at < v_to), 0),
        'net_revenue_cents',
          coalesce((select sum(amount_cents) from private.payment_records where status in ('paid', 'partially_refunded', 'refunded') and paid_at >= v_from and paid_at < v_to), 0)
          - coalesce((select sum(amount_refunded_cents) from private.payment_records where refunded_at >= v_from and refunded_at < v_to), 0),
        'revenue_cents',
          coalesce((select sum(amount_cents) from private.payment_records where status in ('paid', 'partially_refunded', 'refunded') and paid_at >= v_from and paid_at < v_to), 0)
          - coalesce((select sum(amount_refunded_cents) from private.payment_records where refunded_at >= v_from and refunded_at < v_to), 0),
        'currency', 'EUR',
        'upcoming_occupancy', coalesce((
          select jsonb_agg(jsonb_build_object(
            'session_id', s.id,
            'course_title', c.title,
            'start_at', s.start_at,
            'capacity', s.capacity,
            'confirmed', (select count(*) from public.enrollments e where e.session_id = s.id and e.status = 'confirmed'),
            'active_holds', (select count(*) from private.seat_holds h where h.session_id = s.id and h.status = 'active' and h.expires_at > now())
          ) order by s.start_at)
          from public.workshop_sessions s
          join public.courses c on c.id = s.course_id
          where s.start_at > now() and s.status in ('scheduled', 'sold_out')
            and (v_role in ('owner', 'admin') or c.visibility = 'public')
        ), '[]'::jsonb),
        'top_courses', private.analytics_top_courses(v_from, v_to, 10),
        'utm_sources', private.analytics_utm_sources(v_from, v_to, 10)
      ) into v_result;

    when 'enrollments_list' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      select jsonb_build_object(
        'enrollments', coalesce(jsonb_agg(to_jsonb(e) || jsonb_build_object(
          'course_title', c.title,
          'start_at', s.start_at,
          'timezone', s.timezone
        ) order by e.booked_at desc), '[]'::jsonb)
      ) into v_result
      from (
        select * from public.enrollments order by booked_at desc limit 200
      ) e
      join public.workshop_sessions s on s.id = e.session_id
      join public.courses c on c.id = s.course_id;

    when 'google_connection_status' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      select jsonb_build_object(
        'connections', coalesce(jsonb_agg(jsonb_build_object(
          'id', gc.id,
          'connected_email', gc.connected_email,
          'status', gc.status,
          'scopes', gc.scopes,
          'token_expires_at', gc.token_expires_at,
          'updated_at', gc.updated_at
        )), '[]'::jsonb)
      ) into v_result
      from private.google_connections gc;

    when 'staff_context' then
      select jsonb_build_object(
        'user_id', sm.user_id,
        'email', sm.email,
        'role', sm.role,
        'status', sm.status
      ) into v_result
      from private.staff_members sm
      where sm.user_id = p_actor_user_id and sm.status = 'active';

    when 'staff_invites_list' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      select jsonb_build_object(
        'invites', coalesce(jsonb_agg(jsonb_build_object(
          'id', si.id,
          'email', si.email,
          'role', si.role,
          'expires_at', si.expires_at,
          'accepted_at', si.accepted_at,
          'revoked_at', si.revoked_at,
          'created_at', si.created_at
        ) order by si.created_at desc), '[]'::jsonb)
      ) into v_result
      from (
        select * from private.staff_invites order by created_at desc limit 200
      ) si;

    when 'staff_invite_revoke' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      update private.staff_invites
         set revoked_at = now()
       where id = (p_payload ->> 'invite_id')::uuid
         and accepted_at is null
         and revoked_at is null
      returning * into v_invite;
      if v_invite.id is null then
        raise exception using errcode = 'P0001', message = 'staff_invite_not_revocable';
      end if;
      update private.staff_members sm
         set status = 'removed', updated_at = now()
       where lower(sm.email::text) = lower(v_invite.email::text)
         and sm.status = 'invited'
         and not exists (
           select 1 from private.staff_invites active_invite
           where lower(active_invite.email::text) = lower(sm.email::text)
             and active_invite.accepted_at is null
             and active_invite.revoked_at is null
             and active_invite.expires_at > now()
         );
      insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
      values (
        p_actor_user_id,
        'staff.invite_revoked',
        'staff_invite',
        v_invite.id::text,
        jsonb_build_object('email', v_invite.email, 'role', v_invite.role)
      );
      v_result := jsonb_build_object('invite_id', v_invite.id, 'revoked', true);

    when 'staff_update' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      if (p_payload ->> 'role') not in ('owner', 'admin', 'analyst')
         or (p_payload ->> 'status') not in ('active', 'suspended', 'removed') then
        raise exception using errcode = 'P0001', message = 'invalid_staff_update';
      end if;

      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('clearstep.active-owner-roster', 0)
      );

      select role into v_role
      from private.staff_members
      where user_id = p_actor_user_id and status = 'active';
      if v_role <> 'owner' or v_role is null then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;

      select * into v_member
      from private.staff_members
      where id = (p_payload ->> 'staff_member_id')::uuid
      for update;
      if not found or (p_payload ->> 'status' = 'active' and v_member.user_id is null) then
        raise exception using errcode = 'P0001', message = 'staff_member_not_updateable';
      end if;
      if v_member.role = 'owner'
         and v_member.status = 'active'
         and (p_payload ->> 'role' <> 'owner' or p_payload ->> 'status' <> 'active') then
        select count(*) into v_active_owner_count
        from private.staff_members
        where role = 'owner' and status = 'active';
        if v_active_owner_count <= 1 then
          raise exception using errcode = 'P0001', message = 'last_active_owner_required';
        end if;
      end if;
      update private.staff_members
         set role = p_payload ->> 'role',
             status = p_payload ->> 'status',
             activated_at = case
               when p_payload ->> 'status' = 'active' then coalesce(activated_at, now())
               else activated_at
             end,
             updated_at = now()
       where id = v_member.id
      returning * into v_member;
      insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
      values (
        p_actor_user_id,
        'staff.member_updated',
        'staff_member',
        v_member.id::text,
        jsonb_build_object('email', v_member.email, 'role', v_member.role, 'status', v_member.status)
      );
      v_result := jsonb_build_object('staff_member', jsonb_build_object(
        'id', v_member.id,
        'email', v_member.email,
        'role', v_member.role,
        'status', v_member.status,
        'activated_at', v_member.activated_at
      ));

    when 'waitlist_list' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      select jsonb_build_object(
        'entries', coalesce(jsonb_agg(jsonb_build_object(
          'id', w.id,
          'session_id', w.session_id,
          'user_id', w.user_id,
          'email', w.email,
          'full_name', w.full_name,
          'status', w.status,
          'joined_at', w.joined_at,
          'offered_at', w.offered_at,
          'offer_expires_at', w.offer_expires_at,
          'accepted_at', w.accepted_at,
          'course_slug', c.slug,
          'course_title', c.title,
          'session_start_at', s.start_at,
          'session_timezone', s.timezone
        ) order by w.joined_at), '[]'::jsonb)
      ) into v_result
      from (
        select *
        from public.waitlist_entries
        where (nullif(p_payload ->> 'session_id', '') is null
          or session_id = (p_payload ->> 'session_id')::uuid)
          and (nullif(p_payload ->> 'status', '') is null
            or status = p_payload ->> 'status')
        order by joined_at
        limit 500
      ) w
      join public.workshop_sessions s on s.id = w.session_id
      join public.courses c on c.id = s.course_id;

    when 'waitlist_offer' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      select * into v_entry
      from public.waitlist_entries
      where id = (p_payload ->> 'entry_id')::uuid;
      if not found then
        raise exception using errcode = 'P0001', message = 'waitlist_entry_not_found';
      end if;
      select s.*, c.title as course_title into v_session
      from public.workshop_sessions s
      join public.courses c on c.id = s.course_id
      where s.id = v_entry.session_id
        and s.status in ('scheduled', 'sold_out')
        and s.start_at > now() + interval '63 minutes'
        and private.session_calendar_ready(s.id)
      for update of s;
      if not found then
        raise exception using errcode = 'P0001', message = 'session_not_offerable';
      end if;
      select * into v_entry
      from public.waitlist_entries
      where id = v_entry.id and status = 'waiting'
      for update;
      if not found then
        raise exception using errcode = 'P0001', message = 'waitlist_entry_not_offerable';
      end if;

      if exists (
        select 1
        from public.waitlist_entries fifo_head
        where fifo_head.session_id = v_entry.session_id
          and fifo_head.status = 'waiting'
          and (fifo_head.joined_at, fifo_head.id) < (v_entry.joined_at, v_entry.id)
      ) then
        raise exception using errcode = 'P0001', message = 'waitlist_fifo_head_required';
      end if;

      v_used := private.session_occupied_seats(v_session.id);
      if v_used >= v_session.capacity then
        raise exception using errcode = 'P0001', message = 'session_full';
      end if;
      v_offer_token := encode(extensions.gen_random_bytes(32), 'hex');
      v_offer_token_hash := encode(extensions.digest(v_offer_token, 'sha256'), 'hex');
      v_offer_expires_at := least(
        now() + interval '24 hours',
        v_session.start_at - interval '32 minutes'
      );
      update private.waitlist_offers
         set status = 'revoked'
       where waitlist_entry_id = v_entry.id and status = 'active';
      update public.waitlist_entries
         set status = 'offered', offered_at = now(), offer_expires_at = v_offer_expires_at,
             updated_at = now()
       where id = v_entry.id
      returning * into v_entry;
      insert into private.waitlist_offers (waitlist_entry_id, token_hash, status, expires_at)
      values (v_entry.id, v_offer_token_hash, 'active', v_offer_expires_at);
      insert into private.seat_holds (
        session_id, user_id, waitlist_entry_id, source, status, expires_at
      ) values (
        v_entry.session_id, v_entry.user_id, v_entry.id, 'waitlist', 'active', v_offer_expires_at
      )
      on conflict (session_id, user_id) do update
        set waitlist_entry_id = excluded.waitlist_entry_id,
            source = 'waitlist', status = 'active', expires_at = excluded.expires_at,
            updated_at = now();
      perform private.enqueue_job(
        'email',
        jsonb_build_object(
          'template', 'waitlist_offer',
          'to', v_entry.email,
          'full_name', v_entry.full_name,
          'course_title', v_session.course_title,
          'session_id', v_session.id,
          'start_at', v_session.start_at,
          'timezone', v_session.timezone,
          'offer_token', v_offer_token,
          'offer_expires_at', v_offer_expires_at
        ),
        'waitlist-offer:' || v_entry.id::text || ':' || extract(epoch from now())::bigint::text
      );
      insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
      values (
        p_actor_user_id,
        'waitlist.offer_created',
        'waitlist_entry',
        v_entry.id::text,
        jsonb_build_object('session_id', v_entry.session_id, 'expires_at', v_offer_expires_at)
      );
      insert into private.analytics_events (
        event_name, user_id, page_path, properties, occurred_at
      ) values (
        'waitlist_offer_created',
        v_entry.user_id,
        '/operations/waitlist',
        jsonb_build_object('session_id', v_entry.session_id, 'source', 'manual'),
        now()
      );
      v_result := jsonb_build_object(
        'entry_id', v_entry.id,
        'status', v_entry.status,
        'offer_expires_at', v_offer_expires_at
      );

    when 'waitlist_remove' then
      if v_role not in ('owner', 'admin') then
        raise exception using errcode = 'P0001', message = 'staff_admin_required';
      end if;
      select * into v_entry
      from public.waitlist_entries
      where id = (p_payload ->> 'entry_id')::uuid
        and status in ('waiting', 'offered', 'expired')
      for update;
      if not found then
        raise exception using errcode = 'P0001', message = 'waitlist_entry_not_removable';
      end if;
      update public.waitlist_entries
         set status = 'removed', offer_expires_at = now(), updated_at = now()
       where id = v_entry.id
      returning * into v_entry;
      update private.waitlist_offers
         set status = 'revoked'
       where waitlist_entry_id = v_entry.id and status = 'active';
      update private.seat_holds
         set status = 'released', updated_at = now()
       where waitlist_entry_id = v_entry.id and status = 'active';
      insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
      values (
        p_actor_user_id,
        'waitlist.entry_removed',
        'waitlist_entry',
        v_entry.id::text,
        jsonb_build_object('session_id', v_entry.session_id, 'email', v_entry.email)
      );
      v_result := jsonb_build_object('entry_id', v_entry.id, 'status', v_entry.status);

    when 'operations_status' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      select jsonb_build_object(
        'integrations', coalesce((
          select jsonb_agg(to_jsonb(ih) order by ih.integration)
          from private.integration_health ih
        ), '[]'::jsonb),
        'automation', coalesce((
          select jsonb_object_agg(status, job_count)
          from (
            select status, count(*) as job_count
            from private.automation_jobs
            group by status
          ) counts
        ), '{}'::jsonb),
        'failed_email_deliveries', (
          select count(*) from private.email_deliveries where status = 'failed'
        )
      ) into v_result;

    when 'automation_jobs_list' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      select jsonb_build_object(
        'jobs', coalesce(jsonb_agg(jsonb_build_object(
          'id', j.id,
          'job_type', j.job_type,
          'status', j.status,
          'attempts', j.attempts,
          'max_attempts', j.max_attempts,
          'available_at', j.available_at,
          'last_error', j.last_error,
          'created_at', j.created_at,
          'completed_at', j.completed_at
        ) order by j.created_at desc), '[]'::jsonb)
      ) into v_result
      from (
        select * from private.automation_jobs order by created_at desc limit 300
      ) j;

    when 'automation_job_retry' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      select * into v_job
      from private.automation_jobs
      where id = (p_payload ->> 'job_id')::uuid and status = 'failed'
      for update;
      if not found then
        raise exception using errcode = 'P0001', message = 'automation_job_not_retryable';
      end if;
      select * into v_queue_message_id
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
             pgmq_message_id = v_queue_message_id,
             completed_at = null,
             updated_at = now()
       where id = v_job.id
      returning * into v_job;
      insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
      values (
        p_actor_user_id,
        'automation.job_retried',
        'automation_job',
        v_job.id::text,
        jsonb_build_object('job_type', v_job.job_type)
      );
      v_result := jsonb_build_object('job_id', v_job.id, 'status', v_job.status);

    when 'audit_list' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      select jsonb_build_object(
        'events', coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc), '[]'::jsonb)
      ) into v_result
      from (
        select * from private.audit_logs order by occurred_at desc limit 300
      ) a;

    when 'staff_list' then
      if v_role <> 'owner' then
        raise exception using errcode = 'P0001', message = 'staff_owner_required';
      end if;
      select jsonb_build_object(
        'staff', coalesce(jsonb_agg(jsonb_build_object(
          'id', sm.id,
          'email', sm.email,
          'role', sm.role,
          'status', sm.status,
          'activated_at', sm.activated_at,
          'created_at', sm.created_at
        ) order by sm.created_at), '[]'::jsonb)
      ) into v_result
      from private.staff_members sm;

    else
      raise exception using errcode = 'P0001', message = 'unsupported_admin_action';
  end case;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

revoke execute on function public.staff_admin_action(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.staff_admin_action(uuid, text, jsonb)
  to service_role;

create or replace function public.run_booking_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_stale_checkout record;
  v_entry public.waitlist_entries%rowtype;
  v_used integer;
  v_slots integer;
  v_promoted integer := 0;
  v_expired_holds integer := 0;
  v_expired_offers integer := 0;
  v_stale_payment_pending integer := 0;
  v_rate_limit_entries_deleted integer := 0;
  v_raw_token text;
  v_token_hash text;
  v_offer_expires_at timestamptz;
begin
  delete from private.private_request_rate_limits
  where created_at <= now() - interval '24 hours';
  get diagnostics v_rate_limit_entries_deleted = row_count;

  update private.automation_jobs
     set status = 'pending',
         locked_at = null,
         locked_by = null,
         available_at = now(),
         last_error = coalesce(last_error, 'worker_lock_timeout'),
         updated_at = now()
   where status = 'processing'
     and locked_at < now() - interval '10 minutes';

  with expired as (
    update private.seat_holds
       set status = 'expired', updated_at = now()
     where status = 'active' and expires_at <= now()
    returning id
  ) select count(*) into v_expired_holds from expired;

  update private.checkout_attempts
     set status = 'expired', updated_at = now()
   where (status = 'creating' and expires_at <= now())
      or (status = 'open' and grace_expires_at <= now());

  -- An asynchronous method can produce an unpaid completed event and then
  -- never deliver a success/failure webhook. Once the authoritative grace
  -- window ends, release that provisional seat. A later genuine paid event is
  -- still accepted by process_stripe_event and must pass its final allocation
  -- and post-start remediation checks.
  for v_stale_checkout in
    select
      ca.*,
      c.title as course_title,
      e.id as enrollment_id,
      pr.id as payment_id
    from private.checkout_attempts ca
    join public.workshop_sessions s on s.id = ca.session_id
    join public.courses c on c.id = s.course_id
    left join public.enrollments e
      on e.session_id = ca.session_id
     and e.user_id = ca.user_id
     and e.status = 'pending_payment'
    left join lateral (
      select payment.id
      from private.payment_records payment
      where payment.checkout_attempt_id = ca.id
      order by payment.updated_at desc, payment.id
      limit 1
    ) pr on true
    where ca.status = 'payment_pending'
      and ca.grace_expires_at <= now()
    order by ca.grace_expires_at, ca.id
    for update of ca
  loop
    update private.checkout_attempts
       set status = 'failed', updated_at = now()
     where id = v_stale_checkout.id
       and status = 'payment_pending';

    if not found then
      continue;
    end if;

    update private.payment_records
       set status = 'failed', updated_at = now()
     where checkout_attempt_id = v_stale_checkout.id
       and status = 'pending';

    update public.enrollments
       set status = 'cancelled',
           cancelled_at = now(),
           updated_at = now()
     where id = v_stale_checkout.enrollment_id
       and status = 'pending_payment';

    update private.seat_holds
       set status = 'released', updated_at = now()
     where id = v_stale_checkout.hold_id
       and status in ('active', 'expired', 'converted');

    update public.waitlist_entries w
       set status = 'expired',
           offer_expires_at = now(),
           updated_at = now()
      from private.seat_holds h
     where h.id = v_stale_checkout.hold_id
       and w.id = h.waitlist_entry_id
       and w.status = 'offered';

    update private.waitlist_offers o
       set status = 'expired'
      from private.seat_holds h
     where h.id = v_stale_checkout.hold_id
       and o.waitlist_entry_id = h.waitlist_entry_id
       and o.status = 'active';

    insert into private.audit_logs (action, target_type, target_id, metadata)
    values (
      'stripe.payment_pending_timed_out',
      'checkout',
      v_stale_checkout.id::text,
      jsonb_build_object(
        'session_id', v_stale_checkout.session_id,
        'enrollment_id', v_stale_checkout.enrollment_id,
        'payment_id', v_stale_checkout.payment_id,
        'stripe_payment_intent_id', v_stale_checkout.stripe_payment_intent_id,
        'grace_expires_at', v_stale_checkout.grace_expires_at
      )
    );

    perform private.enqueue_job(
      'email',
      jsonb_build_object(
        'template', 'payment_failed',
        'to', v_stale_checkout.customer_email,
        'course_title', v_stale_checkout.course_title,
        'session_id', v_stale_checkout.session_id
      ),
      'payment-failed:' || v_stale_checkout.id::text
    );

    perform private.enqueue_job(
      'email',
      jsonb_build_object(
        'template', 'payment_pending_timeout_admin',
        'to_role', 'workspace_admin',
        'customer_email', v_stale_checkout.customer_email,
        'course_title', v_stale_checkout.course_title,
        'session_id', v_stale_checkout.session_id,
        'checkout_id', v_stale_checkout.id,
        'payment_id', v_stale_checkout.payment_id,
        'stripe_payment_intent_id', v_stale_checkout.stripe_payment_intent_id,
        'amount_cents', v_stale_checkout.amount_cents,
        'currency', v_stale_checkout.currency,
        'grace_expires_at', v_stale_checkout.grace_expires_at
      ),
      'payment-pending-timeout-admin:' || v_stale_checkout.id::text
    );

    v_stale_payment_pending := v_stale_payment_pending + 1;
  end loop;

  with expired as (
    update private.waitlist_offers
       set status = 'expired'
     where status = 'active' and expires_at <= now()
    returning waitlist_entry_id
  ), updated_entries as (
    update public.waitlist_entries w
       set status = 'expired', offer_expires_at = now(), updated_at = now()
      from expired e
     where w.id = e.waitlist_entry_id and w.status = 'offered'
    returning w.id
  ) select count(*) into v_expired_offers from updated_entries;

  for v_session in
    select s.*, c.title as course_title
    from public.workshop_sessions s
    join public.courses c on c.id = s.course_id
    where s.status in ('scheduled', 'sold_out')
      and s.start_at > now() + interval '63 minutes'
      and private.session_calendar_ready(s.id)
    order by s.start_at
    for update of s
  loop
    v_used := private.session_occupied_seats(v_session.id);

    v_slots := greatest(v_session.capacity - v_used, 0);

    for v_entry in
      select w.*
      from public.waitlist_entries w
      where w.session_id = v_session.id and w.status = 'waiting'
      order by w.joined_at, w.id
      limit v_slots
      for update skip locked
    loop
      v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
      v_token_hash := encode(extensions.digest(v_raw_token, 'sha256'), 'hex');
      v_offer_expires_at := least(
        now() + interval '24 hours',
        v_session.start_at - interval '32 minutes'
      );

      update public.waitlist_entries
         set status = 'offered',
             offered_at = now(),
             offer_expires_at = v_offer_expires_at,
             updated_at = now()
       where id = v_entry.id;

      insert into private.waitlist_offers (
        waitlist_entry_id, token_hash, status, expires_at
      ) values (
        v_entry.id, v_token_hash, 'active', v_offer_expires_at
      );

      insert into private.seat_holds (
        session_id, user_id, waitlist_entry_id, source, status, expires_at
      ) values (
        v_session.id, v_entry.user_id, v_entry.id, 'waitlist', 'active', v_offer_expires_at
      )
      on conflict (session_id, user_id) do update
        set waitlist_entry_id = excluded.waitlist_entry_id,
            source = 'waitlist',
            status = 'active',
            expires_at = excluded.expires_at,
            updated_at = now();

      perform private.enqueue_job(
        'email',
        jsonb_build_object(
          'template', 'waitlist_offer',
          'to', v_entry.email,
          'full_name', v_entry.full_name,
          'course_title', v_session.course_title,
          'session_id', v_session.id,
          'start_at', v_session.start_at,
          'timezone', v_session.timezone,
          'offer_token', v_raw_token,
          'offer_expires_at', v_offer_expires_at
        ),
        'waitlist-offer:' || v_entry.id::text || ':' || extract(epoch from now())::bigint::text
      );

      insert into private.analytics_events (
        event_name, user_id, page_path, properties, occurred_at
      ) values (
        'waitlist_offer_created',
        v_entry.user_id,
        '/operations/waitlist',
        jsonb_build_object('session_id', v_session.id, 'source', 'automatic'),
        now()
      );

      v_promoted := v_promoted + 1;
    end loop;

    v_used := private.session_occupied_seats(v_session.id);

    update public.workshop_sessions
       set status = case when v_used >= capacity then 'sold_out' else 'scheduled' end,
           updated_at = now()
     where id = v_session.id;
  end loop;

  return jsonb_build_object(
    'expired_holds', v_expired_holds,
    'expired_offers', v_expired_offers,
    'stale_payment_pending', v_stale_payment_pending,
    'rate_limit_entries_deleted', v_rate_limit_entries_deleted,
    'promoted_waitlist_entries', v_promoted,
    'ran_at', now()
  );
end;
$$;

revoke execute on function public.run_booking_maintenance()
  from public, anon, authenticated;
grant execute on function public.run_booking_maintenance()
  to service_role;

create or replace function public.claim_automation_jobs(
  p_worker_id text,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with messages as materialized (
    select *
    from pgmq.read(
      queue_name => 'clearstep_automation',
      vt => 600,
      qty => greatest(1, least(p_limit, 50))
    )
  ), claimed as (
    update private.automation_jobs j
       set status = 'processing',
           attempts = attempts + 1,
           locked_at = now(),
           locked_by = left(p_worker_id, 200),
           pgmq_message_id = m.msg_id,
           updated_at = now()
      from messages m
     where j.id = (m.message ->> 'job_id')::uuid
       and j.status = 'pending'
       and j.available_at <= now()
    returning j.id, j.job_type, j.payload, j.attempts, j.max_attempts,
      j.pgmq_message_id, j.created_at
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by claimed.created_at), '[]'::jsonb)
  into v_result
  from claimed;

  return v_result;
end;
$$;

revoke execute on function public.claim_automation_jobs(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_automation_jobs(text, integer)
  to service_role;

create or replace function public.complete_automation_job(
  p_job_id uuid,
  p_worker_id text,
  p_success boolean,
  p_output jsonb default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_next_status text;
  v_integration text;
  v_recipient text;
  v_retry_delay integer;
begin
  select * into v_job
  from private.automation_jobs
  where id = p_job_id and status = 'processing' and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  if p_success then
    v_next_status := 'completed';
    update private.automation_jobs
       set status = 'completed',
           output = p_output,
           last_error = null,
           completed_at = now(),
           locked_at = null,
           locked_by = null,
           updated_at = now()
     where id = p_job_id;

    if v_job.job_type in ('calendar_session', 'calendar_enrollment') and p_output is not null then
      insert into private.session_integrations (session_id, google_event_id, meet_url)
      values (
        (v_job.payload ->> 'session_id')::uuid,
        nullif(p_output ->> 'google_event_id', ''),
        nullif(p_output ->> 'meet_url', '')
      )
      on conflict (session_id) do update
        set google_event_id = coalesce(excluded.google_event_id, private.session_integrations.google_event_id),
            meet_url = coalesce(excluded.meet_url, private.session_integrations.meet_url),
            updated_at = now();
    end if;

    if v_job.pgmq_message_id is null
       or not pgmq.archive('clearstep_automation', v_job.pgmq_message_id) then
      raise exception using errcode = 'P0001', message = 'automation_queue_archive_failed';
    end if;
  else
    v_next_status := case when v_job.attempts >= v_job.max_attempts then 'failed' else 'pending' end;
    v_retry_delay := least(3600, power(2, v_job.attempts)::integer * 30);
    update private.automation_jobs
       set status = v_next_status,
           last_error = left(coalesce(p_error, 'unknown_worker_error'), 2000),
           output = p_output,
           available_at = case
             when v_next_status = 'pending'
               then now() + make_interval(secs => v_retry_delay)
             else available_at
           end,
           locked_at = null,
           locked_by = null,
           updated_at = now()
     where id = p_job_id;

    if v_job.pgmq_message_id is null then
      raise exception using errcode = 'P0001', message = 'automation_queue_message_missing';
    elsif v_next_status = 'failed' then
      if not pgmq.archive('clearstep_automation', v_job.pgmq_message_id) then
        raise exception using errcode = 'P0001', message = 'automation_queue_archive_failed';
      end if;
    else
      perform pgmq.set_vt('clearstep_automation', v_job.pgmq_message_id, v_retry_delay);
    end if;
  end if;

  if v_job.job_type = 'email' then
    v_recipient := nullif(coalesce(p_output ->> 'recipient', v_job.payload ->> 'to'), '');
    if v_recipient is not null then
      insert into private.email_deliveries (
        automation_job_id,
        template,
        recipient,
        status,
        provider_message_id,
        attempts,
        last_error,
        sent_at
      ) values (
        v_job.id,
        coalesce(nullif(p_output ->> 'template', ''), v_job.payload ->> 'template'),
        v_recipient,
        case when p_success then 'sent' when v_next_status = 'failed' then 'failed' else 'retrying' end,
        nullif(p_output ->> 'message_id', ''),
        v_job.attempts,
        case when p_success then null else left(coalesce(p_error, 'unknown_worker_error'), 2000) end,
        case when p_success then now() else null end
      )
      on conflict (automation_job_id) do update
        set template = excluded.template,
            recipient = excluded.recipient,
            status = excluded.status,
            provider_message_id = coalesce(excluded.provider_message_id, private.email_deliveries.provider_message_id),
            attempts = excluded.attempts,
            last_error = excluded.last_error,
            sent_at = coalesce(private.email_deliveries.sent_at, excluded.sent_at),
            updated_at = now();
    end if;
    v_integration := 'google_gmail';
  elsif v_job.job_type in ('calendar_session', 'calendar_enrollment', 'calendar_enrollment_remove') then
    v_integration := 'google_calendar';
  end if;

  if v_integration is not null then
    perform public.record_integration_health(
      v_integration,
      p_success,
      case when p_success then null else p_error end,
      jsonb_build_object('job_id', v_job.id, 'job_type', v_job.job_type)
    );
  end if;

  return jsonb_build_object('job_id', p_job_id, 'status', v_next_status);
end;
$$;

revoke execute on function public.complete_automation_job(uuid, text, boolean, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.complete_automation_job(uuid, text, boolean, jsonb, text)
  to service_role;
