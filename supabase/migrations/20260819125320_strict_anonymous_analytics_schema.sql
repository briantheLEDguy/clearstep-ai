-- The consent migration stopped writing legacy telemetry, but the old table
-- shape still advertised account, route, referrer, campaign, and arbitrary
-- JSON fields. Remove that dormant surface rather than relying on a CHECK
-- constraint to keep it empty. Browser analytics remains a deliberately small
-- anonymous event model: consent, a per-tab identifier, event type, an optional
-- first-party course ID, a constrained source, and timestamps.

alter table private.analytics_events
  add column course_id uuid references public.courses(id) on delete restrict;

-- Existing consented rows can only contain `{}` or a first-party course ID
-- after the preceding migration. Discard an invalid course-view row instead
-- of weakening the new FK-backed model for an unreportable legacy value.
delete from private.analytics_events as analytics_event
where analytics_event.event_name = 'course_view'
  and not exists (
    select 1
    from public.courses course
    where course.id::text = analytics_event.properties ->> 'course_id'
  );

update private.analytics_events as analytics_event
set course_id = course.id
from public.courses course
where course.id::text = analytics_event.properties ->> 'course_id';

-- Replace all live readers/writers before dropping the legacy columns so
-- PostgreSQL cannot retain a function dependency on a removed field.
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
    utm_source,
    course_id,
    occurred_at,
    consent_id
  ) values (
    p_event_name,
    p_anonymous_id::uuid,
    p_utm_source,
    v_course_id,
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
    unique_anonymous_visitors,
    distinct_consent_count
  )
  select
    (analytics_event.occurred_at at time zone 'Europe/Amsterdam')::date,
    analytics_event.event_name,
    '',
    count(*),
    count(distinct analytics_event.anonymous_id),
    count(distinct analytics_event.consent_id)
  from private.analytics_events analytics_event
  where analytics_event.occurred_at >= v_raw_start_at
  group by 1, 2
  having count(distinct analytics_event.consent_id) >= 20
  on conflict (day, event_name, dimension) do update
    set event_count = excluded.event_count,
        unique_anonymous_visitors = excluded.unique_anonymous_visitors,
        distinct_consent_count = excluded.distinct_consent_count,
        updated_at = now();

  get diagnostics v_aggregated = row_count;

  insert into private.analytics_daily (
    day,
    event_name,
    dimension,
    event_count,
    unique_anonymous_visitors,
    distinct_consent_count
  )
  select
    (analytics_event.occurred_at at time zone 'Europe/Amsterdam')::date,
    'page_view_utm_source',
    left(lower(trim(analytics_event.utm_source)), 200),
    count(*),
    count(distinct analytics_event.anonymous_id),
    count(distinct analytics_event.consent_id)
  from private.analytics_events analytics_event
  where analytics_event.event_name = 'page_view'
    and nullif(trim(analytics_event.utm_source), '') is not null
    and analytics_event.occurred_at >= v_raw_start_at
  group by 1, left(lower(trim(analytics_event.utm_source)), 200)
  having count(distinct analytics_event.consent_id) >= 20
  on conflict (day, event_name, dimension) do update
    set event_count = excluded.event_count,
        unique_anonymous_visitors = excluded.unique_anonymous_visitors,
        distinct_consent_count = excluded.distinct_consent_count,
        updated_at = now();

  get diagnostics v_utm_aggregated = row_count;

  insert into private.analytics_daily (
    day,
    event_name,
    dimension,
    event_count,
    unique_anonymous_visitors,
    distinct_consent_count
  )
  select
    (analytics_event.occurred_at at time zone 'Europe/Amsterdam')::date,
    'course_view',
    course.id::text,
    count(*),
    count(distinct analytics_event.anonymous_id),
    count(distinct analytics_event.consent_id)
  from private.analytics_events analytics_event
  join public.courses course on course.id = analytics_event.course_id
  where analytics_event.event_name = 'course_view'
    and analytics_event.occurred_at >= v_raw_start_at
  group by 1, course.id
  having count(distinct analytics_event.consent_id) >= 20
  on conflict (day, event_name, dimension) do update
    set event_count = excluded.event_count,
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
    select analytics_day.dimension as course_id, sum(analytics_day.event_count)::bigint as views
    from private.analytics_daily analytics_day
    cross join bounds bound
    where analytics_day.event_name = 'course_view'
      and analytics_day.dimension <> ''
      and analytics_day.distinct_consent_count >= 20
      and analytics_day.day >= (p_from at time zone 'Europe/Amsterdam')::date
      and analytics_day.day < least(
        (p_to at time zone 'Europe/Amsterdam')::date,
        bound.raw_start_day
      )
    group by analytics_day.dimension
  ), raw_counts as (
    select analytics_event.course_id::text as course_id, count(*)::bigint as views
    from private.analytics_events analytics_event
    cross join bounds bound
    where analytics_event.event_name = 'course_view'
      and analytics_event.course_id is not null
      and analytics_event.occurred_at >= greatest(p_from, bound.raw_start_at)
      and analytics_event.occurred_at < p_to
    group by analytics_event.course_id
    having count(distinct analytics_event.consent_id) >= 20
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

alter table private.analytics_events
  drop constraint if exists analytics_consent_events_anonymous,
  drop constraint if exists analytics_properties_object;

drop index if exists private.analytics_events_user_id_idx;

alter table private.analytics_events
  drop column user_id,
  drop column page_path,
  drop column referrer,
  drop column utm_medium,
  drop column utm_campaign,
  drop column properties;

alter table private.analytics_events
  add constraint analytics_consent_events_anonymous check (
    anonymous_id is not null
    and event_name in ('page_view', 'course_view')
    and (
      (event_name = 'page_view' and course_id is null)
      or (event_name = 'course_view' and course_id is not null)
    )
    and (utm_source is null or utm_source ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
  );

-- `unique_users` was a legacy account-linked metric. It is not populated in
-- the consent-only model and is removed alongside the account field rather
-- than retaining a misleading zero-filled aggregate column.
alter table private.analytics_daily
  drop constraint if exists analytics_daily_counts_nonnegative,
  drop column unique_users,
  add constraint analytics_daily_counts_nonnegative check (
    event_count >= 0
    and unique_anonymous_visitors >= 0
    and distinct_consent_count >= 0
  );
