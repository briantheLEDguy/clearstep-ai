create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists citext with schema extensions;

create or replace function private.valid_course_agenda(p_agenda jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_agenda) <> 'array' then false
    when jsonb_array_length(p_agenda) > 20 then false
    else not exists (
      select 1
      from jsonb_array_elements(p_agenda) item
      where jsonb_typeof(item) <> 'object'
         or jsonb_typeof(item -> 'title') <> 'string'
         or jsonb_typeof(item -> 'detail') <> 'string'
         or length(item ->> 'title') > 120
         or length(item ->> 'detail') > 500
         or length(trim(item ->> 'title')) not between 1 and 120
         or length(trim(item ->> 'detail')) not between 1 and 500
    )
  end;
$$;

revoke execute on function private.valid_course_agenda(jsonb)
  from public, anon, authenticated;
grant execute on function private.valid_course_agenda(jsonb)
  to service_role;

create or replace function private.valid_course_outcomes(p_outcomes text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_outcomes is null or cardinality(p_outcomes) > 20 then false
    else not exists (
      select 1
      from unnest(p_outcomes) outcome
      where outcome is null
         or length(outcome) > 500
         or length(trim(outcome)) not between 1 and 500
    )
  end;
$$;

revoke execute on function private.valid_course_outcomes(text[])
  from public, anon, authenticated;
grant execute on function private.valid_course_outcomes(text[])
  to service_role;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email extensions.citext not null,
  full_name text,
  organization text,
  phone text,
  marketing_consent boolean not null default false,
  analytics_consent boolean not null default false,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_nonempty check (length(trim(email::text)) > 3)
);

create unique index profiles_email_key on public.profiles (lower(email::text));

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text not null,
  description text not null,
  outcomes text[] not null default '{}',
  level text not null,
  audience text not null default '',
  agenda jsonb not null default '[]',
  duration_minutes integer not null,
  price_cents integer not null,
  currency text not null default 'EUR',
  stripe_product_id text unique,
  stripe_price_id text unique,
  visibility text not null default 'public',
  status text not null default 'draft',
  seo_title text,
  seo_description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint courses_title_bounds check (
    length(title) <= 240 and length(trim(title)) between 1 and 240
  ),
  constraint courses_summary_bounds check (
    length(summary) <= 1000 and length(trim(summary)) between 1 and 1000
  ),
  constraint courses_description_bounds check (
    length(description) <= 10000 and length(trim(description)) between 1 and 10000
  ),
  constraint courses_level_max_length check (length(level) <= 120),
  constraint courses_audience_max_length check (length(audience) <= 2000),
  constraint courses_outcomes_valid check (private.valid_course_outcomes(outcomes)),
  constraint courses_duration_positive check (duration_minutes > 0),
  constraint courses_price_nonnegative check (price_cents >= 0),
  constraint courses_published_price_positive check (status <> 'published' or price_cents > 0),
  constraint courses_currency_eur check (currency = 'EUR'),
  constraint courses_stripe_product_format check (stripe_product_id is null or stripe_product_id ~ '^prod_[A-Za-z0-9]+$'),
  constraint courses_stripe_price_format check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  constraint courses_stripe_pair check ((stripe_product_id is null) = (stripe_price_id is null)),
  constraint courses_published_stripe_required check (
    status <> 'published' or (stripe_product_id is not null and stripe_price_id is not null)
  ),
  constraint courses_status_valid check (status in ('draft', 'published', 'archived')),
  constraint courses_visibility_valid check (visibility in ('public', 'private')),
  constraint courses_level_nonempty check (length(trim(level)) > 0),
  constraint courses_published_audience_nonempty check (status <> 'published' or length(trim(audience)) > 0),
  constraint courses_published_public_outcomes_nonempty check (
    status <> 'published' or visibility = 'private' or cardinality(outcomes) > 0
  ),
  constraint courses_published_public_agenda_nonempty check (
    status <> 'published' or visibility = 'private' or jsonb_array_length(agenda) > 0
  ),
  constraint courses_agenda_valid check (
    private.valid_course_agenda(agenda) and octet_length(agenda::text) <= 20000
  )
);

