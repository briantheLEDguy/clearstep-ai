-- Consent-gated browser analytics deliberately remains separate from operational
-- booking/account events. It has no user, URL, referrer, or device fields.
create table private.analytics_consents (
  id uuid primary key default extensions.gen_random_uuid(),
  policy_version text not null,
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  expires_at timestamptz not null,
  constraint analytics_consents_policy_version_length check (char_length(policy_version) between 1 and 80),
  constraint analytics_consents_expiry_after_grant check (expires_at > granted_at)
);

create index analytics_consents_retention_idx
  on private.analytics_consents (expires_at, withdrawn_at);

alter table private.analytics_consents enable row level security;
revoke all on private.analytics_consents from public, anon, authenticated;
grant select, insert, update, delete on private.analytics_consents to service_role;

alter table private.analytics_events
  add column consent_id uuid references private.analytics_consents(id) on delete cascade;

alter table private.analytics_daily
  add column distinct_consent_count integer not null default 0
  check (distinct_consent_count >= 0);

create index analytics_events_consent_occurred_idx
  on private.analytics_events (consent_id, occurred_at desc)
  where consent_id is not null;

-- The legacy table combined browser telemetry with operational events and had
-- no affirmative-consent record. Clear it completely: operations are derived
-- from authoritative transactional tables, and only new consented browser data
-- may enter this table.
delete from private.analytics_events;

delete from private.analytics_daily;

delete from private.analytics_rate_limits;

alter table private.analytics_events
  alter column consent_id set not null;

