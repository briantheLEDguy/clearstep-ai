create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pgmq;

revoke all on schema pgmq from public, anon, authenticated;
grant usage on schema pgmq to service_role;

do $$
begin
  if to_regclass('pgmq.q_clearstep_automation') is null then
    perform pgmq.create('clearstep_automation');
  end if;
end;
$$;

create table private.session_integrations (
  session_id uuid primary key references public.workshop_sessions(id) on delete cascade,
  google_event_id text unique,
  meet_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_integrations_event_format check (
    google_event_id is null or google_event_id ~ '^[A-Za-z0-9_-]+$'
  ),
  constraint session_integrations_meet_url_https check (
    meet_url is null or meet_url ~ '^https://'
  )
);

create index session_integrations_event_idx on private.session_integrations (google_event_id)
  where google_event_id is not null;

create or replace function private.session_calendar_ready(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workshop_sessions s
    join private.session_integrations si on si.session_id = s.id
    where s.id = p_session_id
      and si.google_event_id is not null
      and (s.format = 'in_person' or si.meet_url is not null)
  );
$$;

revoke execute on function private.session_calendar_ready(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.session_occupied_seats(
  p_session_id uuid,
  p_exclude_user_id uuid default null
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from (
    select e.user_id
    from public.enrollments e
    where e.session_id = p_session_id
      and e.status in ('pending_payment', 'confirmed')
    union
    select h.user_id
    from private.seat_holds h
    where h.session_id = p_session_id
      and h.status = 'active'
      and h.expires_at > now()
    union
    select ca.user_id
    from private.checkout_attempts ca
    where ca.session_id = p_session_id
      and ca.status in ('open', 'payment_pending')
      and ca.stripe_checkout_session_id is not null
      and ca.grace_expires_at > now()
  ) occupied
  where p_exclude_user_id is null or occupied.user_id <> p_exclude_user_id;
$$;

revoke execute on function private.session_occupied_seats(uuid, uuid)
  from public, anon, authenticated, service_role;

create table private.payment_records (
  id uuid primary key default gen_random_uuid(),
  checkout_attempt_id uuid references private.checkout_attempts(id) on delete set null,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  stripe_payment_intent_id text not null unique,
  stripe_checkout_session_id text,
  stripe_charge_id text unique,
  amount_cents integer not null,
  amount_refunded_cents integer not null default 0,
  currency text not null default 'EUR',
  status text not null,
  last_stripe_event_id text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_records_payment_intent_format check (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  constraint payment_records_checkout_format check (stripe_checkout_session_id is null or stripe_checkout_session_id ~ '^cs_(test_|live_)?[A-Za-z0-9]+$'),
  constraint payment_records_charge_format check (stripe_charge_id is null or stripe_charge_id ~ '^ch_[A-Za-z0-9]+$'),
  constraint payment_records_amount_positive check (amount_cents > 0),
  constraint payment_records_refund_amount_valid check (amount_refunded_cents >= 0 and amount_refunded_cents <= amount_cents),
  constraint payment_records_currency_eur check (currency = 'EUR'),
  constraint payment_records_status_valid check (status in ('pending', 'paid', 'failed', 'mismatch', 'requires_refund', 'partially_refunded', 'refunded'))
);

create unique index payment_records_checkout_session_idx
  on private.payment_records (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;
create index payment_records_enrollment_idx on private.payment_records (enrollment_id)
  where enrollment_id is not null;
create index payment_records_checkout_attempt_id_idx on private.payment_records (checkout_attempt_id)
  where checkout_attempt_id is not null;
create index payment_records_status_idx on private.payment_records (status, updated_at desc);

create table private.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  automation_job_id uuid not null unique references private.automation_jobs(id) on delete restrict,
  template text not null,
  recipient extensions.citext not null,
  status text not null,
  provider_message_id text,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_deliveries_template_nonempty check (length(trim(template)) > 0),
  constraint email_deliveries_recipient_nonempty check (length(trim(recipient::text)) > 3),
  constraint email_deliveries_status_valid check (status in ('sent', 'retrying', 'failed')),
  constraint email_deliveries_attempts_nonnegative check (attempts >= 0)
);

create index email_deliveries_status_idx on private.email_deliveries (status, updated_at desc);
create index email_deliveries_recipient_idx on private.email_deliveries (lower(recipient::text), created_at desc);

create table private.integration_health (
  integration text primary key,
  status text not null default 'unconfigured',
  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  constraint integration_health_name_format check (integration ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint integration_health_status_valid check (status in ('unconfigured', 'healthy', 'degraded', 'failing')),
  constraint integration_health_failures_nonnegative check (consecutive_failures >= 0),
  constraint integration_health_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index integration_health_status_idx on private.integration_health (status, updated_at desc);

create table private.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  constraint audit_logs_action_format check (action ~ '^[a-z][a-z0-9_.]{1,127}$'),
  constraint audit_logs_target_type_format check (target_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint audit_logs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index audit_logs_occurred_idx on private.audit_logs (occurred_at desc);
create index audit_logs_target_idx on private.audit_logs (target_type, target_id, occurred_at desc);
create index audit_logs_actor_idx on private.audit_logs (actor_user_id, occurred_at desc)
  where actor_user_id is not null;

create table private.analytics_daily (
  day date not null,
  event_name text not null,
  dimension text not null default '',
  event_count bigint not null,
  unique_users bigint not null,
  unique_anonymous_visitors bigint not null,
  updated_at timestamptz not null default now(),
  primary key (day, event_name, dimension),
  constraint analytics_daily_event_name_format check (event_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint analytics_daily_dimension_length check (length(dimension) <= 200),
  constraint analytics_daily_counts_nonnegative check (
    event_count >= 0 and unique_users >= 0 and unique_anonymous_visitors >= 0
  )
);

create index analytics_daily_event_idx on private.analytics_daily (event_name, dimension, day desc);

create trigger payment_records_set_updated_at before update on private.payment_records
for each row execute function private.set_updated_at();
create trigger session_integrations_set_updated_at before update on private.session_integrations
for each row execute function private.set_updated_at();
create trigger email_deliveries_set_updated_at before update on private.email_deliveries
for each row execute function private.set_updated_at();
create trigger integration_health_set_updated_at before update on private.integration_health
for each row execute function private.set_updated_at();
create trigger analytics_daily_set_updated_at before update on private.analytics_daily
for each row execute function private.set_updated_at();

alter table private.payment_records enable row level security;
alter table private.session_integrations enable row level security;
alter table private.email_deliveries enable row level security;
alter table private.integration_health enable row level security;
alter table private.audit_logs enable row level security;
alter table private.analytics_daily enable row level security;

revoke all on private.session_integrations, private.payment_records, private.email_deliveries, private.integration_health,
  private.audit_logs, private.analytics_daily from public, anon, authenticated;
grant select, insert, update, delete on private.session_integrations, private.payment_records, private.email_deliveries,
  private.integration_health, private.audit_logs, private.analytics_daily to service_role;
grant usage, select on all sequences in schema private to service_role;

insert into private.integration_health (integration, status)
values
  ('stripe_webhook', 'unconfigured'),
  ('google_gmail', 'unconfigured'),
  ('google_calendar', 'unconfigured'),
  ('automation_worker', 'unconfigured'),
  ('supabase_database', 'healthy')
on conflict (integration) do nothing;

create or replace function public.record_integration_health(
  p_integration text,
  p_success boolean,
  p_error text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_health private.integration_health%rowtype;
begin
  if p_integration !~ '^[a-z][a-z0-9_]{1,63}$'
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_integration_health_update';
  end if;

  insert into private.integration_health (
    integration,
    status,
    consecutive_failures,
    last_success_at,
    last_failure_at,
    last_error,
    metadata
  ) values (
    p_integration,
    case when p_success then 'healthy' else 'degraded' end,
    case when p_success then 0 else 1 end,
    case when p_success then now() else null end,
    case when p_success then null else now() end,
    case when p_success then null else left(coalesce(p_error, 'unknown_integration_error'), 2000) end,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (integration) do update
    set status = case
          when p_success then 'healthy'
          when private.integration_health.consecutive_failures + 1 >= 3 then 'failing'
          else 'degraded'
        end,
        consecutive_failures = case
          when p_success then 0
          else private.integration_health.consecutive_failures + 1
        end,
        last_success_at = case
          when p_success then now()
          else private.integration_health.last_success_at
        end,
        last_failure_at = case
          when p_success then private.integration_health.last_failure_at
          else now()
        end,
        last_error = case
          when p_success then null
          else left(coalesce(p_error, 'unknown_integration_error'), 2000)
        end,
        metadata = coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
  returning * into v_health;

  return jsonb_build_object(
    'integration', v_health.integration,
    'status', v_health.status,
    'consecutive_failures', v_health.consecutive_failures,
    'updated_at', v_health.updated_at
  );
end;
$$;

revoke execute on function public.record_integration_health(text, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_integration_health(text, boolean, text, jsonb)
  to service_role;

create or replace function public.my_enrollment_details()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'authentication_required';
  end if;

  select jsonb_build_object(
    'enrollments',
    coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'status', e.status,
      'amountCents', e.amount_cents,
      'currency', e.currency,
      'bookedAt', e.booked_at,
      'confirmedAt', e.confirmed_at,
      'course', jsonb_build_object(
        'slug', c.slug,
        'title', c.title,
        'summary', c.summary
      ),
      'session', jsonb_build_object(
        'id', s.id,
        'format', s.format,
        'startAt', s.start_at,
        'endAt', s.end_at,
        'timezone', s.timezone,
        'venue', s.venue,
        'status', s.status,
        'googleEventId', case when e.status = 'confirmed' then si.google_event_id else null end,
        'meetUrl', case when e.status = 'confirmed' then si.meet_url else null end
      ),
      'payment', case when pr.id is null then null else jsonb_build_object(
        'status', pr.status,
        'amountCents', pr.amount_cents,
        'amountRefundedCents', pr.amount_refunded_cents,
        'paidAt', pr.paid_at,
        'refundedAt', pr.refunded_at
      ) end
    ) order by s.start_at desc), '[]'::jsonb)
  )
  into v_result
  from public.enrollments e
  join public.workshop_sessions s on s.id = e.session_id
  join public.courses c on c.id = s.course_id
  left join private.session_integrations si on si.session_id = s.id
  left join lateral (
    select p.*
    from private.payment_records p
    where (
        e.stripe_payment_intent_id is not null
        and p.stripe_payment_intent_id = e.stripe_payment_intent_id
      )
      or (
        e.stripe_payment_intent_id is null
        and p.enrollment_id = e.id
      )
    order by p.updated_at desc
    limit 1
  ) pr on true
  where e.user_id = v_user_id;

  return coalesce(v_result, jsonb_build_object('enrollments', '[]'::jsonb));
end;
$$;

revoke execute on function public.my_enrollment_details()
  from public, anon;
grant execute on function public.my_enrollment_details()
  to authenticated;

create or replace function public.public_workshop_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'workshops',
    coalesce(jsonb_agg(jsonb_build_object(
      'course_id', c.id,
      'session_id', s.id,
      'slug', c.slug,
      'title', c.title,
      'summary', c.summary,
      'description', c.description,
      'outcomes', c.outcomes,
      'level', c.level,
      'audience', c.audience,
      'agenda', c.agenda,
      'duration_minutes', c.duration_minutes,
      'price_cents', c.price_cents,
      'currency', c.currency,
      'format', s.format,
      'starts_at', s.start_at,
      'ends_at', s.end_at,
      'timezone', s.timezone,
      'venue', s.venue,
      'capacity', s.capacity,
      'status', s.status,
      'seats_left', greatest(s.capacity - private.session_occupied_seats(s.id), 0)
    ) order by s.start_at, c.title), '[]'::jsonb)
  )
  from public.courses c
  join public.workshop_sessions s on s.course_id = c.id
  where c.status = 'published'
    and c.visibility = 'public'
    and c.stripe_product_id is not null
    and c.stripe_price_id is not null
    and s.status in ('scheduled', 'sold_out')
    and private.session_calendar_ready(s.id)
    and s.start_at > now() + interval '32 minutes';
$$;

revoke execute on function public.public_workshop_catalog()
  from public;
grant execute on function public.public_workshop_catalog()
  to anon, authenticated;

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
  v_raw_start_day date := (now() at time zone 'Europe/Amsterdam')::date - 89;
  v_raw_start_at timestamptz := v_raw_start_day::timestamp at time zone 'Europe/Amsterdam';
begin
  insert into private.analytics_daily (
    day,
    event_name,
    dimension,
    event_count,
    unique_users,
    unique_anonymous_visitors
  )
  select
    (ae.occurred_at at time zone 'Europe/Amsterdam')::date,
    ae.event_name,
    '',
    count(*),
    count(distinct ae.user_id),
    count(distinct ae.anonymous_id)
  from private.analytics_events ae
  -- Only recompute days whose complete raw event window is still retained.
  -- Older daily rows are finalized and must never be replaced by a shrinking
  -- partial slice after rolling raw-event deletion.
  where ae.occurred_at >= v_raw_start_at
  group by 1, 2
  on conflict (day, event_name, dimension) do update
    set event_count = excluded.event_count,
        unique_users = excluded.unique_users,
        unique_anonymous_visitors = excluded.unique_anonymous_visitors,
        updated_at = now();

  get diagnostics v_aggregated = row_count;

  insert into private.analytics_daily (
    day,
    event_name,
    dimension,
    event_count,
    unique_users,
    unique_anonymous_visitors
  )
  select
    (ae.occurred_at at time zone 'Europe/Amsterdam')::date,
    'page_view_utm_source',
    left(lower(trim(ae.utm_source)), 200),
    count(*),
    count(distinct ae.user_id),
    count(distinct ae.anonymous_id)
  from private.analytics_events ae
  where ae.event_name = 'page_view'
    and nullif(trim(ae.utm_source), '') is not null
    and ae.occurred_at >= v_raw_start_at
  group by 1, left(lower(trim(ae.utm_source)), 200)
  on conflict (day, event_name, dimension) do update
    set event_count = excluded.event_count,
        unique_users = excluded.unique_users,
        unique_anonymous_visitors = excluded.unique_anonymous_visitors,
        updated_at = now();

  get diagnostics v_utm_aggregated = row_count;

  insert into private.analytics_daily (
    day,
    event_name,
    dimension,
    event_count,
    unique_users,
    unique_anonymous_visitors
  )
  select
    (ae.occurred_at at time zone 'Europe/Amsterdam')::date,
    'course_view',
    c.id::text,
    count(*),
    count(distinct ae.user_id),
    count(distinct ae.anonymous_id)
  from private.analytics_events ae
  join public.courses c
    on c.id::text = nullif(ae.properties ->> 'course_id', '')
    or (
      nullif(ae.properties ->> 'course_id', '') is null
      and c.slug = nullif(ae.properties ->> 'course_slug', '')
    )
  where ae.event_name = 'course_view'
    and ae.occurred_at >= v_raw_start_at
  group by 1, c.id
  on conflict (day, event_name, dimension) do update
    set event_count = excluded.event_count,
        unique_users = excluded.unique_users,
        unique_anonymous_visitors = excluded.unique_anonymous_visitors,
        updated_at = now();

  get diagnostics v_course_aggregated = row_count;

  delete from private.analytics_events
  where occurred_at < now() - interval '90 days';
  get diagnostics v_raw_deleted = row_count;

  delete from private.analytics_daily
  where day < (
    (now() at time zone 'Europe/Amsterdam')::date - interval '24 months'
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
  -- Raw events are retained for 90 rolling days. Starting raw reads at the
  -- Amsterdam midnight 89 days ago leaves a full-day safety margin.
  v_raw_start_day date := (now() at time zone 'Europe/Amsterdam')::date - 89;
  v_raw_start_at timestamptz := v_raw_start_day::timestamp at time zone 'Europe/Amsterdam';
  v_daily_count bigint;
  v_raw_count bigint;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    return 0;
  end if;

  select coalesce(sum(ad.event_count), 0)
  into v_daily_count
  from private.analytics_daily ad
  where ad.event_name = p_event_name
    and ad.dimension = ''
    and ad.day >= (p_from at time zone 'Europe/Amsterdam')::date
    and ad.day < least(
      (p_to at time zone 'Europe/Amsterdam')::date,
      v_raw_start_day
    );

  select count(*)
  into v_raw_count
  from private.analytics_events ae
  where ae.event_name = p_event_name
    and ae.occurred_at >= greatest(p_from, v_raw_start_at)
    and ae.occurred_at < p_to;

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
      ((now() at time zone 'Europe/Amsterdam')::date - 89) as raw_start_day,
      (((now() at time zone 'Europe/Amsterdam')::date - 89)::timestamp
        at time zone 'Europe/Amsterdam') as raw_start_at
  ), daily_counts as (
    select ad.dimension as course_id, sum(ad.event_count)::bigint as views
    from private.analytics_daily ad
    cross join bounds b
    where ad.event_name = 'course_view'
      and ad.dimension <> ''
      and ad.day >= (p_from at time zone 'Europe/Amsterdam')::date
      and ad.day < least(
        (p_to at time zone 'Europe/Amsterdam')::date,
        b.raw_start_day
      )
    group by ad.dimension
  ), raw_counts as (
    select c.id::text as course_id, count(*)::bigint as views
    from private.analytics_events ae
    join public.courses c
      on c.id::text = nullif(ae.properties ->> 'course_id', '')
      or (
        nullif(ae.properties ->> 'course_id', '') is null
        and c.slug = nullif(ae.properties ->> 'course_slug', '')
      )
    cross join bounds b
    where ae.event_name = 'course_view'
      and ae.occurred_at >= greatest(p_from, b.raw_start_at)
      and ae.occurred_at < p_to
    group by c.id
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
      c.id as course_id,
      c.slug as course_slug,
      c.title as course_title,
      combined.views
    from combined
    join public.courses c on c.id::text = combined.course_id
    order by combined.views desc, c.title
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
      ((now() at time zone 'Europe/Amsterdam')::date - 89) as raw_start_day,
      (((now() at time zone 'Europe/Amsterdam')::date - 89)::timestamp
        at time zone 'Europe/Amsterdam') as raw_start_at
  ), daily_counts as (
    select ad.dimension as source, sum(ad.event_count)::bigint as visits
    from private.analytics_daily ad
    cross join bounds b
    where ad.event_name = 'page_view_utm_source'
      and ad.dimension <> ''
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

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'clearstep-analytics-rollup-retention';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'clearstep-analytics-rollup-retention',
    '15 2 * * *',
    'select public.rollup_and_retain_analytics()'
  );
end;
$$;