create index courses_status_idx on public.courses (status);
create index courses_created_by_idx on public.courses (created_by)
  where created_by is not null;

create table public.workshop_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete restrict,
  format text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null default 'Europe/Amsterdam',
  venue text,
  capacity integer not null,
  status text not null default 'draft',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workshop_sessions_format_valid check (format in ('online', 'in_person', 'hybrid')),
  constraint workshop_sessions_dates_valid check (start_at < end_at),
  constraint workshop_sessions_capacity_positive check (capacity > 0),
  constraint workshop_sessions_timezone_default check (length(trim(timezone)) > 0),
  constraint workshop_sessions_status_valid check (status in ('draft', 'scheduled', 'sold_out', 'cancelled', 'completed')),
  constraint workshop_sessions_venue_required check (format = 'online' or length(trim(coalesce(venue, ''))) > 0)
);

create index workshop_sessions_course_id_idx on public.workshop_sessions (course_id);
create index workshop_sessions_upcoming_idx on public.workshop_sessions (start_at, course_id)
  where status in ('scheduled', 'sold_out');
create index workshop_sessions_created_by_idx on public.workshop_sessions (created_by)
  where created_by is not null;

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workshop_sessions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  attendee_email extensions.citext not null,
  attendee_name text,
  status text not null,
  amount_cents integer not null,
  currency text not null default 'EUR',
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  booked_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enrollments_one_seat_per_user unique (session_id, user_id),
  constraint enrollments_status_valid check (status in ('pending_payment', 'confirmed', 'cancelled', 'refunded')),
  constraint enrollments_amount_nonnegative check (amount_cents >= 0),
  constraint enrollments_currency_eur check (currency = 'EUR')
);

create index enrollments_session_id_idx on public.enrollments (session_id);
create index enrollments_user_id_idx on public.enrollments (user_id);
create index enrollments_payment_intent_idx on public.enrollments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create index enrollments_active_session_idx on public.enrollments (session_id, status)
  where status in ('pending_payment', 'confirmed');

create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workshop_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email extensions.citext not null,
  full_name text,
  status text not null default 'waiting',
  joined_at timestamptz not null default now(),
  offered_at timestamptz,
  offer_expires_at timestamptz,
  accepted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint waitlist_entries_one_per_user unique (session_id, user_id),
  constraint waitlist_entries_status_valid check (status in ('waiting', 'offered', 'accepted', 'expired', 'removed'))
);

create index waitlist_entries_session_id_idx on public.waitlist_entries (session_id);
create index waitlist_entries_user_id_idx on public.waitlist_entries (user_id);
create index waitlist_entries_queue_idx on public.waitlist_entries (session_id, joined_at)
  where status = 'waiting';

create table private.seat_holds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workshop_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  waitlist_entry_id uuid references public.waitlist_entries(id) on delete set null,
  source text not null default 'standard',
  status text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seat_holds_one_per_user unique (session_id, user_id),
  constraint seat_holds_source_valid check (source in ('standard', 'waitlist')),
  constraint seat_holds_status_valid check (status in ('active', 'converted', 'expired', 'released'))
);

create index seat_holds_session_id_idx on private.seat_holds (session_id);
create index seat_holds_user_id_idx on private.seat_holds (user_id);
create index seat_holds_waitlist_entry_id_idx on private.seat_holds (waitlist_entry_id)
  where waitlist_entry_id is not null;
create index seat_holds_active_idx on private.seat_holds (session_id, expires_at)
  where status = 'active';

create table private.waitlist_offers (
  id uuid primary key default gen_random_uuid(),
  waitlist_entry_id uuid not null references public.waitlist_entries(id) on delete cascade,
  token_hash text not null unique,
  status text not null default 'active',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint waitlist_offers_status_valid check (status in ('active', 'accepted', 'expired', 'revoked')),
  constraint waitlist_offers_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);

