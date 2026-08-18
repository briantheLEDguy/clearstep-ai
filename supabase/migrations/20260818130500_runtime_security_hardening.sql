-- Runtime hardening added after the reviewed base schema. This migration is
-- intentionally additive/overriding so the prior migration history remains
-- immutable.

create extension if not exists supabase_vault with schema vault;

revoke all on schema vault from public, anon, authenticated;
revoke all on table vault.secrets, vault.decrypted_secrets from public, anon, authenticated;

-- Google OAuth tokens live only in Vault. Any pre-existing app-encrypted
-- connection is invalidated and must be reauthorized rather than copied into a
-- second long-lived token format.
drop function public.save_google_connection(uuid, text, text, text, timestamptz, text[]);
drop function public.get_google_connection(text);
drop function public.update_google_access_token(uuid, text, timestamptz, text, text);

alter table private.google_connections
  add column access_token_secret_id uuid,
  add column refresh_token_secret_id uuid;

update private.google_connections
set status = 'reauthorization_required',
    updated_at = now();

alter table private.google_connections
  drop column encrypted_access_token,
  drop column encrypted_refresh_token,
  add constraint google_connections_access_token_secret_fkey
    foreign key (access_token_secret_id) references vault.secrets(id) on delete restrict,
  add constraint google_connections_refresh_token_secret_fkey
    foreign key (refresh_token_secret_id) references vault.secrets(id) on delete restrict,
  add constraint google_connections_active_vault_tokens check (
    status <> 'active'
    or (access_token_secret_id is not null and refresh_token_secret_id is not null)
  );

create index google_connections_access_token_secret_idx
  on private.google_connections (access_token_secret_id)
  where access_token_secret_id is not null;
create index google_connections_refresh_token_secret_idx
  on private.google_connections (refresh_token_secret_id)
  where refresh_token_secret_id is not null;

create or replace function public.save_google_connection(
  p_actor_user_id uuid,
  p_connected_email text,
  p_access_token text,
  p_refresh_token text,
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
  v_access_secret_id uuid;
  v_refresh_secret_id uuid;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;

  if length(trim(coalesce(p_access_token, ''))) < 20
     or length(trim(coalesce(p_refresh_token, ''))) < 20
     or p_token_expires_at <= now()
     or cardinality(coalesce(p_scopes, '{}'::text[])) = 0 then
    raise exception using errcode = 'P0001', message = 'google_token_payload_invalid';
  end if;

  select * into v_connection
  from private.google_connections
  where lower(connected_email::text) = lower(trim(p_connected_email))
  for update;

  if found then
    if v_connection.access_token_secret_id is null then
      v_access_secret_id := vault.create_secret(
        p_access_token,
        'clearstep_google_access_' || v_connection.id::text,
        'Clearstep Google OAuth access token'
      );
    else
      v_access_secret_id := v_connection.access_token_secret_id;
      perform vault.update_secret(
        v_access_secret_id,
        p_access_token,
        'clearstep_google_access_' || v_connection.id::text,
        'Clearstep Google OAuth access token'
      );
    end if;

    if v_connection.refresh_token_secret_id is null then
      v_refresh_secret_id := vault.create_secret(
        p_refresh_token,
        'clearstep_google_refresh_' || v_connection.id::text,
        'Clearstep Google OAuth refresh token'
      );
    else
      v_refresh_secret_id := v_connection.refresh_token_secret_id;
      perform vault.update_secret(
        v_refresh_secret_id,
        p_refresh_token,
        'clearstep_google_refresh_' || v_connection.id::text,
        'Clearstep Google OAuth refresh token'
      );
    end if;

    update private.google_connections
       set connected_by = p_actor_user_id,
           access_token_secret_id = v_access_secret_id,
           refresh_token_secret_id = v_refresh_secret_id,
           token_expires_at = p_token_expires_at,
           scopes = p_scopes,
           status = 'active',
           updated_at = now()
     where id = v_connection.id
    returning * into v_connection;
  else
    v_connection.id := extensions.gen_random_uuid();
    v_access_secret_id := vault.create_secret(
      p_access_token,
      'clearstep_google_access_' || v_connection.id::text,
      'Clearstep Google OAuth access token'
    );
    v_refresh_secret_id := vault.create_secret(
      p_refresh_token,
      'clearstep_google_refresh_' || v_connection.id::text,
      'Clearstep Google OAuth refresh token'
    );

    insert into private.google_connections (
      id,
      connected_by,
      connected_email,
      access_token_secret_id,
      refresh_token_secret_id,
      token_expires_at,
      scopes,
      status
    ) values (
      v_connection.id,
      p_actor_user_id,
      lower(trim(p_connected_email)),
      v_access_secret_id,
      v_refresh_secret_id,
      p_token_expires_at,
      p_scopes,
      'active'
    ) returning * into v_connection;
  end if;

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
    'access_token', access_secret.decrypted_secret,
    'refresh_token', refresh_secret.decrypted_secret,
    'token_expires_at', gc.token_expires_at,
    'scopes', gc.scopes,
    'status', gc.status
  )
  from private.google_connections gc
  join vault.decrypted_secrets access_secret
    on access_secret.id = gc.access_token_secret_id
  left join vault.decrypted_secrets refresh_secret
    on refresh_secret.id = gc.refresh_token_secret_id
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
  p_access_token text,
  p_token_expires_at timestamptz,
  p_refresh_token text default null,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection private.google_connections%rowtype;
  v_refresh_secret_id uuid;