-- A browser analytics event must remain anonymous and contain only the
-- server-made course identifier (when it is a course view), never a route or
-- referrer. This table no longer accepts operational telemetry.
alter table private.analytics_events
  add constraint analytics_consent_events_anonymous check (
    anonymous_id is not null
    and event_name in ('page_view', 'course_view')
    and user_id is null
    and page_path is null
    and referrer is null
    and utm_medium is null
    and utm_campaign is null
    and properties - 'course_id' = '{}'::jsonb
    and (
      (event_name = 'page_view' and properties = '{}'::jsonb)
      or (event_name = 'course_view' and properties ? 'course_id')
    )
    and (utm_source is null or utm_source ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
  );

-- Older RPC definitions may still be in flight while this migration is applied.
-- Discard their former operational telemetry rather than failing a booking or
-- permitting a consent-less row. The replacement analytics RPC below is the
-- only writer that returns a row from this table.
create or replace function private.discard_legacy_analytics_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.consent_id is null
     or not exists (
       select 1
       from private.analytics_consents consent
       where consent.id = new.consent_id
         and consent.withdrawn_at is null
         and consent.expires_at > now()
     ) then
    return null;
  end if;
  return new;
end;
$$;

create trigger analytics_events_require_consent
before insert on private.analytics_events
for each row
execute function private.discard_legacy_analytics_event();

-- Replace every legacy RPC body that mixed operational telemetry into this
-- table. Using PostgreSQL's rendered definition preserves the business logic,
-- permissions, and signatures while removing only the obsolete INSERT
-- statements; fail closed if an expected writer was not found or changed.
do $$
declare
  v_procedure regprocedure;
  v_definition text;
  v_redefined text;
  v_count integer := 0;
begin
  for v_procedure in
    select procedure.oid::regprocedure
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname = any(array[
        'create_checkout_hold',
        'join_session_waitlist',
        'submit_private_workshop_request',
        'process_stripe_event',
        'staff_admin_action',
        'run_booking_maintenance'
      ]::text[])
  loop
    v_count := v_count + 1;
    v_definition := pg_get_functiondef(v_procedure::oid);
    v_redefined := regexp_replace(
      v_definition,
      E'[[:space:]]*insert[[:space:]]+into[[:space:]]+private\\.analytics_events[[:space:]]*\\([^;]*;',
      E'',
      'gi'
    );
    if v_redefined = v_definition then
      raise exception using errcode = 'P0001', message = 'legacy_analytics_writer_not_removed';
    end if;
    if v_redefined ~* E'insert[[:space:]]+into[[:space:]]+private\\.analytics_events' then
      raise exception using errcode = 'P0001', message = 'legacy_analytics_writer_remaining';
    end if;
    execute v_redefined;
  end loop;

  if v_count <> 6 then
    raise exception using errcode = 'P0001', message = 'legacy_analytics_writer_missing';
  end if;
end;
$$;

revoke execute on function private.discard_legacy_analytics_event()
  from public, anon, authenticated, service_role;

drop function public.ingest_analytics_event(text, text, uuid, text, text, text, text, text, text, jsonb, timestamptz);

create or replace function public.analytics_consent_active(p_consent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.analytics_consents consent
    where consent.id = p_consent_id
      and consent.withdrawn_at is null
      and consent.expires_at > now()
  );
$$;

revoke execute on function public.analytics_consent_active(uuid)
  from public, anon, authenticated;
grant execute on function public.analytics_consent_active(uuid)
  to service_role;

create or replace function public.grant_analytics_consent(
  p_policy_version text,
  p_abuse_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consent private.analytics_consents;
  v_rate_count integer;
begin
  if p_policy_version is distinct from '2026-08-19'
     or p_abuse_hash is null
     or p_abuse_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invalid_analytics_consent';
  end if;

  insert into private.analytics_rate_limits (
    abuse_hash,
    event_count,
    window_started_at,
    expires_at
  ) values (
    p_abuse_hash,
    1,
    now(),
    now() + interval '20 minutes'
  )
  on conflict (abuse_hash) do update
    set event_count = case
          when private.analytics_rate_limits.expires_at <= now() then 1
          else private.analytics_rate_limits.event_count + 1
        end,
        window_started_at = case
          when private.analytics_rate_limits.expires_at <= now() then now()
          else private.analytics_rate_limits.window_started_at
        end,
        expires_at = now() + interval '20 minutes',
        updated_at = now()
  returning event_count into v_rate_count;

  if v_rate_count > 20 then
    raise exception using errcode = 'P0001', message = 'analytics_rate_limited';
  end if;

  insert into private.analytics_consents (policy_version, expires_at)
  values (p_policy_version, now() + interval '180 days')
  returning * into v_consent;

  return jsonb_build_object(
    'consent_id', v_consent.id,
    'expires_at', v_consent.expires_at
  );
end;
$$;

revoke execute on function public.grant_analytics_consent(text, text)
  from public, anon, authenticated;
grant execute on function public.grant_analytics_consent(text, text)
  to service_role;

create or replace function public.withdraw_analytics_consent(p_consent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_withdrawn boolean := false;
  v_events_deleted integer;
begin
  update private.analytics_consents
     set withdrawn_at = coalesce(withdrawn_at, now())
   where id = p_consent_id
     and withdrawn_at is null
  returning true into v_withdrawn;

  delete from private.analytics_events
  where consent_id = p_consent_id;
  get diagnostics v_events_deleted = row_count;

  return jsonb_build_object(
    'withdrawn', coalesce(v_withdrawn, false),
    'events_deleted', v_events_deleted
  );
end;
$$;

revoke execute on function public.withdraw_analytics_consent(uuid)
  from public, anon, authenticated;
grant execute on function public.withdraw_analytics_consent(uuid)
  to service_role;

create or replace function public.ingest_analytics_event(
  p_consent_id uuid,
  p_anonymous_id text,
  p_event_name text,
  p_course_slug text,
  p_utm_source text,
  p_abuse_hash text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
  v_rate_count integer;
  v_course_id uuid;
begin
  if p_consent_id is null
     or p_anonymous_id is null
     or p_anonymous_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or p_event_name is null
     or not (p_event_name = any(array['page_view', 'course_view']::text[]))
     or p_abuse_hash is null
     or p_abuse_hash !~ '^[0-9a-f]{64}$'
     or p_occurred_at < now() - interval '7 days'
     or p_occurred_at > now() + interval '5 minutes'
     or (p_utm_source is not null and p_utm_source !~ '^[a-z0-9][a-z0-9_-]{0,63}$') then
    raise exception using errcode = 'P0001', message = 'invalid_analytics_event';
  end if;

  if not public.analytics_consent_active(p_consent_id) then
    return jsonb_build_object('accepted', false);
  end if;

  if p_event_name = 'course_view' then
    if p_course_slug is null or p_course_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
      raise exception using errcode = 'P0001', message = 'invalid_analytics_course';
    end if;

    select course.id into v_course_id
    from public.courses course
    where course.slug = p_course_slug
    limit 1;

    if v_course_id is null then
      raise exception using errcode = 'P0001', message = 'course_not_found';
    end if;
  elsif p_course_slug is not null then
    raise exception using errcode = 'P0001', message = 'invalid_analytics_course';
  end if;

  insert into private.analytics_rate_limits (
    abuse_hash,
    event_count,
    window_started_at,
    expires_at
  ) values (
    p_abuse_hash,
    1,
    now(),
    now() + interval '20 minutes'
  )
  on conflict (abuse_hash) do update
    set event_count = case
          when private.analytics_rate_limits.expires_at <= now() then 1
          else private.analytics_rate_limits.event_count + 1
        end,
        window_started_at = case
          when private.analytics_rate_limits.expires_at <= now() then now()
          else private.analytics_rate_limits.window_started_at
        end,
        expires_at = now() + interval '20 minutes',
        updated_at = now()
  returning event_count into v_rate_count;

  if v_rate_count > 120 then
    raise exception using errcode = 'P0001', message = 'analytics_rate_limited';
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
    occurred_at,
    consent_id
  ) values (
    p_event_name,
    p_anonymous_id::uuid,
    null,
    null,
    null,
    p_utm_source,
    null,
    null,
    case
      when v_course_id is null then '{}'::jsonb
      else jsonb_build_object('course_id', v_course_id)
    end,
    p_occurred_at,
    p_consent_id
  )
  returning id into v_event_id;

  return jsonb_build_object('event_id', v_event_id, 'accepted', true);
end;
$$;

revoke execute on function public.ingest_analytics_event(uuid, text, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_analytics_event(uuid, text, text, text, text, text, timestamptz)
  to service_role;

-- Retain consented browser events for 30 days, then retain only k-anonymous
-- daily aggregates for 12 months. No aggregate is stored for fewer than 20
-- distinct consent IDs.
create or replace function public.rollup_and_retain_analytics()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aggregated bigint;
  v_utm_aggregated bigint;
  v_course_aggregated bigint;
  v_raw_deleted bigint;
  v_daily_deleted bigint;
  v_raw_start_day date := (now() at time zone 'Europe/Amsterdam')::date - 29;
  v_raw_start_at timestamptz := v_raw_start_day::timestamp at time zone 'Europe/Amsterdam';
begin
  delete from private.analytics_daily
  where day >= v_raw_start_day
    and event_name in ('page_view', 'course_view', 'page_view_utm_source');

  insert into private.analytics_daily (
    day,
    event_name,
    dimension,
    event_count,
    unique_users,
    unique_anonymous_visitors,
    distinct_consent_count
  )
  select
    (ae.occurred_at at time zone 'Europe/Amsterdam')::date,
    ae.event_name,
    '',
    count(*),
    count(distinct ae.user_id),
    count(distinct ae.anonymous_id),
    count(distinct ae.consent_id)
  from private.analytics_events ae
  where ae.occurred_at >= v_raw_start_at
  group by 1, 2
  having count(distinct ae.consent_id) >= 20
  on conflict (day, event_name, dimension) do update
    set event_count = excluded.event_count,
        unique_users = excluded.unique_users,
        unique_anonymous_visitors = excluded.unique_anonymous_visitors,
        distinct_consent_count = excluded.distinct_consent_count,
        updated_at = now();

  get diagnostics v_aggregated = row_count;

  insert into private.analytics_daily (
    day,
    event_name,
    dimension,
    event_count,
    unique_users,
    unique_anonymous_visitors,
    distinct_consent_count
  )
  select
    (ae.occurred_at at time zone 'Europe/Amsterdam')::date,
    'page_view_utm_source',
    left(lower(trim(ae.utm_source)), 200),
    count(*),
    count(distinct ae.user_id),
    count(distinct ae.anonymous_id),
    count(distinct ae.consent_id)
  from private.analytics_events ae
  where ae.event_name = 'page_view'
    and nullif(trim(ae.utm_source), '') is not null
    and ae.occurred_at >= v_raw_start_at
  group by 1, left(lower(trim(ae.utm_source)), 200)
  having count(distinct ae.consent_id) >= 20
  on conflict (day, event_name, dimension) do update
    set event_count = excluded.event_count,
        unique_users = excluded.unique_users,
        unique_anonymous_visitors = excluded.unique_anonymous_visitors,
        distinct_consent_count = excluded.distinct_consent_count,
        updated_at = now();

  get diagnostics v_utm_aggregated = row_count;

  insert into private.analytics_daily (
    day,
    event_name,
    dimension,
    event_count,
    unique_users,
    unique_anonymous_visitors,
    distinct_consent_count
  )
  select
    (ae.occurred_at at time zone 'Europe/Amsterdam')::date,
    'course_view',
    course.id::text,
    count(*),
    count(distinct ae.user_id),
    count(distinct ae.anonymous_id),
    count(distinct ae.consent_id)
  from private.analytics_events ae
  join public.courses course
    on course.id::text = nullif(ae.properties ->> 'course_id', '')
    or (
      nullif(ae.properties ->> 'course_id', '') is null
      and course.slug = nullif(ae.properties ->> 'course_slug', '')
    )
  where ae.event_name = 'course_view'
    and ae.occurred_at >= v_raw_start_at
  group by 1, course.id
  having count(distinct ae.consent_id) >= 20
  on conflict (day, event_name, dimension) do update
    set event_count = excluded.event_count,
        unique_users = excluded.unique_users,
        unique_anonymous_visitors = excluded.unique_anonymous_visitors,
        distinct_consent_count = excluded.distinct_consent_count,
        updated_at = now();

  get diagnostics v_course_aggregated = row_count;

  delete from private.analytics_events
  where occurred_at < now() - interval '30 days';
  get diagnostics v_raw_deleted = row_count;

  delete from private.analytics_daily
  where day < (
    (now() at time zone 'Europe/Amsterdam')::date - interval '12 months'
  )::date;
  get diagnostics v_daily_deleted = row_count;

  return jsonb_build_object(
    'aggregated_rows', v_aggregated + v_utm_aggregated + v_course_aggregated,
    'utm_dimension_rows', v_utm_aggregated,
    'course_dimension_rows', v_course_aggregated,
    'raw_events_deleted', v_raw_deleted,
    'daily_rows_deleted', v_daily_deleted,
    'ran_at', now()
  );
end;
$$;

revoke execute on function public.rollup_and_retain_analytics()
  from public, anon, authenticated;
grant execute on function public.rollup_and_retain_analytics()
  to service_role;

create or replace function private.analytics_event_count(
  p_event_name text,
  p_from timestamptz,
  p_to timestamptz
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw_start_day date := (now() at time zone 'Europe/Amsterdam')::date - 29;
  v_raw_start_at timestamptz := v_raw_start_day::timestamp at time zone 'Europe/Amsterdam';
  v_daily_count bigint;
  v_raw_count bigint;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    return 0;
  end if;

  -- Operational checkout starts are derived from their transactional record,
  -- never from the consented browser analytics table.
  if p_event_name = 'checkout_started' then
    select count(*) into v_raw_count
    from private.checkout_attempts checkout_attempt
    where checkout_attempt.created_at >= p_from
      and checkout_attempt.created_at < p_to;
    return coalesce(v_raw_count, 0);
  end if;

  if p_event_name not in ('page_view', 'course_view') then
    return 0;
  end if;

  select coalesce(sum(ad.event_count), 0)
  into v_daily_count
  from private.analytics_daily ad
  where ad.event_name = p_event_name
    and ad.dimension = ''
    and ad.distinct_consent_count >= 20
    and ad.day >= (p_from at time zone 'Europe/Amsterdam')::date
    and ad.day < least(
      (p_to at time zone 'Europe/Amsterdam')::date,
      v_raw_start_day
    );

  select coalesce(count(*), 0)
  into v_raw_count
  from private.analytics_events ae
  where ae.event_name = p_event_name
    and ae.occurred_at >= greatest(p_from, v_raw_start_at)
    and ae.occurred_at < p_to
  having count(distinct ae.consent_id) >= 20;

  return coalesce(v_daily_count, 0) + coalesce(v_raw_count, 0);
end;
$$;

revoke execute on function private.analytics_event_count(text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.analytics_top_courses(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 10
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      ((now() at time zone 'Europe/Amsterdam')::date - 29) as raw_start_day,
      (((now() at time zone 'Europe/Amsterdam')::date - 29)::timestamp
        at time zone 'Europe/Amsterdam') as raw_start_at
  ), daily_counts as (
    select ad.dimension as course_id, sum(ad.event_count)::bigint as views
    from private.analytics_daily ad
    cross join bounds b
    where ad.event_name = 'course_view'
      and ad.dimension <> ''
      and ad.distinct_consent_count >= 20
      and ad.day >= (p_from at time zone 'Europe/Amsterdam')::date
      and ad.day < least(
        (p_to at time zone 'Europe/Amsterdam')::date,
        b.raw_start_day
      )
    group by ad.dimension
  ), raw_counts as (
    select (ae.properties ->> 'course_id') as course_id, count(*)::bigint as views
    from private.analytics_events ae
    cross join bounds b
    where ae.event_name = 'course_view'
      and ae.occurred_at >= greatest(p_from, b.raw_start_at)
      and ae.occurred_at < p_to
    group by ae.properties ->> 'course_id'
    having count(distinct ae.consent_id) >= 20
  ), combined as (
    select counts.course_id, sum(counts.views)::bigint as views
    from (
      select * from daily_counts
      union all
      select * from raw_counts
    ) counts
    group by counts.course_id
  ), ranked as (
    select
      course.id as course_id,
      course.slug as course_slug,
      course.title as course_title,
      combined.views
    from combined
    join public.courses course on course.id::text = combined.course_id
    order by combined.views desc, course.title
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'course_id', ranked.course_id,
        'course_slug', ranked.course_slug,
        'course_title', ranked.course_title,
        'views', ranked.views
      )
      order by ranked.views desc, ranked.course_title
    ),
    '[]'::jsonb
  )
  from ranked;
$$;

revoke execute on function private.analytics_top_courses(timestamptz, timestamptz, integer)
  from public, anon, authenticated, service_role;

create or replace function private.analytics_utm_sources(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 10
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      ((now() at time zone 'Europe/Amsterdam')::date - 29) as raw_start_day,
      (((now() at time zone 'Europe/Amsterdam')::date - 29)::timestamp
        at time zone 'Europe/Amsterdam') as raw_start_at
  ), daily_counts as (
    select ad.dimension as source, sum(ad.event_count)::bigint as visits
    from private.analytics_daily ad
    cross join bounds b
    where ad.event_name = 'page_view_utm_source'
      and ad.dimension <> ''
      and ad.distinct_consent_count >= 20
      and ad.day >= (p_from at time zone 'Europe/Amsterdam')::date
      and ad.day < least((p_to at time zone 'Europe/Amsterdam')::date, b.raw_start_day)
    group by ad.dimension
  ), raw_counts as (
    select left(lower(trim(ae.utm_source)), 200) as source, count(*)::bigint as visits
    from private.analytics_events ae
    cross join bounds b
    where ae.event_name = 'page_view'
      and nullif(trim(ae.utm_source), '') is not null
      and ae.occurred_at >= greatest(p_from, b.raw_start_at)
      and ae.occurred_at < p_to
    group by left(lower(trim(ae.utm_source)), 200)
    having count(distinct ae.consent_id) >= 20
  ), combined as (
    select counts.source, sum(counts.visits)::bigint as visits
    from (
      select * from daily_counts
      union all
      select * from raw_counts
    ) counts
    group by counts.source
    order by visits desc, counts.source
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('source', combined.source, 'visits', combined.visits)
      order by combined.visits desc, combined.source
    ),
    '[]'::jsonb
  )
  from combined;
$$;

revoke execute on function private.analytics_utm_sources(timestamptz, timestamptz, integer)
  from public, anon, authenticated, service_role;

create or replace function private.purge_runtime_security_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limits_deleted integer;
  v_analytics_events_deleted integer;
  v_analytics_consents_deleted integer;
  v_leases_deleted integer;
  v_payloads_redacted integer;
begin
  delete from private.analytics_rate_limits
  where expires_at <= now();
  get diagnostics v_rate_limits_deleted = row_count;

  delete from private.analytics_events as analytics_event
  using private.analytics_consents consent
  where analytics_event.consent_id = consent.id
    and (consent.withdrawn_at is not null or consent.expires_at <= now());
  get diagnostics v_analytics_events_deleted = row_count;

  delete from private.analytics_consents
  where (withdrawn_at is not null and withdrawn_at <= now() - interval '30 days')
     or expires_at <= now() - interval '30 days';
  get diagnostics v_analytics_consents_deleted = row_count;

  delete from private.calendar_session_leases
  where expires_at <= now();
  get diagnostics v_leases_deleted = row_count;

  update private.automation_jobs
     set payload = private.redact_automation_payload(payload),
         updated_at = now()
   where job_type = 'email'
     and payload ?| array['invite_url', 'offer_token', 'payment_url', 'quote_token', 'checkout_token']
     and (
       status in ('completed', 'cancelled')
       or created_at <= now() - interval '31 days'
       or (
         payload ->> 'template' = 'staff_invite'
         and nullif(payload ->> 'expires_at', '')::timestamptz <= now()
       )
       or (
         payload ->> 'template' = 'waitlist_offer'
         and nullif(payload ->> 'offer_expires_at', '')::timestamptz <= now()
       )
       or (
         payload ->> 'template' = 'private_quote'
         and nullif(payload ->> 'valid_until', '')::date < current_date
       )
     );
  get diagnostics v_payloads_redacted = row_count;

  return jsonb_build_object(
    'analytics_rate_limits_deleted', v_rate_limits_deleted,
    'consented_analytics_events_deleted', v_analytics_events_deleted,
    'analytics_consents_deleted', v_analytics_consents_deleted,
    'calendar_leases_deleted', v_leases_deleted,
    'sensitive_payloads_redacted', v_payloads_redacted,
    'ran_at', now()
  );
end;
$$;

revoke execute on function private.purge_runtime_security_state()
  from public, anon, authenticated, service_role;