create index waitlist_offers_entry_idx on private.waitlist_offers (waitlist_entry_id);
create index waitlist_offers_active_idx on private.waitlist_offers (expires_at)
  where status = 'active';

create table private.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references private.seat_holds(id) on delete restrict,
  session_id uuid not null references public.workshop_sessions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_email extensions.citext not null,
  status text not null default 'creating',
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  amount_cents integer not null,
  currency text not null default 'EUR',
  expires_at timestamptz not null,
  grace_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_attempts_status_valid check (status in ('creating', 'open', 'payment_pending', 'paid', 'paid_unallocated', 'expired', 'failed')),
  constraint checkout_attempts_amount_nonnegative check (amount_cents >= 0),
  constraint checkout_attempts_currency_eur check (currency = 'EUR'),
  constraint checkout_attempts_grace_after_expiry check (grace_expires_at >= expires_at)
);

create index checkout_attempts_hold_id_idx on private.checkout_attempts (hold_id);
create index checkout_attempts_session_id_idx on private.checkout_attempts (session_id);
create index checkout_attempts_user_id_idx on private.checkout_attempts (user_id);
create index checkout_attempts_open_idx on private.checkout_attempts (expires_at)
  where status in ('creating', 'open', 'payment_pending');
create index checkout_attempts_seat_grace_idx on private.checkout_attempts (session_id, grace_expires_at)
  where status in ('open', 'payment_pending');
create unique index checkout_attempts_one_active_per_user_session_idx
  on private.checkout_attempts (session_id, user_id)
  where status in ('creating', 'open', 'payment_pending');

create table private.stripe_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received',
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint stripe_webhook_events_status_valid check (status in ('received', 'processed', 'ignored', 'failed'))
);

create index stripe_webhook_events_received_idx on private.stripe_webhook_events (received_at desc);

create table private.private_workshop_requests (
  id uuid primary key default gen_random_uuid(),
  contact_name text not null,
  email extensions.citext not null,
  phone text,
  organization text not null,
  attendee_count integer,
  preferred_format text,
  preferred_timing text,
  goals text not null,
  notes text,
  consent_to_contact boolean not null,
  status text not null default 'new',
  owner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_requests_attendee_count check (attendee_count is null or attendee_count > 0),
  constraint private_requests_format_valid check (preferred_format is null or preferred_format in ('online', 'in_person', 'hybrid', 'unsure')),
  constraint private_requests_status_valid check (status in ('new', 'contacted', 'qualified', 'quoted', 'won', 'lost', 'archived')),
  constraint private_requests_consent_required check (consent_to_contact)
);

create index private_requests_email_idx on private.private_workshop_requests (lower(email::text));
create index private_requests_status_idx on private.private_workshop_requests (status, created_at desc);
create index private_requests_owner_user_id_idx on private.private_workshop_requests (owner_user_id)
  where owner_user_id is not null;

-- Short-lived, unlinkable abuse-control entries are kept outside customer records.
create table private.private_request_rate_limits (
  id bigint generated always as identity primary key,
  request_fingerprint text not null,
  created_at timestamptz not null default now(),
  constraint private_request_rate_limit_fingerprint_format
    check (request_fingerprint ~ '^[a-f0-9]{64}$')
);

create index private_request_rate_limits_lookup_idx
  on private.private_request_rate_limits (request_fingerprint, created_at desc);
create index private_request_rate_limits_retention_idx
  on private.private_request_rate_limits (created_at);

create table private.private_workshop_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references private.private_workshop_requests(id) on delete cascade,
  course_id uuid references public.courses(id) on delete restrict,
  session_id uuid unique references public.workshop_sessions(id) on delete restrict,
  amount_cents integer not null,
  currency text not null default 'EUR',
  vat_inclusive boolean not null default true,
  description text not null,
  valid_until date not null,
  status text not null default 'draft',
  created_by uuid not null references auth.users(id) on delete restrict,
  sent_at timestamptz,
  accepted_at timestamptz,
  checkout_token_hash text unique,
  checkout_expires_at timestamptz,
  customer_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_quotes_amount_positive check (amount_cents > 0),
  constraint private_quotes_currency_eur check (currency = 'EUR'),
  constraint private_quotes_status_valid check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'void')),
  constraint private_quotes_checkout_token_format check (
    checkout_token_hash is null or checkout_token_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint private_quotes_checkout_pair check (
    (checkout_token_hash is null) = (checkout_expires_at is null)
  )
);