begin
  if p_status not in ('active', 'reauthorization_required', 'revoked') then
    raise exception using errcode = 'P0001', message = 'google_connection_status_invalid';
  end if;

  select * into v_connection
  from private.google_connections
  where id = p_connection_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'google_connection_not_found';
  end if;

  if p_access_token is not null then
    if length(trim(p_access_token)) < 20 or v_connection.access_token_secret_id is null then
      raise exception using errcode = 'P0001', message = 'google_access_token_invalid';
    end if;
    perform vault.update_secret(
      v_connection.access_token_secret_id,
      p_access_token,
      'clearstep_google_access_' || v_connection.id::text,
      'Clearstep Google OAuth access token'
    );
  end if;

  v_refresh_secret_id := v_connection.refresh_token_secret_id;
  if p_refresh_token is not null then
    if length(trim(p_refresh_token)) < 20 then
      raise exception using errcode = 'P0001', message = 'google_refresh_token_invalid';
    end if;
    if v_refresh_secret_id is null then
      v_refresh_secret_id := vault.create_secret(
        p_refresh_token,
        'clearstep_google_refresh_' || v_connection.id::text,
        'Clearstep Google OAuth refresh token'
      );
    else
      perform vault.update_secret(
        v_refresh_secret_id,
        p_refresh_token,
        'clearstep_google_refresh_' || v_connection.id::text,
        'Clearstep Google OAuth refresh token'
      );
    end if;
  end if;

  update private.google_connections
     set refresh_token_secret_id = v_refresh_secret_id,
         token_expires_at = p_token_expires_at,
         status = p_status,
         updated_at = now()
   where id = p_connection_id
  returning * into v_connection;

  return jsonb_build_object(
    'updated', true,
    'connection_id', p_connection_id,
    'status', v_connection.status
  );
end;
$$;