create index private_quotes_request_id_idx on private.private_workshop_quotes (request_id);
create index private_quotes_course_id_idx on private.private_workshop_quotes (course_id)
  where course_id is not null;
create index private_quotes_created_by_idx on private.private_workshop_quotes (created_by);
create index private_quotes_customer_user_id_idx on private.private_workshop_quotes (customer_user_id)
  where customer_user_id is not null;
create index private_quotes_checkout_active_idx on private.private_workshop_quotes (checkout_expires_at)
  where status = 'sent' and checkout_token_hash is not null;

create table private.staff_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  email extensions.citext not null,
  role text not null,
  status text not null default 'invited',
  invited_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_members_email_key unique (email),
  constraint staff_members_role_valid check (role in ('owner', 'admin', 'analyst')),
  constraint staff_members_status_valid check (status in ('invited', 'active', 'suspended', 'removed'))
);

create index staff_members_user_id_idx on private.staff_members (user_id)
  where user_id is not null;
create index staff_members_invited_by_idx on private.staff_members (invited_by)
  where invited_by is not null;
create index staff_members_active_idx on private.staff_members (status, role)
  where status = 'active';

create table private.staff_invites (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  role text not null,
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint staff_invites_role_valid check (role in ('admin', 'analyst')),
  constraint staff_invites_expiry_future check (expires_at > created_at),
  constraint staff_invites_exact_seven_day_expiry check (
    expires_at = created_at + interval '7 days'
  ),
  constraint staff_invites_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$')
);

create index staff_invites_email_idx on private.staff_invites (lower(email::text));
create unique index staff_invites_one_open_per_email_idx
  on private.staff_invites (lower(email::text))
  where accepted_at is null and revoked_at is null;
create index staff_invites_invited_by_idx on private.staff_invites (invited_by);
create index staff_invites_active_idx on private.staff_invites (expires_at)
  where accepted_at is null and revoked_at is null;

create table private.google_oauth_states (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  code_verifier text not null,
  redirect_uri text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint google_oauth_states_hash_format check (state_hash ~ '^[0-9a-f]{64}$')
);

create index google_oauth_states_expiry_idx on private.google_oauth_states (expires_at);
create index google_oauth_states_actor_user_id_idx on private.google_oauth_states (actor_user_id);

create table private.google_connections (
  id uuid primary key default gen_random_uuid(),
  connected_by uuid not null references auth.users(id) on delete restrict,
  connected_email extensions.citext not null unique,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  token_expires_at timestamptz not null,
  scopes text[] not null default '{}',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_connections_status_valid check (status in ('active', 'reauthorization_required', 'revoked'))
);

create index google_connections_status_idx on private.google_connections (status);
create index google_connections_connected_by_idx on private.google_connections (connected_by);

create table private.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  payload jsonb not null,
  status text not null default 'pending',
  dedupe_key text unique,
  pgmq_message_id bigint unique,
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  output jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_jobs_status_valid check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  constraint automation_jobs_attempts_nonnegative check (attempts >= 0 and max_attempts > 0)
);

create index automation_jobs_claim_idx on private.automation_jobs (available_at, created_at)
  where status = 'pending';
create index automation_jobs_stale_idx on private.automation_jobs (locked_at)
  where status = 'processing';

create table private.analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  anonymous_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  page_path text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  properties jsonb not null default '{}',
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint analytics_event_name_format check (event_name ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint analytics_properties_object check (jsonb_typeof(properties) = 'object')
);