revoke execute on function public.update_google_access_token(uuid, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.update_google_access_token(uuid, text, timestamptz, text, text)
  to service_role;

-- Public analytics events use a short-lived, HMAC-derived abuse key. The key
-- is isolated from analytics rows and cannot be joined back to a visitor.
create table private.analytics_rate_limits (
  abuse_hash text primary key,
  event_count integer not null default 1,
  window_started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint analytics_rate_limits_hash_format check (abuse_hash ~ '^[0-9a-f]{64}$'),
  constraint analytics_rate_limits_count_positive check (event_count > 0),
  constraint analytics_rate_limits_expiry_valid check (expires_at > window_started_at)
);

create index analytics_rate_limits_expiry_idx
  on private.analytics_rate_limits (expires_at);

alter table private.analytics_rate_limits enable row level security;
revoke all on private.analytics_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on private.analytics_rate_limits to service_role;

drop function public.ingest_analytics_event(text, text, uuid, text, text, text, text, text, jsonb, timestamptz);

create or replace function public.ingest_analytics_event(
  p_event_name text,
  p_anonymous_id text,
  p_user_id uuid,
  p_abuse_hash text,
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
  v_rate_count integer;
  v_properties jsonb := coalesce(p_properties, '{}'::jsonb);
  v_allowed_property_keys text[];
  v_course_id uuid;
begin
  if p_event_name is null
     or not (p_event_name = any(array[
       'page_view',
       'course_view',
       'cta_private_workshop',
       'cta_workshops',
       'cta_private_request',
       'cta_workshop_detail',
       'waitlist_started',
       'checkout_confirmed',
       'private_quote_checkout_started',
       'waitlist_offer_checkout_started'
     ]::text[]))
     or p_abuse_hash is null
     or p_abuse_hash !~ '^[0-9a-f]{64}$'
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

  v_allowed_property_keys := case
    when p_event_name = 'page_view'
      then array['utm_source', 'utm_medium', 'utm_campaign']
    when p_event_name = 'course_view'
      then array['utm_source', 'utm_medium', 'utm_campaign', 'course_slug']
    when p_event_name in (
      'cta_private_workshop',
      'cta_workshops',
      'cta_private_request',
      'cta_workshop_detail'
    ) then array['target_path']
    when p_event_name in ('waitlist_started', 'waitlist_offer_checkout_started')
      then array['workshop_slug']
    else '{}'::text[]
  end;

  if v_properties - v_allowed_property_keys <> '{}'::jsonb
     or exists (
       select 1
       from jsonb_each(v_properties) property
       where jsonb_typeof(property.value) <> 'string'
     ) then
    raise exception using errcode = 'P0001', message = 'invalid_analytics_properties';
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

  if p_event_name = 'course_view' then
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

revoke execute on function public.ingest_analytics_event(text, text, uuid, text, text, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.ingest_analytics_event(text, text, uuid, text, text, text, text, text, text, jsonb, timestamptz)
  to service_role;

-- A raised process_stripe_event transaction cannot persist its own failure
-- update. Keep failure attempts in a separate table so recording them never
-- consumes the event id that Stripe must be able to retry.
create table private.stripe_webhook_failures (
  id uuid primary key default extensions.gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  attempts integer not null default 1,
  last_error text not null,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  constraint stripe_webhook_failures_event_id_nonempty check (
    length(trim(stripe_event_id)) between 4 and 255
  ),
  constraint stripe_webhook_failures_event_type_nonempty check (
    length(trim(event_type)) between 3 and 255
  ),
  constraint stripe_webhook_failures_attempts_positive check (attempts > 0)
);

create index stripe_webhook_failures_last_failed_idx
  on private.stripe_webhook_failures (last_failed_at desc);

alter table private.stripe_webhook_failures enable row level security;
revoke all on private.stripe_webhook_failures from public, anon, authenticated;
grant select, insert, update on private.stripe_webhook_failures to service_role;

create or replace function public.record_stripe_webhook_failure(
  p_stripe_event_id text,
  p_event_type text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failure private.stripe_webhook_failures%rowtype;
begin
  if length(trim(coalesce(p_stripe_event_id, ''))) not between 4 and 255
     or length(trim(coalesce(p_event_type, ''))) not between 3 and 255
     or length(trim(coalesce(p_error, ''))) = 0 then
    raise exception using errcode = 'P0001', message = 'stripe_webhook_failure_invalid';
  end if;

  insert into private.stripe_webhook_failures (
    stripe_event_id,
    event_type,
    last_error
  ) values (
    trim(p_stripe_event_id),
    trim(p_event_type),
    left(trim(p_error), 2000)
  )
  on conflict (stripe_event_id) do update
    set event_type = excluded.event_type,
        attempts = private.stripe_webhook_failures.attempts + 1,
        last_error = excluded.last_error,
        last_failed_at = now()
  returning * into v_failure;

  return jsonb_build_object(
    'stripe_event_id', v_failure.stripe_event_id,
    'attempts', v_failure.attempts,
    'last_failed_at', v_failure.last_failed_at
  );
end;
$$;

revoke execute on function public.record_stripe_webhook_failure(text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_stripe_webhook_failure(text, text, text)
  to service_role;

-- Gmail has no request idempotency key. A durable send intent therefore uses
-- conservative at-most-once behavior for ambiguous transport/post-send
-- failures. Explicit HTTP rejections remain safely retryable below.
alter table private.email_deliveries
  drop constraint email_deliveries_status_valid,
  add column rfc822_message_id text,
  add column send_started_at timestamptz,
  add column uncertain_at timestamptz,
  add constraint email_deliveries_status_valid check (
    status in ('sending', 'sent', 'uncertain', 'retrying', 'failed')
  ),
  add constraint email_deliveries_message_id_safe check (
    rfc822_message_id is null
    or (
      length(rfc822_message_id) between 10 and 254
      and rfc822_message_id !~ E'[\\r\\n]'
    )
  );

create unique index email_deliveries_rfc822_message_id_idx
  on private.email_deliveries (rfc822_message_id)
  where rfc822_message_id is not null;
create index automation_jobs_created_at_idx
  on private.automation_jobs (created_at desc);

create or replace function private.redact_automation_payload(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_payload, '{}'::jsonb)
    - array['invite_url', 'offer_token', 'payment_url', 'quote_token', 'checkout_token']::text[];
$$;

revoke execute on function private.redact_automation_payload(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.redact_terminal_automation_job()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.job_type = 'email' and new.status in ('completed', 'cancelled') then
    new.payload := private.redact_automation_payload(new.payload);
  end if;
  return new;
end;
$$;

revoke execute on function private.redact_terminal_automation_job()
  from public, anon, authenticated, service_role;

create trigger automation_jobs_redact_terminal_payload
before update on private.automation_jobs
for each row execute function private.redact_terminal_automation_job();

update private.automation_jobs
set payload = private.redact_automation_payload(payload),
    updated_at = now()
where job_type = 'email'
  and status in ('completed', 'cancelled');

create or replace function public.inspect_email_delivery(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_delivery private.email_deliveries%rowtype;
begin
  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and job_type = 'email'
    and status = 'processing'
    and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  select * into v_delivery
  from private.email_deliveries
  where automation_job_id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('state', 'none');
  end if;

  return jsonb_build_object(
    'state', v_delivery.status,
    'provider_message_id', v_delivery.provider_message_id,
    'rfc822_message_id', v_delivery.rfc822_message_id,
    'template', v_delivery.template,
    'recipient', v_delivery.recipient
  );
end;
$$;

revoke execute on function public.inspect_email_delivery(uuid, text)
  from public, anon, authenticated;
grant execute on function public.inspect_email_delivery(uuid, text)
  to service_role;

create or replace function public.begin_email_delivery(
  p_job_id uuid,
  p_worker_id text,
  p_template text,
  p_recipient text,
  p_rfc822_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_delivery private.email_deliveries%rowtype;
begin
  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and job_type = 'email'
    and status = 'processing'
    and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  if p_template is null
     or length(trim(p_template)) = 0
     or p_recipient is null
     or length(trim(p_recipient)) < 4
     or p_rfc822_message_id is null
     or p_rfc822_message_id !~ '^<clearstep\.[0-9a-f]{32}@[A-Za-z0-9.-]+>$' then
    raise exception using errcode = 'P0001', message = 'email_delivery_intent_invalid';
  end if;

  select * into v_delivery
  from private.email_deliveries
  where automation_job_id = p_job_id
  for update;

  if found then
    if lower(v_delivery.recipient::text) <> lower(trim(p_recipient))
       or v_delivery.template <> p_template then
      raise exception using errcode = 'P0001', message = 'email_delivery_intent_mismatch';
    end if;

    if v_delivery.status = 'sent' then
      return jsonb_build_object(
        'should_send', false,
        'state', 'sent',
        'provider_message_id', v_delivery.provider_message_id,
        'rfc822_message_id', v_delivery.rfc822_message_id
      );
    elsif v_delivery.status = 'retrying' then
      update private.email_deliveries
         set status = 'sending',
             rfc822_message_id = p_rfc822_message_id,
             send_started_at = now(),
             uncertain_at = null,
             last_error = null,
             attempts = v_job.attempts,
             updated_at = now()
       where id = v_delivery.id;
      return jsonb_build_object('should_send', true, 'state', 'sending');
    else
      update private.email_deliveries
         set status = 'uncertain',
             uncertain_at = coalesce(uncertain_at, now()),
             last_error = coalesce(last_error, 'email_delivery_interrupted'),
             updated_at = now()
       where id = v_delivery.id
         and status <> 'sent';
      return jsonb_build_object('should_send', false, 'state', 'uncertain');
    end if;
  end if;

  insert into private.email_deliveries (
    automation_job_id,
    template,
    recipient,
    status,
    rfc822_message_id,
    attempts,
    send_started_at
  ) values (
    p_job_id,
    p_template,
    lower(trim(p_recipient)),
    'sending',
    p_rfc822_message_id,
    v_job.attempts,
    now()
  );

  return jsonb_build_object('should_send', true, 'state', 'sending');
end;
$$;

revoke execute on function public.begin_email_delivery(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.begin_email_delivery(uuid, text, text, text, text)
  to service_role;

create or replace function public.mark_email_delivery_sent(
  p_job_id uuid,
  p_worker_id text,
  p_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_delivery private.email_deliveries%rowtype;
begin
  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and job_type = 'email'
    and status = 'processing'
    and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  select * into v_delivery
  from private.email_deliveries
  where automation_job_id = p_job_id
  for update;

  if not found or v_delivery.status not in ('sending', 'sent') then
    raise exception using errcode = 'P0001', message = 'email_delivery_not_sendable';
  end if;

  if p_provider_message_id is null or length(trim(p_provider_message_id)) = 0 then
    raise exception using errcode = 'P0001', message = 'email_provider_message_id_invalid';
  end if;

  if v_delivery.status = 'sending' then
    update private.email_deliveries
       set status = 'sent',
           provider_message_id = left(p_provider_message_id, 500),
           sent_at = now(),
           last_error = null,
           updated_at = now()
     where id = v_delivery.id
    returning * into v_delivery;
  end if;

  update private.automation_jobs
     set payload = private.redact_automation_payload(payload),
         updated_at = now()
   where id = p_job_id;

  return jsonb_build_object(
    'state', 'sent',
    'provider_message_id', v_delivery.provider_message_id,
    'rfc822_message_id', v_delivery.rfc822_message_id
  );
end;
$$;

revoke execute on function public.mark_email_delivery_sent(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_email_delivery_sent(uuid, text, text)
  to service_role;

create or replace function public.fail_uncertain_email_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text default 'email_delivery_uncertain'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
begin
  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and job_type = 'email'
    and status = 'processing'
    and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  update private.email_deliveries
     set status = 'uncertain',
         uncertain_at = coalesce(uncertain_at, now()),
         attempts = v_job.attempts,
         last_error = left(coalesce(p_error, 'email_delivery_uncertain'), 2000),
         updated_at = now()
   where automation_job_id = p_job_id
     and status <> 'sent';

  update private.automation_jobs
     set status = 'failed',
         last_error = left(coalesce(p_error, 'email_delivery_uncertain'), 2000),
         locked_at = null,
         locked_by = null,
         updated_at = now()
   where id = p_job_id;

  if v_job.pgmq_message_id is null
     or not pgmq.archive('clearstep_automation', v_job.pgmq_message_id) then
    raise exception using errcode = 'P0001', message = 'automation_queue_archive_failed';
  end if;

  perform public.record_integration_health(
    'google_gmail',
    false,
    left(coalesce(p_error, 'email_delivery_uncertain'), 2000),
    jsonb_build_object('job_id', p_job_id, 'delivery_state', 'uncertain')
  );

  return jsonb_build_object('job_id', p_job_id, 'status', 'failed', 'delivery_state', 'uncertain');
end;
$$;

revoke execute on function public.fail_uncertain_email_job(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_uncertain_email_job(uuid, text, text)
  to service_role;

-- An explicit Gmail HTTP response proves that Gmail rejected the request. It
-- is therefore safe to retry 401/429/5xx responses without converting the
-- durable send intent into an ambiguous delivery. Transport failures remain
-- on the conservative uncertain path above.
create or replace function public.retry_unsent_email_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_retryable boolean,
  p_retry_after_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_delivery private.email_deliveries%rowtype;
  v_next_status text;
  v_retry_delay integer;
begin
  if p_retryable is null then
    raise exception using errcode = 'P0001', message = 'email_retry_policy_invalid';
  end if;
  if p_retry_after_seconds is not null
     and (p_retry_after_seconds < 0 or p_retry_after_seconds > 86400) then
    raise exception using errcode = 'P0001', message = 'email_retry_delay_invalid';
  end if;

  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and job_type = 'email'
    and status = 'processing'
    and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  select * into v_delivery
  from private.email_deliveries
  where automation_job_id = p_job_id
  for update;

  if not found or v_delivery.status not in ('sending', 'retrying') then
    raise exception using errcode = 'P0001', message = 'email_delivery_not_retryable';
  end if;

  v_next_status := case
    when not p_retryable or v_job.attempts >= v_job.max_attempts then 'failed'
    else 'pending'
  end;
  v_retry_delay := least(
    86400,
    greatest(
      least(3600, power(2, v_job.attempts)::integer * 30),
      coalesce(p_retry_after_seconds, 0)
    )
  );

  update private.email_deliveries
     set status = case when v_next_status = 'pending' then 'retrying' else 'failed' end,
         attempts = v_job.attempts,
         last_error = left(coalesce(p_error, 'gmail_request_rejected'), 2000),
         send_started_at = null,
         uncertain_at = null,
         updated_at = now()
   where id = v_delivery.id;

  update private.automation_jobs
     set status = v_next_status,
         last_error = left(coalesce(p_error, 'gmail_request_rejected'), 2000),
         available_at = case
           when v_next_status = 'pending' then now() + make_interval(secs => v_retry_delay)
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

  perform public.record_integration_health(
    'google_gmail',
    false,
    left(coalesce(p_error, 'gmail_request_rejected'), 2000),
    jsonb_build_object(
      'job_id', p_job_id,
      'delivery_state', case when v_next_status = 'pending' then 'retrying' else 'failed' end,
      'retryable', p_retryable,
      'retry_after_seconds', case when v_next_status = 'pending' then v_retry_delay else null end
    )
  );

  return jsonb_build_object(
    'job_id', p_job_id,
    'status', v_next_status,
    'delivery_state', case when v_next_status = 'pending' then 'retrying' else 'failed' end,
    'retry_after_seconds', case when v_next_status = 'pending' then v_retry_delay else null end
  );
end;
$$;

revoke execute on function public.retry_unsent_email_job(uuid, text, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.retry_unsent_email_job(uuid, text, text, boolean, integer)
  to service_role;

-- Owner operations expose delivery state without exposing email bodies or raw
-- action links. Ambiguous deliveries require a deliberate, audited choice
-- after the owner checks the Gmail Sent folder.
create or replace function public.list_automation_jobs_with_delivery_state(
  p_actor_user_id uuid,
  p_limit integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;
  if p_limit < 1 or p_limit > 500 then
    raise exception using errcode = 'P0001', message = 'automation_job_limit_invalid';
  end if;

  select jsonb_build_object(
    'jobs', coalesce(jsonb_agg(jsonb_build_object(
      'id', jobs.id,
      'job_type', jobs.job_type,
      'status', jobs.status,
      'attempts', jobs.attempts,
      'max_attempts', jobs.max_attempts,
      'available_at', jobs.available_at,
      'last_error', jobs.last_error,
      'created_at', jobs.created_at,
      'completed_at', jobs.completed_at,
      'email_delivery_status', jobs.email_delivery_status,
      'requires_reconciliation', jobs.email_delivery_status = 'uncertain'
    ) order by jobs.created_at desc), '[]'::jsonb)
  ) into v_result
  from (
    select j.*, ed.status as email_delivery_status
    from private.automation_jobs j
    left join private.email_deliveries ed on ed.automation_job_id = j.id
    order by j.created_at desc
    limit p_limit
  ) jobs;

  return coalesce(v_result, jsonb_build_object('jobs', '[]'::jsonb));
end;
$$;

revoke execute on function public.list_automation_jobs_with_delivery_state(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_automation_jobs_with_delivery_state(uuid, integer)
  to service_role;

create or replace function public.reconcile_email_delivery(
  p_actor_user_id uuid,
  p_job_id uuid,
  p_resolution text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_delivery private.email_deliveries%rowtype;
  v_message_id bigint;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner']) then
    raise exception using errcode = 'P0001', message = 'staff_owner_required';
  end if;
  if p_resolution not in ('confirm_sent', 'retry_unsent') then
    raise exception using errcode = 'P0001', message = 'email_reconciliation_resolution_invalid';
  end if;

  select * into v_job
  from private.automation_jobs
  where id = p_job_id and job_type = 'email' and status = 'failed'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'email_reconciliation_job_invalid';
  end if;

  select * into v_delivery
  from private.email_deliveries
  where automation_job_id = p_job_id
    and status in ('uncertain', 'failed')
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'email_delivery_not_reconcilable';
  end if;

  if p_resolution = 'confirm_sent' then
    if v_delivery.status <> 'uncertain' then
      raise exception using errcode = 'P0001', message = 'email_delivery_not_uncertain';
    end if;

    update private.email_deliveries
       set status = 'sent',
           sent_at = coalesce(sent_at, now()),
           last_error = null,
           uncertain_at = null,
           updated_at = now()
     where id = v_delivery.id;

    update private.automation_jobs
       set status = 'completed',
           payload = private.redact_automation_payload(payload),
           output = coalesce(output, '{}'::jsonb) || jsonb_build_object(
             'delivery_reconciled', true,
             'resolution', p_resolution
           ),
           last_error = null,
           completed_at = now(),
           updated_at = now()
     where id = p_job_id;
  else
    if (
      (v_job.payload ->> 'template' = 'staff_invite'
        and nullif(v_job.payload ->> 'invite_url', '') is null)
      or (v_job.payload ->> 'template' = 'waitlist_offer'
        and nullif(v_job.payload ->> 'offer_token', '') is null)
      or (v_job.payload ->> 'template' = 'private_quote'
        and nullif(v_job.payload ->> 'payment_url', '') is null)
    ) then
      raise exception using errcode = 'P0001', message = 'email_sensitive_payload_expired';
    end if;

    select * into v_message_id
    from pgmq.send(
      queue_name => 'clearstep_automation',
      msg => jsonb_build_object('job_id', v_job.id, 'job_type', v_job.job_type),
      delay => 0
    );

    update private.email_deliveries
       set status = 'retrying',
           attempts = 0,
           last_error = 'owner_verified_unsent',
           send_started_at = null,
           uncertain_at = null,
           updated_at = now()
     where id = v_delivery.id;

    update private.automation_jobs
       set status = 'pending',
           attempts = 0,
           available_at = now(),
           locked_at = null,
           locked_by = null,
           last_error = null,
           pgmq_message_id = v_message_id,
           completed_at = null,
           updated_at = now()
     where id = p_job_id;
  end if;

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'automation.email_delivery_reconciled',
    'automation_job',
    p_job_id::text,
    jsonb_build_object(
      'resolution', p_resolution,
      'prior_delivery_status', v_delivery.status
    )
  );

  return jsonb_build_object(
    'job_id', p_job_id,
    'status', case when p_resolution = 'confirm_sent' then 'completed' else 'pending' end,
    'resolution', p_resolution
  );
end;
$$;

revoke execute on function public.reconcile_email_delivery(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_email_delivery(uuid, uuid, text)
  to service_role;

create or replace function public.retry_non_email_automation_job(
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
  where id = p_job_id and status = 'failed' and job_type <> 'email'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_not_retryable';
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
         pgmq_message_id = v_message_id,
         completed_at = null,
         updated_at = now()
   where id = v_job.id;

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'automation.job_retried',
    'automation_job',
    v_job.id::text,
    jsonb_build_object('job_type', v_job.job_type)
  );

  return jsonb_build_object('job_id', v_job.id, 'status', 'pending');
end;
$$;

revoke execute on function public.retry_non_email_automation_job(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.retry_non_email_automation_job(uuid, uuid)
  to service_role;

-- Serialize Calendar writes per session across concurrent worker invocations.
create table private.calendar_session_leases (
  session_id uuid primary key references public.workshop_sessions(id) on delete cascade,
  automation_job_id uuid not null references private.automation_jobs(id) on delete cascade,
  worker_id text not null,
  expires_at timestamptz not null,
  acquired_at timestamptz not null default now(),
  constraint calendar_session_leases_worker_nonempty check (length(trim(worker_id)) > 0)
);

create index calendar_session_leases_expiry_idx
  on private.calendar_session_leases (expires_at);
create index calendar_session_leases_automation_job_idx
  on private.calendar_session_leases (automation_job_id, worker_id);

alter table private.calendar_session_leases enable row level security;
revoke all on private.calendar_session_leases from public, anon, authenticated;
grant select, insert, update, delete on private.calendar_session_leases to service_role;

create or replace function public.acquire_calendar_session_lease(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_session_id uuid;
  v_lease private.calendar_session_leases%rowtype;
begin
  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and job_type in ('calendar_session', 'calendar_enrollment', 'calendar_enrollment_remove')
    and status = 'processing'
    and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  v_session_id := nullif(v_job.payload ->> 'session_id', '')::uuid;
  if v_session_id is null then
    raise exception using errcode = 'P0001', message = 'calendar_session_id_missing';
  end if;

  insert into private.calendar_session_leases (
    session_id,
    automation_job_id,
    worker_id,
    expires_at
  ) values (
    v_session_id,
    p_job_id,
    left(p_worker_id, 200),
    now() + interval '12 minutes'
  )
  on conflict (session_id) do update
    set automation_job_id = excluded.automation_job_id,
        worker_id = excluded.worker_id,
        expires_at = excluded.expires_at,
        acquired_at = now()
  where private.calendar_session_leases.expires_at <= now()
     or (
       private.calendar_session_leases.automation_job_id = excluded.automation_job_id
       and private.calendar_session_leases.worker_id = excluded.worker_id
     )
  returning * into v_lease;

  return jsonb_build_object(
    'acquired', v_lease.session_id is not null,
    'session_id', v_session_id,
    'expires_at', v_lease.expires_at
  );
end;
$$;

revoke execute on function public.acquire_calendar_session_lease(uuid, text)
  from public, anon, authenticated;
grant execute on function public.acquire_calendar_session_lease(uuid, text)
  to service_role;

create or replace function public.release_calendar_session_lease(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  delete from private.calendar_session_leases
  where automation_job_id = p_job_id
    and worker_id = left(p_worker_id, 200)
  returning session_id into v_session_id;

  return jsonb_build_object('released', v_session_id is not null, 'session_id', v_session_id);
end;
$$;

revoke execute on function public.release_calendar_session_lease(uuid, text)
  from public, anon, authenticated;
grant execute on function public.release_calendar_session_lease(uuid, text)
  to service_role;

-- Calendar job payloads are only identifiers. Rebuild mutable event fields
-- from the locked database record so an older queued job cannot revert a
-- later session edit.
create or replace function public.resolve_calendar_session_job(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_session record;
begin
  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and job_type = 'calendar_session'
    and status = 'processing'
    and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  select
    s.id,
    s.updated_at as conference_revision,
    c.title as course_title,
    s.start_at,
    s.end_at,
    s.timezone,
    s.format,
    s.status,
    s.venue,
    si.google_event_id
  into v_session
  from public.workshop_sessions s
  join public.courses c on c.id = s.course_id
  left join private.session_integrations si on si.session_id = s.id
  where s.id = nullif(v_job.payload ->> 'session_id', '')::uuid
  for share of s, c;

  if not found then
    raise exception using errcode = 'P0001', message = 'calendar_session_not_found';
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'conference_revision', v_session.conference_revision,
    'course_title', v_session.course_title,
    'start_at', v_session.start_at,
    'end_at', v_session.end_at,
    'timezone', v_session.timezone,
    'format', v_session.format,
    'session_status', v_session.status,
    'should_apply', v_session.status in ('draft', 'scheduled', 'sold_out'),
    'venue', v_session.venue,
    'google_event_id', v_session.google_event_id
  );
end;
$$;

revoke execute on function public.resolve_calendar_session_job(uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_calendar_session_job(uuid, text)
  to service_role;

-- Enrollment Calendar work is authorized from current database state rather
-- than trusting a queued payload. A stale add after a refund becomes a no-op,
-- and removal runs only for a fully refunded enrollment.
create or replace function public.resolve_calendar_enrollment_job(
  p_job_id uuid,
  p_worker_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_enrollment public.enrollments%rowtype;
  v_session record;
  v_google_event_id text;
  v_should_apply boolean;
begin
  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and job_type in ('calendar_enrollment', 'calendar_enrollment_remove')
    and status = 'processing'
    and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  select * into v_enrollment
  from public.enrollments
  where id = nullif(v_job.payload ->> 'enrollment_id', '')::uuid
    and session_id = nullif(v_job.payload ->> 'session_id', '')::uuid
  for share;

  if not found
     or nullif(v_job.payload ->> 'attendee_email', '') is null
     or lower(v_enrollment.attendee_email::text) <>
       lower(nullif(v_job.payload ->> 'attendee_email', '')) then
    raise exception using errcode = 'P0001', message = 'calendar_enrollment_payload_mismatch';
  end if;

  select si.google_event_id into v_google_event_id
  from private.session_integrations si
  where si.session_id = v_enrollment.session_id;

  select
    c.title as course_title,
    s.updated_at as conference_revision,
    s.start_at,
    s.end_at,
    s.timezone,
    s.format,
    s.status,
    s.venue
  into v_session
  from public.workshop_sessions s
  join public.courses c on c.id = s.course_id
  where s.id = v_enrollment.session_id
  for share of s, c;

  if not found then
    raise exception using errcode = 'P0001', message = 'calendar_session_not_found';
  end if;

  v_should_apply := case
    when v_job.job_type = 'calendar_enrollment'
      then v_enrollment.status = 'confirmed'
        and v_session.status in ('draft', 'scheduled', 'sold_out')
    when v_job.job_type = 'calendar_enrollment_remove'
      then v_enrollment.status = 'refunded'
    else false
  end;

  return jsonb_build_object(
    'job_type', v_job.job_type,
    'should_apply', v_should_apply,
    'enrollment_status', v_enrollment.status,
    'enrollment_id', v_enrollment.id,
    'session_id', v_enrollment.session_id,
    'conference_revision', v_session.conference_revision,
    'attendee_email', v_enrollment.attendee_email,
    'attendee_name', v_enrollment.attendee_name,
    'google_event_id', v_google_event_id,
    'course_title', v_session.course_title,
    'start_at', v_session.start_at,
    'end_at', v_session.end_at,
    'timezone', v_session.timezone,
    'format', v_session.format,
    'session_status', v_session.status,
    'venue', v_session.venue
  );
end;
$$;

revoke execute on function public.resolve_calendar_enrollment_job(uuid, text)
  from public, anon, authenticated;
grant execute on function public.resolve_calendar_enrollment_job(uuid, text)
  to service_role;

-- Persist the provider's current event state exactly. In particular, a
-- format change to in-person must clear the old Meet URL instead of letting
-- the legacy completion upsert preserve it with coalesce.
create or replace function public.apply_calendar_integration_state(
  p_job_id uuid,
  p_worker_id text,
  p_google_event_id text,
  p_meet_url text,
  p_format text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.automation_jobs%rowtype;
  v_session_format text;
  v_session_status text;
  v_session_id uuid;
begin
  select * into v_job
  from private.automation_jobs
  where id = p_job_id
    and job_type in ('calendar_session', 'calendar_enrollment')
    and status = 'processing'
    and locked_by = left(p_worker_id, 200)
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'automation_job_lock_mismatch';
  end if;

  v_session_id := nullif(v_job.payload ->> 'session_id', '')::uuid;
  select format, status into v_session_format, v_session_status
  from public.workshop_sessions
  where id = v_session_id
  for share;

  if not found
     or p_format is distinct from v_session_format
     or v_session_status not in ('draft', 'scheduled', 'sold_out')
     or length(trim(coalesce(p_google_event_id, ''))) = 0
     or (v_session_format = 'in_person' and p_meet_url is not null)
     or (
       v_session_format in ('online', 'hybrid')
       and length(trim(coalesce(p_meet_url, ''))) = 0
     ) then
    raise exception using errcode = 'P0001', message = 'calendar_integration_state_invalid';
  end if;

  insert into private.session_integrations (session_id, google_event_id, meet_url)
  values (v_session_id, p_google_event_id, p_meet_url)
  on conflict (session_id) do update
    set google_event_id = excluded.google_event_id,
        meet_url = excluded.meet_url,
        updated_at = now();

  return jsonb_build_object(
    'session_id', v_session_id,
    'google_event_id', p_google_event_id,
    'meet_url', p_meet_url,
    'format', v_session_format
  );
end;
$$;

revoke execute on function public.apply_calendar_integration_state(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_calendar_integration_state(uuid, text, text, text, text)
  to service_role;

-- A private quote must still have enough lifetime for Stripe's 30-minute
-- minimum Checkout window plus the existing one-minute creation cushion.
create or replace function public.create_private_quote_checkout_hold(
  p_quote_id uuid,
  p_quote_checkout_expires_at timestamptz,
  p_session_id uuid,
  p_user_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote private.private_workshop_quotes%rowtype;
  v_result jsonb;
  v_effective_expires_at timestamptz;
begin
  select * into v_quote
  from private.private_workshop_quotes
  where id = p_quote_id
    and session_id = p_session_id
    and customer_user_id = p_user_id
    and status = 'sent'
    and checkout_expires_at = p_quote_checkout_expires_at
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'private_quote_invalid_or_expired';
  end if;

  if v_quote.checkout_expires_at <= now() + interval '31 minutes' then
    raise exception using errcode = 'P0001', message = 'private_quote_checkout_window_too_short';
  end if;

  v_result := public.create_checkout_hold(
    p_session_id,
    p_user_id,
    p_email,
    null
  );

  v_effective_expires_at := least(
    (v_result ->> 'hold_expires_at')::timestamptz,
    v_quote.checkout_expires_at
  );

  if v_effective_expires_at <= now() + interval '30 minutes' then
    raise exception using errcode = 'P0001', message = 'private_quote_checkout_window_too_short';
  end if;

  update private.seat_holds
     set expires_at = v_effective_expires_at,
         updated_at = now()
   where id = (v_result ->> 'hold_id')::uuid
     and user_id = p_user_id;

  update private.checkout_attempts
     set expires_at = v_effective_expires_at,
         grace_expires_at = least(
           v_effective_expires_at + interval '15 minutes',
           (v_result ->> 'start_at')::timestamptz
         ),
         updated_at = now()
   where id = (v_result ->> 'checkout_id')::uuid
     and user_id = p_user_id;

  return jsonb_set(
    jsonb_set(
      v_result,
      '{hold_expires_at}',
      to_jsonb(v_effective_expires_at),
      false
    ),
    '{checkout_expires_at}',
    to_jsonb(v_effective_expires_at),
    false
  );
end;
$$;

revoke execute on function public.create_private_quote_checkout_hold(uuid, timestamptz, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_private_quote_checkout_hold(uuid, timestamptz, uuid, uuid, text)
  to service_role;

create or replace function private.purge_runtime_security_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limits_deleted integer;
  v_leases_deleted integer;
  v_payloads_redacted integer;
begin
  delete from private.analytics_rate_limits
  where expires_at <= now();
  get diagnostics v_rate_limits_deleted = row_count;

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
    'calendar_leases_deleted', v_leases_deleted,
    'sensitive_payloads_redacted', v_payloads_redacted,
    'ran_at', now()
  );
end;
$$;

revoke execute on function private.purge_runtime_security_state()
  from public, anon, authenticated, service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'clearstep-runtime-security-retention';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'clearstep-runtime-security-retention',
    '17 * * * *',
    'select private.purge_runtime_security_state()'
  );
end;
$$;