create index analytics_events_occurred_idx on private.analytics_events (occurred_at desc);
create index analytics_events_name_occurred_idx on private.analytics_events (event_name, occurred_at desc);
create index analytics_events_user_id_idx on private.analytics_events (user_id, occurred_at desc)
  where user_id is not null;

create or replace function private.enforce_workshop_session_sale_readiness()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_entering_sale_state boolean;
begin
  v_entering_sale_state := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    v_entering_sale_state := old.status not in ('scheduled', 'sold_out')
      or new.course_id is distinct from old.course_id;
  end if;

  if new.status in ('scheduled', 'sold_out')
     and v_entering_sale_state
     and not exists (
    select 1
    from public.courses c
    where c.id = new.course_id
      and c.status = 'published'
      and c.stripe_product_id is not null
      and c.stripe_price_id is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'scheduled_session_requires_sellable_course';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_workshop_session_sale_readiness()
  from public, anon, authenticated, service_role;

create trigger workshop_sessions_enforce_sale_readiness
before insert or update of course_id, status on public.workshop_sessions
for each row execute function private.enforce_workshop_session_sale_readiness();

create or replace function private.enforce_seat_hold_before_session_start()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.workshop_sessions s
    where s.id = new.session_id
      and new.expires_at < s.start_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'seat_hold_must_expire_before_session_start';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_seat_hold_before_session_start()
  from public, anon, authenticated, service_role;

create trigger seat_holds_enforce_session_start
before insert or update of session_id, expires_at on private.seat_holds
for each row execute function private.enforce_seat_hold_before_session_start();

create or replace function private.enforce_checkout_before_session_start()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.workshop_sessions s
    where s.id = new.session_id
      and new.expires_at < s.start_at
      and new.grace_expires_at <= s.start_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'checkout_must_settle_by_session_start';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_checkout_before_session_start()
  from public, anon, authenticated, service_role;

create trigger checkout_attempts_enforce_session_start
before insert or update of session_id, expires_at, grace_expires_at on private.checkout_attempts
for each row execute function private.enforce_checkout_before_session_start();

create or replace function private.enforce_waitlist_offer_booking_window()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.waitlist_entries w
    join public.workshop_sessions s on s.id = w.session_id
    where w.id = new.waitlist_entry_id
      and new.expires_at <= s.start_at - interval '32 minutes'
  ) then
    raise exception using
      errcode = '23514',
      message = 'waitlist_offer_exceeds_booking_deadline';
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_waitlist_offer_booking_window()
  from public, anon, authenticated, service_role;

create trigger waitlist_offers_enforce_booking_window
before insert or update of waitlist_entry_id, expires_at on private.waitlist_offers
for each row execute function private.enforce_waitlist_offer_booking_window();

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.set_updated_at() from public, anon, authenticated, service_role;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function private.set_updated_at();
create trigger courses_set_updated_at before update on public.courses
for each row execute function private.set_updated_at();
create trigger workshop_sessions_set_updated_at before update on public.workshop_sessions
for each row execute function private.set_updated_at();
create trigger enrollments_set_updated_at before update on public.enrollments
for each row execute function private.set_updated_at();
create trigger waitlist_entries_set_updated_at before update on public.waitlist_entries
for each row execute function private.set_updated_at();
create trigger seat_holds_set_updated_at before update on private.seat_holds
for each row execute function private.set_updated_at();
create trigger checkout_attempts_set_updated_at before update on private.checkout_attempts
for each row execute function private.set_updated_at();
create trigger private_requests_set_updated_at before update on private.private_workshop_requests
for each row execute function private.set_updated_at();
create trigger private_quotes_set_updated_at before update on private.private_workshop_quotes
for each row execute function private.set_updated_at();
create trigger staff_members_set_updated_at before update on private.staff_members
for each row execute function private.set_updated_at();
create trigger google_connections_set_updated_at before update on private.google_connections
for each row execute function private.set_updated_at();
create trigger automation_jobs_set_updated_at before update on private.automation_jobs
for each row execute function private.set_updated_at();

create or replace function private.handle_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    return new;
  end if;

  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  -- Brian is the only bootstrap principal. All other staff activation must go
  -- through public.accept_staff_invite after token and expiry validation.
  update private.staff_members
     set user_id = new.id,
         status = 'active',
         activated_at = coalesce(activated_at, now()),
         updated_at = now()
   where lower(email::text) = 'brian@bncconsulting.co'
     and lower(new.email) = 'brian@bncconsulting.co'
     and role = 'owner'
     and status = 'invited'
     and user_id is null
     and new.email_confirmed_at is not null;

  return new;
end;
$$;

revoke execute on function private.handle_auth_user() from public, anon, authenticated, service_role;

create trigger on_auth_user_created_or_updated
after insert or update of email, email_confirmed_at on auth.users
for each row execute function private.handle_auth_user();

insert into public.profiles (id, email, full_name)
select
  u.id,
  u.email,
  nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '')
from auth.users u
where u.email is not null
on conflict (id) do update set email = excluded.email;

insert into private.staff_members (user_id, email, role, status, activated_at)
select
  u.id,
  'brian@bncconsulting.co',
  'owner',
  case when u.id is null then 'invited' else 'active' end,
  case when u.id is null then null else now() end
from (values (1)) seed(n)
left join lateral (
  select id
  from auth.users
  where lower(email) = 'brian@bncconsulting.co'
    and email_confirmed_at is not null
  limit 1
) u on true
on conflict (email) do update
  set user_id = coalesce(private.staff_members.user_id, excluded.user_id),
      role = 'owner',
      status = case when coalesce(private.staff_members.user_id, excluded.user_id) is null then private.staff_members.status else 'active' end,
      activated_at = case when coalesce(private.staff_members.user_id, excluded.user_id) is null then private.staff_members.activated_at else coalesce(private.staff_members.activated_at, now()) end;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.workshop_sessions enable row level security;
alter table public.enrollments enable row level security;
alter table public.waitlist_entries enable row level security;
alter table private.seat_holds enable row level security;
alter table private.waitlist_offers enable row level security;
alter table private.checkout_attempts enable row level security;
alter table private.stripe_webhook_events enable row level security;
alter table private.private_workshop_requests enable row level security;
alter table private.private_request_rate_limits enable row level security;
alter table private.private_workshop_quotes enable row level security;
alter table private.staff_members enable row level security;
alter table private.staff_invites enable row level security;
alter table private.google_oauth_states enable row level security;
alter table private.google_connections enable row level security;
alter table private.automation_jobs enable row level security;
alter table private.analytics_events enable row level security;

create policy courses_public_read
on public.courses for select
to anon, authenticated
using (status = 'published' and visibility = 'public');

create policy workshop_sessions_public_read
on public.workshop_sessions for select
to anon, authenticated
using (
  status in ('scheduled', 'sold_out')
  and start_at > now() + interval '32 minutes'
  and exists (
    select 1
    from public.courses c
    where c.id = workshop_sessions.course_id
      and c.status = 'published'
      and c.visibility = 'public'
  )
);

create policy profiles_own_read
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_own_update
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy enrollments_own_read
on public.enrollments for select
to authenticated
using ((select auth.uid()) = user_id);

create policy waitlist_entries_own_read
on public.waitlist_entries for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select (
  id, slug, title, summary, description, outcomes, level, duration_minutes,
  audience, agenda, price_cents, currency, status, seo_title, seo_description
) on public.courses to anon, authenticated;
grant select (
  id, course_id, format, start_at, end_at, timezone, venue, capacity, status
) on public.workshop_sessions to anon, authenticated;
grant select on public.profiles, public.enrollments, public.waitlist_entries to authenticated;
grant update (full_name, organization, phone, marketing_consent, analytics_consent, terms_accepted_at)
  on public.profiles to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant select, insert, update, delete on all tables in schema private to service_role;
grant usage, select on all sequences in schema private to service_role;

alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema private revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema private revoke all on tables from anon, authenticated;
