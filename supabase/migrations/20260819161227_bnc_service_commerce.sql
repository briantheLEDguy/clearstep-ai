-- Add BNC service commerce without treating service packages as workshops.
-- Stripe identifiers stay out of migrations: seeded offerings remain draft
-- until test-mode Products and VAT-inclusive one-time Prices are verified and
-- attached through the staff-only administration path.

create table public.service_lines (
  id text primary key,
  url_slug text not null unique,
  name text not null,
  summary text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_lines_id_format
    check (id ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint service_lines_url_slug_format
    check (url_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint service_lines_name_bounds
    check (length(trim(name)) between 1 and 240),
  constraint service_lines_summary_bounds
    check (length(trim(summary)) between 1 and 1000),
  constraint service_lines_status_valid
    check (status in ('active', 'archived'))
);

create table public.service_offerings (
  id uuid primary key default extensions.gen_random_uuid(),
  service_line_id text not null references public.service_lines(id) on delete restrict,
  slug text not null,
  title text not null,
  summary text not null,
  description text not null,
  outcomes text[] not null default '{}',
  audience text not null default '',
  duration_minutes integer,
  fulfillment_method text not null default 'manual_scheduling',
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
  constraint service_offerings_line_slug_key unique (service_line_id, slug),
  constraint service_offerings_slug_format
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint service_offerings_title_bounds
    check (length(trim(title)) between 1 and 240),
  constraint service_offerings_summary_bounds
    check (length(trim(summary)) between 1 and 1000),
  constraint service_offerings_description_bounds
    check (length(trim(description)) between 1 and 10000),
  constraint service_offerings_outcomes_valid
    check (private.valid_course_outcomes(outcomes)),
  constraint service_offerings_audience_bounds
    check (length(audience) <= 2000),
  constraint service_offerings_duration_positive
    check (duration_minutes is null or duration_minutes > 0),
  constraint service_offerings_fulfillment_method_valid
    check (fulfillment_method = 'manual_scheduling'),
  constraint service_offerings_price_positive check (price_cents > 0),
  constraint service_offerings_currency_eur check (currency = 'EUR'),
  constraint service_offerings_stripe_product_format
    check (stripe_product_id is null or stripe_product_id ~ '^prod_[A-Za-z0-9]+$'),
  constraint service_offerings_stripe_price_format
    check (stripe_price_id is null or stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  constraint service_offerings_stripe_pair
    check ((stripe_product_id is null) = (stripe_price_id is null)),
  constraint service_offerings_published_stripe_required check (
    status <> 'published'
    or (stripe_product_id is not null and stripe_price_id is not null)
  ),
  constraint service_offerings_visibility_valid
    check (visibility in ('public', 'private')),
  constraint service_offerings_status_valid
    check (status in ('draft', 'published', 'archived')),
  constraint service_offerings_seo_title_bounds
    check (seo_title is null or length(trim(seo_title)) between 1 and 240),
  constraint service_offerings_seo_description_bounds
    check (seo_description is null or length(trim(seo_description)) between 1 and 1000)
);

create index service_offerings_public_catalog_idx
  on public.service_offerings (service_line_id, status, price_cents, title);
create index service_offerings_created_by_idx
  on public.service_offerings (created_by)
  where created_by is not null;

alter table public.service_lines enable row level security;
alter table public.service_offerings enable row level security;

create policy service_lines_public_read
on public.service_lines for select
to anon, authenticated
using (status = 'active');

create policy service_offerings_public_read
on public.service_offerings for select
to anon, authenticated
using (
  status = 'published'
  and visibility = 'public'
  and stripe_product_id is not null
  and stripe_price_id is not null
  and exists (
    select 1
    from public.service_lines service_line
    where service_line.id = service_offerings.service_line_id
      and service_line.status = 'active'
  )
);

revoke all on public.service_lines, public.service_offerings from anon, authenticated;
grant select (id, url_slug, name, summary, status)
  on public.service_lines to anon, authenticated;
grant select (
  id,
  service_line_id,
  slug,
  title,
  summary,
  description,
  outcomes,
  audience,
  duration_minutes,
  fulfillment_method,
  price_cents,
  currency,
  visibility,
  status,
  seo_title,
  seo_description
) on public.service_offerings to anon, authenticated;
grant select, insert, update, delete
  on public.service_lines, public.service_offerings to service_role;

insert into public.service_lines (id, url_slug, name, summary, status)
values
  (
    'clearstep',
    'clearstep',
    'Clearstep AI',
    'Practical AI workshops and learning resources.',
    'active'
  ),
  (
    'plate_and_post',
    'plate-and-post',
    'Plate & Post',
    'Product photography and social media content creation for food-related projects.',
    'active'
  )
on conflict (id) do nothing;

alter table public.courses
  add column service_line_id text references public.service_lines(id) on delete restrict;

update public.courses
set service_line_id = 'clearstep'
where service_line_id is null;

alter table public.courses
  alter column service_line_id set not null,
  alter column service_line_id set default 'clearstep',
  add constraint courses_clearstep_service_line check (
    service_line_id = 'clearstep'
  );

create index courses_service_line_idx on public.courses (service_line_id, status);

insert into public.service_offerings (
  id,
  service_line_id,
  slug,
  title,
  summary,
  description,
  outcomes,
  audience,
  duration_minutes,
  fulfillment_method,
  price_cents,
  currency,
  visibility,
  status,
  seo_title,
  seo_description
)
select
  seed.id,
  service_line.id,
  seed.slug,
  seed.title,
  seed.summary,
  seed.description,
  seed.outcomes,
  seed.audience,
  null,
  'manual_scheduling',
  seed.price_cents,
  'EUR',
  'public',
  'draft',
  seed.seo_title,
  seed.seo_description
from public.service_lines service_line
cross join (
  values
    (
      '5b010000-0000-4000-8000-000000000001'::uuid,
      'basic-product-shoot',
      'Basic Product Shoot',
      'A focused food product photography package.',
      'Product photography for a food-related product or project.',
      '{}'::text[],
      'Food brands, restaurants, and hospitality businesses.',
      5000,
      'Basic Product Shoot | Plate & Post',
      'Food product photography from Plate & Post.'
    ),
    (
      '5b010000-0000-4000-8000-000000000002'::uuid,
      'video-content',
      'Video Content',
      'Short-form video content for a food-related project.',
      'Video content creation for food brands, restaurants, and hospitality projects.',
      '{}'::text[],
      'Food brands, restaurants, and hospitality businesses.',
      7500,
      'Video Content | Plate & Post',
      'Food-focused video content from Plate & Post.'
    ),
    (
      '5b010000-0000-4000-8000-000000000003'::uuid,
      'combo-package',
      'Combo Package',
      'Product photography and video content in one package.',
      'A combined product photography and video content package for a food-related project.',
      '{}'::text[],
      'Food brands, restaurants, and hospitality businesses.',
      10000,
      'Combo Package | Plate & Post',
      'Combined food photography and video content from Plate & Post.'
    )
) as seed(
  id,
  slug,
  title,
  summary,
  description,
  outcomes,
  audience,
  price_cents,
  seo_title,
  seo_description
)
where service_line.id = 'plate_and_post'
on conflict (service_line_id, slug) do nothing;

create or replace function public.public_service_catalog(
  p_business_unit text default 'plate_and_post'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'services',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'catalog_item_id', offering.id,
          'slug', offering.slug,
          'title', offering.title,
          'summary', offering.summary,
          'description', offering.description,
          'outcomes', offering.outcomes,
          'audience', offering.audience,
          'duration_minutes', offering.duration_minutes,
          'fulfillment_method', offering.fulfillment_method,
          'price_cents', offering.price_cents,
          'currency', offering.currency,
          'business_unit', 'plate_and_post',
          'offering_type', 'service_package',
          'service_line_id', service_line.id,
          'service_line_slug', service_line.url_slug,
          'seo_title', offering.seo_title,
          'seo_description', offering.seo_description
        )
        order by offering.price_cents, offering.title
      ),
      '[]'::jsonb
    )
  )
  from public.service_offerings offering
  join public.service_lines service_line on service_line.id = offering.service_line_id
  where p_business_unit = 'plate_and_post'
    and service_line.id = 'plate_and_post'
    and service_line.status = 'active'
    and offering.status = 'published'
    and offering.visibility = 'public'
    and offering.stripe_product_id is not null
    and offering.stripe_price_id is not null;
$$;

revoke execute on function public.public_service_catalog(text) from public;
grant execute on function public.public_service_catalog(text) to anon, authenticated;

alter table private.checkout_attempts
  add column checkout_kind text not null default 'workshop',
  add column service_offering_id uuid
    references public.service_offerings(id) on delete restrict,
  alter column hold_id drop not null,
  alter column session_id drop not null,
  add constraint checkout_attempts_kind_valid
    check (checkout_kind in ('workshop', 'service_order')),
  add constraint checkout_attempts_target_valid check (
    (
      checkout_kind = 'workshop'
      and hold_id is not null
      and session_id is not null
      and service_offering_id is null
    )
    or (
      checkout_kind = 'service_order'
      and hold_id is null
      and session_id is null
      and service_offering_id is not null
    )
  );

drop index private.checkout_attempts_one_active_per_user_session_idx;
create unique index checkout_attempts_one_active_per_user_session_idx
  on private.checkout_attempts (session_id, user_id)
  where checkout_kind = 'workshop'
    and status in ('creating', 'open', 'payment_pending');
create unique index checkout_attempts_one_active_per_user_service_idx
  on private.checkout_attempts (service_offering_id, user_id)
  where checkout_kind = 'service_order'
    and status in ('creating', 'open', 'payment_pending');
create index checkout_attempts_service_offering_idx
  on private.checkout_attempts (service_offering_id, created_at desc)
  where service_offering_id is not null;

create table public.service_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  checkout_attempt_id uuid not null unique
    references private.checkout_attempts(id) on delete restrict,
  service_line_id text not null references public.service_lines(id) on delete restrict,
  service_offering_id uuid not null references public.service_offerings(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_email extensions.citext not null,
  service_line_slug text not null,
  service_slug text not null,
  service_title text not null,
  fulfillment_method text not null,
  payment_status text not null default 'pending',
  fulfillment_status text not null default 'new',
  amount_cents integer not null,
  currency text not null default 'EUR',
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text unique,
  ordered_at timestamptz not null default now(),
  paid_at timestamptz,
  completed_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_orders_line_slug_format
    check (service_line_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint service_orders_slug_format
    check (service_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint service_orders_title_nonempty
    check (length(trim(service_title)) between 1 and 240),
  constraint service_orders_fulfillment_method_valid
    check (fulfillment_method = 'manual_scheduling'),
  constraint service_orders_payment_status_valid
    check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  constraint service_orders_fulfillment_status_valid check (
    fulfillment_status in (
      'new', 'contacted', 'scheduled', 'in_progress', 'delivered', 'cancelled'
    )
  ),
  constraint service_orders_amount_positive check (amount_cents > 0),
  constraint service_orders_currency_eur check (currency = 'EUR'),
  constraint service_orders_checkout_format
    check (stripe_checkout_session_id ~ '^cs_(test_|live_)?[A-Za-z0-9]+$'),
  constraint service_orders_payment_intent_format check (
    stripe_payment_intent_id is null
    or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9]+$'
  ),
  constraint service_orders_paid_timestamp check (
    payment_status not in ('paid', 'refunded') or paid_at is not null
  ),
  constraint service_orders_refund_timestamp check (
    (payment_status = 'refunded') = (refunded_at is not null)
  ),
  constraint service_orders_completion_timestamp check (
    (fulfillment_status = 'delivered') = (completed_at is not null)
  )
);

create index service_orders_user_created_idx
  on public.service_orders (user_id, created_at desc);
create index service_orders_staff_queue_idx
  on public.service_orders (payment_status, fulfillment_status, created_at asc);
create index service_orders_offering_idx
  on public.service_orders (service_offering_id, created_at desc);

alter table public.service_orders enable row level security;

create policy service_orders_own_read
on public.service_orders for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.service_orders from anon, authenticated;
grant select (
  id,
  service_line_id,
  service_offering_id,
  service_line_slug,
  service_slug,
  service_title,
  fulfillment_method,
  payment_status,
  fulfillment_status,
  amount_cents,
  currency,
  ordered_at,
  paid_at,
  completed_at,
  refunded_at,
  created_at,
  updated_at
) on public.service_orders to authenticated;
grant select, insert, update, delete on public.service_orders to service_role;

alter table private.customer_requests
  add column service_order_id uuid references public.service_orders(id) on delete restrict,
  drop constraint customer_requests_kind_valid,
  drop constraint customer_requests_cancellation_enrollment,
  add constraint customer_requests_kind_valid check (
    kind in (
      'access', 'correction', 'erasure', 'restriction', 'objection',
      'cancellation', 'change'
    )
  ),
  add constraint customer_requests_target_shape check (
    (
      kind in ('cancellation', 'change')
      and num_nonnulls(enrollment_id, service_order_id) = 1
    )
    or (
      kind not in ('cancellation', 'change')
      and num_nonnulls(enrollment_id, service_order_id) = 0
    )
  );

create index customer_requests_service_order_idx
  on private.customer_requests (service_order_id, created_at desc)
  where service_order_id is not null;
create index customer_requests_purchase_page_idx
  on private.customer_requests (created_at desc, id desc)
  where kind in ('cancellation', 'change');

alter table private.payment_records
  add column service_order_id uuid references public.service_orders(id) on delete set null,
  add constraint payment_records_single_fulfillment_target
    check (enrollment_id is null or service_order_id is null);

create index payment_records_service_order_idx
  on private.payment_records (service_order_id)
  where service_order_id is not null;

insert into private.retention_registry (data_category, description)
values (
  'service_orders_payments',
  'Plate & Post service orders, payment references, and refund records'
)
on conflict (data_category) do nothing;

create or replace function public.create_service_checkout_attempt(
  p_service_slug text,
  p_user_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service record;
  v_checkout private.checkout_attempts%rowtype;
  v_checkout_expires_at timestamptz;
  v_is_staff boolean;
begin
  if p_user_id is null
     or p_email is null
     or length(trim(p_email)) < 4
     or p_service_slug is null
     or p_service_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception using errcode = 'P0001', message = 'invalid_service_checkout';
  end if;

  v_is_staff := private.staff_has_role(p_user_id, array['owner', 'admin']);

  select
    offering.*,
    service_line.url_slug as service_line_slug,
    service_line.name as service_line_name
  into v_service
  from public.service_offerings offering
  join public.service_lines service_line on service_line.id = offering.service_line_id
  where offering.slug = p_service_slug
    and service_line.id = 'plate_and_post'
    and service_line.status = 'active'
    and offering.visibility = 'public'
    and (
      offering.status = 'published'
      or (offering.status = 'draft' and v_is_staff)
    )
  for update of offering;

  if not found then
    raise exception using errcode = 'P0001', message = 'service_not_available';
  end if;
  if v_service.stripe_product_id is null or v_service.stripe_price_id is null then
    raise exception using errcode = 'P0001', message = 'service_stripe_price_not_configured';
  end if;

  update private.checkout_attempts
  set status = 'expired', updated_at = now()
  where checkout_kind = 'service_order'
    and service_offering_id = v_service.id
    and user_id = p_user_id
    and (
      (status = 'creating' and expires_at <= now())
      or (status = 'open' and grace_expires_at <= now())
    );

  select checkout_attempt.*
  into v_checkout
  from private.checkout_attempts checkout_attempt
  where checkout_attempt.checkout_kind = 'service_order'
    and checkout_attempt.service_offering_id = v_service.id
    and checkout_attempt.user_id = p_user_id
    and checkout_attempt.status in ('creating', 'open', 'payment_pending')
  order by checkout_attempt.created_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'reused', true,
      'checkout_id', v_checkout.id,
      'checkout_status', v_checkout.status,
      'checkout_kind', v_checkout.checkout_kind,
      'stripe_checkout_session_id', v_checkout.stripe_checkout_session_id,
      'hold_id', null,
      'session_id', null,
      'service_offering_id', v_service.id,
      'service_line_id', v_service.service_line_id,
      'service_line_slug', v_service.service_line_slug,
      'service_slug', v_service.slug,
      'service_title', v_service.title,
      'fulfillment_method', v_service.fulfillment_method,
      'checkout_expires_at', v_checkout.expires_at,
      'amount_cents', v_checkout.amount_cents,
      'currency', v_checkout.currency,
      'stripe_product_id', v_service.stripe_product_id,
      'stripe_price_id', v_service.stripe_price_id
    );
  end if;

  v_checkout_expires_at := now() + interval '60 minutes';

  insert into private.checkout_attempts (
    checkout_kind,
    service_offering_id,
    hold_id,
    session_id,
    user_id,
    customer_email,
    amount_cents,
    currency,
    expires_at,
    grace_expires_at
  ) values (
    'service_order',
    v_service.id,
    null,
    null,
    p_user_id,
    lower(trim(p_email)),
    v_service.price_cents,
    v_service.currency,
    v_checkout_expires_at,
    v_checkout_expires_at + interval '15 minutes'
  )
  returning * into v_checkout;

  return jsonb_build_object(
    'reused', false,
    'checkout_id', v_checkout.id,
    'checkout_status', v_checkout.status,
    'checkout_kind', v_checkout.checkout_kind,
    'stripe_checkout_session_id', v_checkout.stripe_checkout_session_id,
    'hold_id', null,
    'session_id', null,
    'service_offering_id', v_service.id,
    'service_line_id', v_service.service_line_id,
    'service_line_slug', v_service.service_line_slug,
    'service_slug', v_service.slug,
    'service_title', v_service.title,
    'fulfillment_method', v_service.fulfillment_method,
    'checkout_expires_at', v_checkout.expires_at,
    'amount_cents', v_checkout.amount_cents,
    'currency', v_checkout.currency,
    'stripe_product_id', v_service.stripe_product_id,
    'stripe_price_id', v_service.stripe_price_id
  );
end;
$$;

revoke execute on function public.create_service_checkout_attempt(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_service_checkout_attempt(text, uuid, text)
  to service_role;

create or replace function public.attach_service_stripe_checkout(
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
  v_service record;
  v_order public.service_orders%rowtype;
begin
  if p_checkout_id is null
     or p_user_id is null
     or p_stripe_checkout_session_id is null
     or p_stripe_checkout_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$' then
    raise exception using errcode = 'P0001', message = 'invalid_service_checkout_attachment';
  end if;

  select checkout_attempt.*
  into v_checkout
  from private.checkout_attempts checkout_attempt
  where checkout_attempt.id = p_checkout_id
    and checkout_attempt.user_id = p_user_id
    and checkout_attempt.checkout_kind = 'service_order'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'service_checkout_not_attachable';
  end if;

  select service_order.*
  into v_order
  from public.service_orders service_order
  where service_order.checkout_attempt_id = v_checkout.id
  for update;

  if found then
    if v_checkout.status in ('open', 'payment_pending', 'paid')
       and v_checkout.stripe_checkout_session_id = p_stripe_checkout_session_id
       and v_order.stripe_checkout_session_id = p_stripe_checkout_session_id then
      return jsonb_build_object(
        'reused', true,
        'checkout_id', v_checkout.id,
        'service_order_id', v_order.id,
        'stripe_checkout_session_id', v_checkout.stripe_checkout_session_id,
        'expires_at', v_checkout.expires_at,
        'payment_status', v_order.payment_status,
        'fulfillment_status', v_order.fulfillment_status
      );
    end if;
    raise exception using errcode = 'P0001', message = 'service_checkout_not_attachable';
  end if;

  if v_checkout.status <> 'creating'
     or v_checkout.expires_at <= now()
     or v_checkout.stripe_checkout_session_id is not null then
    raise exception using errcode = 'P0001', message = 'service_checkout_not_attachable';
  end if;

  select
    offering.*,
    service_line.id as service_line_key,
    service_line.url_slug as service_line_slug
  into v_service
  from public.service_offerings offering
  join public.service_lines service_line on service_line.id = offering.service_line_id
  where offering.id = v_checkout.service_offering_id
    and service_line.id = 'plate_and_post'
  for update of offering;

  if not found then
    raise exception using errcode = 'P0001', message = 'service_checkout_target_invalid';
  end if;

  update private.checkout_attempts
  set stripe_checkout_session_id = p_stripe_checkout_session_id,
      stripe_customer_id = p_stripe_customer_id,
      status = 'open',
      updated_at = now()
  where id = v_checkout.id
  returning * into v_checkout;

  insert into public.service_orders (
    checkout_attempt_id,
    service_line_id,
    service_offering_id,
    user_id,
    customer_email,
    service_line_slug,
    service_slug,
    service_title,
    fulfillment_method,
    payment_status,
    fulfillment_status,
    amount_cents,
    currency,
    stripe_checkout_session_id
  ) values (
    v_checkout.id,
    v_service.service_line_key,
    v_service.id,
    v_checkout.user_id,
    v_checkout.customer_email,
    v_service.service_line_slug,
    v_service.slug,
    v_service.title,
    v_service.fulfillment_method,
    'pending',
    'new',
    v_checkout.amount_cents,
    v_checkout.currency,
    v_checkout.stripe_checkout_session_id
  )
  returning * into v_order;

  return jsonb_build_object(
    'reused', false,
    'checkout_id', v_checkout.id,
    'service_order_id', v_order.id,
    'stripe_checkout_session_id', v_checkout.stripe_checkout_session_id,
    'expires_at', v_checkout.expires_at,
    'payment_status', v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status
  );
end;
$$;

revoke execute on function public.attach_service_stripe_checkout(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.attach_service_stripe_checkout(uuid, uuid, text, text)
  to service_role;

create or replace function private.service_offering_staff_json(
  p_offering public.service_offerings
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'catalog_item_id', p_offering.id,
    'service_line_id', p_offering.service_line_id,
    'slug', p_offering.slug,
    'title', p_offering.title,
    'summary', p_offering.summary,
    'description', p_offering.description,
    'outcomes', p_offering.outcomes,
    'audience', p_offering.audience,
    'duration_minutes', p_offering.duration_minutes,
    'fulfillment_method', p_offering.fulfillment_method,
    'price_cents', p_offering.price_cents,
    'currency', p_offering.currency,
    'stripe_product_id', p_offering.stripe_product_id,
    'stripe_price_id', p_offering.stripe_price_id,
    'visibility', p_offering.visibility,
    'status', p_offering.status,
    'business_unit', 'plate_and_post',
    'offering_type', 'service_package',
    'seo_title', p_offering.seo_title,
    'seo_description', p_offering.seo_description,
    'created_at', p_offering.created_at,
    'updated_at', p_offering.updated_at
  );
$$;

revoke execute on function private.service_offering_staff_json(public.service_offerings)
  from public, anon, authenticated, service_role;

create or replace function private.service_order_staff_json(
  p_order public.service_orders
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'checkout_attempt_id', p_order.checkout_attempt_id,
    'service_line_id', p_order.service_line_id,
    'catalog_item_id', p_order.service_offering_id,
    'user_id', p_order.user_id,
    'customer_email', p_order.customer_email,
    'service_line_slug', p_order.service_line_slug,
    'service_slug', p_order.service_slug,
    'service_title', p_order.service_title,
    'fulfillment_method', p_order.fulfillment_method,
    'payment_status', p_order.payment_status,
    'fulfillment_status', p_order.fulfillment_status,
    'amount_cents', p_order.amount_cents,
    'currency', p_order.currency,
    'stripe_checkout_session_id', p_order.stripe_checkout_session_id,
    'stripe_payment_intent_id', p_order.stripe_payment_intent_id,
    'ordered_at', p_order.ordered_at,
    'paid_at', p_order.paid_at,
    'completed_at', p_order.completed_at,
    'refunded_at', p_order.refunded_at,
    'created_at', p_order.created_at,
    'updated_at', p_order.updated_at
  );
$$;

revoke execute on function private.service_order_staff_json(public.service_orders)
  from public, anon, authenticated, service_role;

create or replace function private.service_order_account_json(
  p_order public.service_orders
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_order.id,
    'catalog_item_id', p_order.service_offering_id,
    'service_line_id', p_order.service_line_id,
    'service_line_slug', p_order.service_line_slug,
    'service_slug', p_order.service_slug,
    'service_title', p_order.service_title,
    'fulfillment_method', p_order.fulfillment_method,
    'payment_status', p_order.payment_status,
    'fulfillment_status', p_order.fulfillment_status,
    'amount_cents', p_order.amount_cents,
    'currency', p_order.currency,
    'ordered_at', p_order.ordered_at,
    'paid_at', p_order.paid_at,
    'completed_at', p_order.completed_at,
    'refunded_at', p_order.refunded_at,
    'created_at', p_order.created_at,
    'updated_at', p_order.updated_at
  );
$$;

revoke execute on function private.service_order_account_json(public.service_orders)
  from public, anon, authenticated, service_role;

create or replace function public.list_service_offerings_for_staff(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.staff_has_role(p_actor_user_id, array['owner', 'admin']) then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;

  return jsonb_build_object(
    'services',
    coalesce((
      select jsonb_agg(
        private.service_offering_staff_json(offering)
        order by offering.created_at desc, offering.id desc
      )
      from public.service_offerings offering
      join public.service_lines service_line on service_line.id = offering.service_line_id
      where service_line.id = 'plate_and_post'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.list_service_offerings_for_staff(uuid)
  from public, anon, authenticated;
grant execute on function public.list_service_offerings_for_staff(uuid)
  to service_role;

create or replace function public.upsert_service_offering(
  p_actor_user_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service_line_id text;
  v_offering public.service_offerings%rowtype;
  v_catalog_item_id_text text := nullif(trim(coalesce(p_payload ->> 'catalog_item_id', '')), '');
  v_status text := coalesce(nullif(trim(p_payload ->> 'status'), ''), 'draft');
  v_visibility text := coalesce(nullif(trim(p_payload ->> 'visibility'), ''), 'public');
  v_stripe_product_id text := nullif(trim(coalesce(p_payload ->> 'stripe_product_id', '')), '');
  v_stripe_price_id text := nullif(trim(coalesce(p_payload ->> 'stripe_price_id', '')), '');
  v_duration_minutes integer;
  v_price_cents integer;
  v_outcomes text[];
  v_action text;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner', 'admin']) then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'P0001', message = 'invalid_service_offering';
  end if;

  if coalesce(p_payload ->> 'slug', '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or length(trim(coalesce(p_payload ->> 'title', ''))) not between 1 and 240
     or length(trim(coalesce(p_payload ->> 'summary', ''))) not between 1 and 1000
     or length(trim(coalesce(p_payload ->> 'description', ''))) not between 1 and 10000
     or length(trim(coalesce(p_payload ->> 'audience', ''))) not between 1 and 2000
     or v_status not in ('draft', 'published', 'archived')
     or v_visibility not in ('public', 'private')
     or coalesce(
       nullif(trim(p_payload ->> 'fulfillment_method'), ''),
       'manual_scheduling'
     ) <> 'manual_scheduling'
     or coalesce(p_payload ->> 'price_cents', '') !~ '^[1-9][0-9]*$'
     or (
       p_payload ? 'currency'
       and upper(trim(coalesce(p_payload ->> 'currency', ''))) <> 'EUR'
     )
     or (v_stripe_product_id is null) <> (v_stripe_price_id is null)
     or (v_status = 'published' and v_stripe_product_id is null)
     or (v_stripe_product_id is not null and v_stripe_product_id !~ '^prod_[A-Za-z0-9]+$')
     or (v_stripe_price_id is not null and v_stripe_price_id !~ '^price_[A-Za-z0-9]+$')
     or (
       nullif(trim(coalesce(p_payload ->> 'seo_title', '')), '') is not null
       and length(trim(p_payload ->> 'seo_title')) > 240
     )
     or (
       nullif(trim(coalesce(p_payload ->> 'seo_description', '')), '') is not null
       and length(trim(p_payload ->> 'seo_description')) > 1000
     ) then
    raise exception using errcode = 'P0001', message = 'invalid_service_offering';
  end if;

  if coalesce(p_payload -> 'outcomes', '[]'::jsonb) is null
     or jsonb_typeof(coalesce(p_payload -> 'outcomes', '[]'::jsonb)) <> 'array'
     or exists (
       select 1
       from jsonb_array_elements(coalesce(p_payload -> 'outcomes', '[]'::jsonb)) outcome
       where jsonb_typeof(outcome) <> 'string'
     ) then
    raise exception using errcode = 'P0001', message = 'invalid_service_offering';
  end if;

  select array(
    select jsonb_array_elements_text(coalesce(p_payload -> 'outcomes', '[]'::jsonb))
  ) into v_outcomes;
  if not private.valid_course_outcomes(v_outcomes) then
    raise exception using errcode = 'P0001', message = 'invalid_service_offering';
  end if;

  v_price_cents := (p_payload ->> 'price_cents')::integer;
  if nullif(trim(coalesce(p_payload ->> 'duration_minutes', '')), '') is not null then
    if trim(p_payload ->> 'duration_minutes') !~ '^[1-9][0-9]*$' then
      raise exception using errcode = 'P0001', message = 'invalid_service_offering';
    end if;
    v_duration_minutes := (p_payload ->> 'duration_minutes')::integer;
  end if;

  select id into v_service_line_id
  from public.service_lines
  where id = 'plate_and_post' and status = 'active';
  if v_service_line_id is null then
    raise exception using errcode = 'P0001', message = 'service_line_not_available';
  end if;

  if v_catalog_item_id_text is null then
    insert into public.service_offerings (
      service_line_id,
      slug,
      title,
      summary,
      description,
      outcomes,
      audience,
      duration_minutes,
      fulfillment_method,
      price_cents,
      currency,
      stripe_product_id,
      stripe_price_id,
      visibility,
      status,
      seo_title,
      seo_description,
      created_by
    ) values (
      v_service_line_id,
      p_payload ->> 'slug',
      trim(p_payload ->> 'title'),
      trim(p_payload ->> 'summary'),
      trim(p_payload ->> 'description'),
      v_outcomes,
      trim(p_payload ->> 'audience'),
      v_duration_minutes,
      'manual_scheduling',
      v_price_cents,
      'EUR',
      v_stripe_product_id,
      v_stripe_price_id,
      v_visibility,
      v_status,
      nullif(trim(coalesce(p_payload ->> 'seo_title', '')), ''),
      nullif(trim(coalesce(p_payload ->> 'seo_description', '')), ''),
      p_actor_user_id
    )
    returning * into v_offering;
    v_action := 'service_offering.created';
  else
    if v_catalog_item_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'invalid_service_offering';
    end if;

    update public.service_offerings
    set slug = p_payload ->> 'slug',
        title = trim(p_payload ->> 'title'),
        summary = trim(p_payload ->> 'summary'),
        description = trim(p_payload ->> 'description'),
        outcomes = v_outcomes,
        audience = trim(p_payload ->> 'audience'),
        duration_minutes = v_duration_minutes,
        fulfillment_method = 'manual_scheduling',
        price_cents = v_price_cents,
        currency = 'EUR',
        stripe_product_id = v_stripe_product_id,
        stripe_price_id = v_stripe_price_id,
        visibility = v_visibility,
        status = v_status,
        seo_title = nullif(trim(coalesce(p_payload ->> 'seo_title', '')), ''),
        seo_description = nullif(trim(coalesce(p_payload ->> 'seo_description', '')), ''),
        updated_at = now()
    where id = v_catalog_item_id_text::uuid
      and service_line_id = v_service_line_id
    returning * into v_offering;
    v_action := 'service_offering.updated';
  end if;

  if v_offering.id is null then
    raise exception using errcode = 'P0001', message = 'service_offering_not_found';
  end if;

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    v_action,
    'service_offering',
    v_offering.id::text,
    jsonb_build_object(
      'slug', v_offering.slug,
      'status', v_offering.status,
      'price_cents', v_offering.price_cents,
      'currency', v_offering.currency
    )
  );

  return jsonb_build_object(
    'service',
    private.service_offering_staff_json(v_offering)
  );
end;
$$;

revoke execute on function public.upsert_service_offering(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_service_offering(uuid, jsonb)
  to service_role;

create or replace function public.update_service_offering_price(
  p_actor_user_id uuid,
  p_catalog_item_id uuid,
  p_price_cents integer,
  p_stripe_price_id text,
  p_expected_price_cents integer,
  p_expected_stripe_price_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offering public.service_offerings%rowtype;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner', 'admin']) then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;
  if p_price_cents is null
     or p_price_cents <= 0
     or p_stripe_price_id is null
     or p_stripe_price_id !~ '^price_[A-Za-z0-9]+$' then
    raise exception using errcode = 'P0001', message = 'service_price_invalid';
  end if;

  select offering.*
  into v_offering
  from public.service_offerings offering
  join public.service_lines service_line on service_line.id = offering.service_line_id
  where offering.id = p_catalog_item_id
    and service_line.id = 'plate_and_post'
  for update of offering;

  if not found then
    raise exception using errcode = 'P0001', message = 'service_offering_not_found';
  end if;
  if v_offering.stripe_product_id is null then
    raise exception using errcode = 'P0001', message = 'service_stripe_product_required';
  end if;
  if v_offering.price_cents <> p_expected_price_cents
     or v_offering.stripe_price_id is distinct from p_expected_stripe_price_id then
    raise exception using errcode = 'P0001', message = 'service_price_changed';
  end if;

  update public.service_offerings
  set price_cents = p_price_cents,
      stripe_price_id = p_stripe_price_id,
      updated_at = now()
  where id = v_offering.id
  returning * into v_offering;

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'service_offering.price_updated',
    'service_offering',
    v_offering.id::text,
    jsonb_build_object(
      'prior_price_cents', p_expected_price_cents,
      'price_cents', v_offering.price_cents,
      'currency', v_offering.currency
    )
  );

  return jsonb_build_object(
    'service',
    private.service_offering_staff_json(v_offering)
  );
end;
$$;

revoke execute on function public.update_service_offering_price(uuid, uuid, integer, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.update_service_offering_price(uuid, uuid, integer, text, integer, text)
  to service_role;

create or replace function public.list_service_orders_for_staff(
  p_actor_user_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.staff_has_role(p_actor_user_id, array['owner', 'admin']) then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 300 then
    raise exception using errcode = 'P0001', message = 'service_orders_limit_invalid';
  end if;

  return jsonb_build_object(
    'orders',
    coalesce((
      select jsonb_agg(
        private.service_order_staff_json(service_order)
        order by service_order.created_at desc, service_order.id desc
      )
      from public.service_orders service_order
      where service_order.id in (
        select limited_order.id
        from public.service_orders limited_order
        order by limited_order.created_at desc, limited_order.id desc
        limit p_limit
      )
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.list_service_orders_for_staff(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_service_orders_for_staff(uuid, integer)
  to service_role;

create or replace function public.service_analytics_summary(
  p_actor_user_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_orders_started bigint;
  v_paid_orders bigint;
  v_pending_orders bigint;
  v_refunded_orders bigint;
  v_gross_revenue_cents bigint;
  v_refunded_cents bigint;
begin
  if not private.staff_has_role(
    p_actor_user_id,
    array['owner', 'admin', 'analyst']
  ) then
    raise exception using errcode = 'P0001', message = 'staff_access_required';
  end if;
  if p_from is null
     or p_to is null
     or p_from >= p_to
     or p_from < now() - interval '24 months'
     or p_to > now() + interval '1 day' then
    raise exception using errcode = 'P0001', message = 'invalid_service_analytics_range';
  end if;

  select count(*)
  into v_orders_started
  from public.service_orders service_order
  where service_order.service_line_id = 'plate_and_post'
    and service_order.ordered_at >= p_from
    and service_order.ordered_at < p_to;

  select count(distinct payment.service_order_id),
         coalesce(sum(payment.amount_cents), 0)
  into v_paid_orders, v_gross_revenue_cents
  from private.payment_records payment
  join public.service_orders service_order on service_order.id = payment.service_order_id
  where service_order.service_line_id = 'plate_and_post'
    and payment.status in ('paid', 'partially_refunded', 'refunded')
    and payment.paid_at >= p_from
    and payment.paid_at < p_to;

  select count(*)
  into v_pending_orders
  from public.service_orders service_order
  where service_order.service_line_id = 'plate_and_post'
    and service_order.payment_status = 'pending'
    and service_order.ordered_at >= p_from
    and service_order.ordered_at < p_to;

  select count(distinct payment.service_order_id),
         coalesce(sum(payment.amount_refunded_cents), 0)
  into v_refunded_orders, v_refunded_cents
  from private.payment_records payment
  join public.service_orders service_order on service_order.id = payment.service_order_id
  where service_order.service_line_id = 'plate_and_post'
    and payment.amount_refunded_cents > 0
    and payment.refunded_at >= p_from
    and payment.refunded_at < p_to;

  return jsonb_build_object(
    'service_line_id', 'plate_and_post',
    'orders_started', v_orders_started,
    'paid_orders', v_paid_orders,
    'pending_orders', v_pending_orders,
    'refunded_orders', v_refunded_orders,
    'gross_revenue_cents', v_gross_revenue_cents,
    'refunded_cents', v_refunded_cents,
    'net_revenue_cents', v_gross_revenue_cents - v_refunded_cents,
    'currency', 'EUR'
  );
end;
$$;

revoke execute on function public.service_analytics_summary(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_analytics_summary(uuid, timestamptz, timestamptz)
  to service_role;

create or replace function public.update_service_order_fulfillment(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.service_orders%rowtype;
  v_prior_status text;
  v_transition_allowed boolean;
begin
  if not private.staff_has_role(p_actor_user_id, array['owner', 'admin']) then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;
  if p_status is null
     or p_status not in (
       'new', 'contacted', 'scheduled', 'in_progress', 'delivered', 'cancelled'
     ) then
    raise exception using errcode = 'P0001', message = 'service_fulfillment_status_invalid';
  end if;

  select * into v_order
  from public.service_orders
  where id = p_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'service_order_not_found';
  end if;

  v_prior_status := v_order.fulfillment_status;
  if v_prior_status = p_status then
    return jsonb_build_object('order', private.service_order_staff_json(v_order));
  end if;

  v_transition_allowed := (
    (v_prior_status = 'new' and p_status = 'contacted')
    or (v_prior_status = 'contacted' and p_status = 'scheduled')
    or (v_prior_status = 'scheduled' and p_status = 'in_progress')
    or (v_prior_status = 'in_progress' and p_status = 'delivered')
    or (
      v_prior_status in ('new', 'contacted', 'scheduled', 'in_progress')
      and p_status = 'cancelled'
    )
  );

  if not v_transition_allowed then
    raise exception using errcode = 'P0001', message = 'service_fulfillment_transition_invalid';
  end if;
  if p_status <> 'cancelled' and v_order.payment_status <> 'paid' then
    raise exception using errcode = 'P0001', message = 'service_order_not_paid';
  end if;

  update public.service_orders
  set fulfillment_status = p_status,
      completed_at = case when p_status = 'delivered' then now() else null end,
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_user_id,
    'service_order.fulfillment_updated',
    'service_order',
    v_order.id::text,
    jsonb_build_object(
      'prior_status', v_prior_status,
      'status', v_order.fulfillment_status
    )
  );

  return jsonb_build_object('order', private.service_order_staff_json(v_order));
end;
$$;

revoke execute on function public.update_service_order_fulfillment(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.update_service_order_fulfillment(uuid, uuid, text)
  to service_role;

create or replace function public.list_my_service_orders(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_user_id is null
     or (
       (select auth.uid()) is distinct from p_user_id
       and coalesce((select auth.role()), '') <> 'service_role'
     ) then
    raise exception using errcode = 'P0001', message = 'service_orders_access_denied';
  end if;

  return jsonb_build_object(
    'orders',
    coalesce((
      select jsonb_agg(
        private.service_order_account_json(service_order)
        order by service_order.created_at desc, service_order.id desc
      )
      from public.service_orders service_order
      where service_order.user_id = p_user_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.list_my_service_orders(uuid) from public, anon;
grant execute on function public.list_my_service_orders(uuid) to authenticated, service_role;

create or replace function public.list_my_customer_requests(p_user_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'requests', coalesce(jsonb_agg(
      jsonb_build_object(
        'id', request.id,
        'kind', request.kind,
        'status', request.status,
        'enrollment_id', request.enrollment_id,
        'service_order_id', request.service_order_id,
        'created_at', request.created_at,
        'updated_at', request.updated_at
      ) order by request.created_at desc
    ), '[]'::jsonb)
  )
  from private.customer_requests request
  where request.user_id = p_user_id;
$$;

revoke execute on function public.list_my_customer_requests(uuid)
  from public, anon, authenticated;
grant execute on function public.list_my_customer_requests(uuid)
  to service_role;

create or replace function public.create_customer_request(
  p_user_id uuid,
  p_kind text,
  p_enrollment_id uuid,
  p_service_order_id uuid,
  p_details text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.customer_requests%rowtype;
begin
  if p_user_id is null
     or p_kind is null
     or p_kind not in (
       'access', 'correction', 'erasure', 'restriction', 'objection',
       'cancellation', 'change'
     )
     or (p_details is not null and length(trim(p_details)) not between 1 and 1000)
     or (
       p_kind in ('cancellation', 'change')
       and num_nonnulls(p_enrollment_id, p_service_order_id) <> 1
     )
     or (
       p_kind not in ('cancellation', 'change')
       and num_nonnulls(p_enrollment_id, p_service_order_id) <> 0
     ) then
    raise exception using errcode = 'P0001', message = 'invalid_customer_request';
  end if;

  if p_enrollment_id is not null and not exists (
    select 1
    from public.enrollments enrollment
    where enrollment.id = p_enrollment_id
      and enrollment.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'customer_request_enrollment_not_found';
  end if;

  if p_service_order_id is not null and not exists (
    select 1
    from public.service_orders service_order
    where service_order.id = p_service_order_id
      and service_order.user_id = p_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'customer_request_service_order_not_found';
  end if;

  if exists (
    select 1
    from private.customer_requests request
    where request.user_id = p_user_id
      and request.kind = p_kind
      and request.enrollment_id is not distinct from p_enrollment_id
      and request.service_order_id is not distinct from p_service_order_id
      and request.status in ('submitted', 'in_review', 'awaiting_customer')
      and request.created_at > now() - interval '24 hours'
  ) then
    raise exception using errcode = 'P0001', message = 'customer_request_already_open';
  end if;

  insert into private.customer_requests (
    user_id,
    kind,
    enrollment_id,
    service_order_id,
    details
  ) values (
    p_user_id,
    p_kind,
    p_enrollment_id,
    p_service_order_id,
    nullif(trim(p_details), '')
  )
  returning * into v_request;

  insert into private.customer_request_events (
    request_id,
    actor_user_id,
    action,
    next_status
  ) values (
    v_request.id,
    p_user_id,
    'submitted',
    v_request.status
  );

  insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
  values (
    p_user_id,
    'customer_request.submitted',
    'customer_request',
    v_request.id::text,
    jsonb_build_object(
      'kind', v_request.kind,
      'enrollment_id', v_request.enrollment_id,
      'service_order_id', v_request.service_order_id
    )
  );

  return jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_request.id,
      'kind', v_request.kind,
      'status', v_request.status,
      'enrollment_id', v_request.enrollment_id,
      'service_order_id', v_request.service_order_id,
      'created_at', v_request.created_at
    )
  );
end;
$$;

revoke execute on function public.create_customer_request(uuid, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_customer_request(uuid, text, uuid, uuid, text)
  to service_role;

create or replace function public.create_customer_request(
  p_user_id uuid,
  p_kind text,
  p_enrollment_id uuid,
  p_details text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.create_customer_request(
    p_user_id,
    p_kind,
    p_enrollment_id,
    null::uuid,
    p_details
  );
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
        'id', request.id,
        'kind', request.kind,
        'status', request.status,
        'enrollment_id', request.enrollment_id,
        'service_order_id', request.service_order_id,
        'details', request.details,
        'created_at', request.created_at,
        'updated_at', request.updated_at,
        'resolved_at', request.resolved_at,
        'resolution_note', request.resolution_note
      ) order by request.created_at asc)
      from private.customer_requests request
      where v_role = 'owner' or request.kind in ('cancellation', 'change')
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.list_customer_requests_for_staff(uuid)
  from public, anon, authenticated;
grant execute on function public.list_customer_requests_for_staff(uuid)
  to service_role;

create or replace function public.list_customer_requests_page(
  p_actor_user_id uuid,
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
begin
  select staff.role into v_role
  from private.staff_members staff
  where staff.user_id = p_actor_user_id
    and staff.status = 'active';

  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception using errcode = 'P0001', message = 'staff_admin_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'staff_page_limit_invalid';
  end if;
  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception using errcode = 'P0001', message = 'staff_page_cursor_invalid';
  end if;

  return (
    with page as (
      select
        request.id,
        request.kind,
        request.status,
        request.enrollment_id,
        request.service_order_id,
        request.details,
        request.created_at,
        request.updated_at,
        request.resolved_at,
        request.resolution_note,
        request.created_at as cursor_at
      from private.customer_requests request
      where (v_role = 'owner' or request.kind in ('cancellation', 'change'))
        and (
          p_cursor_at is null
          or (request.created_at, request.id) < (p_cursor_at, p_cursor_id::uuid)
        )
      order by request.created_at desc, request.id desc
      limit p_limit + 1
    ), visible as (
      select *
      from page
      order by cursor_at desc, id desc
      limit p_limit
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', visible.id,
          'kind', visible.kind,
          'status', visible.status,
          'enrollment_id', visible.enrollment_id,
          'service_order_id', visible.service_order_id,
          'details', visible.details,
          'created_at', visible.created_at,
          'updated_at', visible.updated_at,
          'resolved_at', visible.resolved_at,
          'resolution_note', visible.resolution_note
        ) order by visible.cursor_at desc, visible.id desc)
        from visible
      ), '[]'::jsonb),
      'next_cursor', case when (select count(*) from page) > p_limit then (
        select jsonb_build_object('at', cursor_at, 'id', id::text)
        from visible
        order by cursor_at asc, id asc
        limit 1
      ) else null end
    )
  );
end;
$$;

revoke execute on function public.list_customer_requests_page(uuid, timestamptz, text, integer)
  from public, anon, authenticated;
grant execute on function public.list_customer_requests_page(uuid, timestamptz, text, integer)
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
     or p_status not in (
       'submitted', 'in_review', 'awaiting_customer', 'completed', 'declined'
     )
     or (
       p_resolution_note is not null
       and length(trim(p_resolution_note)) not between 1 and 1000
     ) then
    raise exception using errcode = 'P0001', message = 'invalid_customer_request_update';
  end if;

  select * into v_request
  from private.customer_requests
  where id = p_request_id
  for update;
  if not found
     or (
       v_role <> 'owner'
       and v_request.kind not in ('cancellation', 'change')
     ) then
    raise exception using errcode = 'P0001', message = 'customer_request_not_found';
  end if;
  v_prior_status := v_request.status;

  update private.customer_requests
  set status = p_status,
      reviewed_by = p_actor_user_id,
      resolution_note = nullif(trim(p_resolution_note), ''),
      resolved_at = case
        when p_status in ('completed', 'declined') then now()
        else null
      end,
      updated_at = now()
  where id = v_request.id
  returning * into v_request;

  insert into private.customer_request_events (
    request_id,
    actor_user_id,
    action,
    prior_status,
    next_status
  ) values (
    v_request.id,
    p_actor_user_id,
    'status_updated',
    v_prior_status,
    v_request.status
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
    'enrollment_id', v_request.enrollment_id,
    'service_order_id', v_request.service_order_id,
    'updated_at', v_request.updated_at,
    'resolved_at', v_request.resolved_at
  ));
end;
$$;

revoke execute on function public.update_customer_request(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_customer_request(uuid, uuid, text, text)
  to service_role;

-- Preserve the existing workshop allocation implementation under a private
-- service-role-only entry point. The public webhook RPC below dispatches using
-- server-owned checkout state, never browser-supplied amounts or return data.
alter function public.process_stripe_event(text, text, jsonb)
  rename to process_workshop_stripe_event;

revoke execute on function public.process_workshop_stripe_event(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.process_workshop_stripe_event(text, text, jsonb)
  to service_role;

create or replace function public.process_service_stripe_event(
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
  v_service record;
  v_order public.service_orders%rowtype;
  v_payment private.payment_records%rowtype;
  v_payment_intent_id text;
  v_charge_amount integer;
  v_refunded_amount integer;
  v_target_payment_status text;
  v_was_paid boolean := false;
  v_full_refund boolean := false;
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
    return jsonb_build_object(
      'duplicate', false,
      'ignored', true,
      'event_id', p_stripe_event_id
    );
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

    select checkout_attempt.*
    into v_checkout
    from private.checkout_attempts checkout_attempt
    left join private.payment_records payment
      on payment.checkout_attempt_id = checkout_attempt.id
    left join public.service_orders service_order
      on service_order.checkout_attempt_id = checkout_attempt.id
    where checkout_attempt.checkout_kind = 'service_order'
      and (
        checkout_attempt.stripe_payment_intent_id = v_payment_intent_id
        or payment.stripe_payment_intent_id = v_payment_intent_id
        or service_order.stripe_payment_intent_id = v_payment_intent_id
      )
    order by checkout_attempt.created_at desc
    limit 1
    for update of checkout_attempt;

    if not found then
      update private.stripe_webhook_events
      set status = 'ignored', error_message = 'service_payment_not_found', processed_at = now()
      where id = v_event_id;
      return jsonb_build_object(
        'duplicate', false,
        'ignored', true,
        'reason', 'service_payment_not_found',
        'event_id', p_stripe_event_id
      );
    end if;

    select
      offering.*,
      service_line.id as service_line_key,
      service_line.url_slug as service_line_slug
    into v_service
    from public.service_offerings offering
    join public.service_lines service_line on service_line.id = offering.service_line_id
    where offering.id = v_checkout.service_offering_id
      and service_line.id = 'plate_and_post';

    select service_order.*
    into v_order
    from public.service_orders service_order
    where service_order.checkout_attempt_id = v_checkout.id
       or service_order.stripe_payment_intent_id = v_payment_intent_id
    order by service_order.created_at desc
    limit 1
    for update;

    v_full_refund := v_refunded_amount >= v_charge_amount;

    if v_order.id is null then
      if v_checkout.stripe_checkout_session_id is null or v_service.id is null then
        update private.stripe_webhook_events
        set status = 'ignored', error_message = 'service_order_not_recoverable', processed_at = now()
        where id = v_event_id;
        return jsonb_build_object(
          'duplicate', false,
          'ignored', true,
          'reason', 'service_order_not_recoverable',
          'event_id', p_stripe_event_id
        );
      end if;

      insert into public.service_orders (
        checkout_attempt_id,
        service_line_id,
        service_offering_id,
        user_id,
        customer_email,
        service_line_slug,
        service_slug,
        service_title,
        fulfillment_method,
        payment_status,
        fulfillment_status,
        amount_cents,
        currency,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        paid_at,
        refunded_at
      ) values (
        v_checkout.id,
        v_service.service_line_key,
        v_service.id,
        v_checkout.user_id,
        v_checkout.customer_email,
        v_service.service_line_slug,
        v_service.slug,
        v_service.title,
        v_service.fulfillment_method,
        case when v_full_refund then 'refunded' else 'paid' end,
        'new',
        v_checkout.amount_cents,
        v_checkout.currency,
        v_checkout.stripe_checkout_session_id,
        v_payment_intent_id,
        now(),
        case when v_full_refund then now() else null end
      )
      returning * into v_order;
    end if;

    insert into private.payment_records (
      checkout_attempt_id,
      service_order_id,
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
      v_order.id,
      v_payment_intent_id,
      v_checkout.stripe_checkout_session_id,
      nullif(v_object ->> 'id', ''),
      v_charge_amount,
      v_refunded_amount,
      'EUR',
      case when v_full_refund then 'refunded' else 'partially_refunded' end,
      p_stripe_event_id,
      coalesce(v_order.paid_at, now()),
      now()
    )
    on conflict (stripe_payment_intent_id) do update
      set checkout_attempt_id = excluded.checkout_attempt_id,
          enrollment_id = null,
          service_order_id = excluded.service_order_id,
          stripe_checkout_session_id = coalesce(
            excluded.stripe_checkout_session_id,
            private.payment_records.stripe_checkout_session_id
          ),
          stripe_charge_id = coalesce(
            excluded.stripe_charge_id,
            private.payment_records.stripe_charge_id
          ),
          amount_cents = greatest(private.payment_records.amount_cents, excluded.amount_cents),
          amount_refunded_cents = greatest(
            private.payment_records.amount_refunded_cents,
            excluded.amount_refunded_cents
          ),
          status = case
            when greatest(
              private.payment_records.amount_refunded_cents,
              excluded.amount_refunded_cents
            ) >= greatest(private.payment_records.amount_cents, excluded.amount_cents)
              then 'refunded'
            else 'partially_refunded'
          end,
          last_stripe_event_id = excluded.last_stripe_event_id,
          paid_at = coalesce(private.payment_records.paid_at, excluded.paid_at),
          refunded_at = coalesce(private.payment_records.refunded_at, excluded.refunded_at),
          updated_at = now()
    returning * into v_payment;

    v_full_refund := v_payment.status = 'refunded';

    update public.service_orders
    set payment_status = case when v_full_refund then 'refunded' else 'paid' end,
        stripe_payment_intent_id = coalesce(stripe_payment_intent_id, v_payment_intent_id),
        paid_at = coalesce(paid_at, v_payment.paid_at, now()),
        refunded_at = case
          when v_full_refund then coalesce(refunded_at, now())
          else null
        end,
        updated_at = now()
    where id = v_order.id
    returning * into v_order;

    insert into private.audit_logs (action, target_type, target_id, metadata)
    values (
      'stripe.service_refund_recorded',
      'service_order',
      v_order.id::text,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'payment_id', v_payment.id,
        'amount_refunded_cents', v_payment.amount_refunded_cents,
        'amount_cents', v_payment.amount_cents,
        'status', v_payment.status
      )
    );

    if v_full_refund then
      perform private.enqueue_job(
        'email',
        jsonb_build_object(
          'template', 'service_order_refund',
          'to', v_order.customer_email,
          'service_title', v_order.service_title,
          'amount_refunded_cents', v_payment.amount_refunded_cents
        ),
        'service-order-refund:' || v_order.id::text || ':' || v_payment.amount_refunded_cents::text
      );
    end if;

    update private.stripe_webhook_events
    set status = 'processed', processed_at = now()
    where id = v_event_id;

    return jsonb_build_object(
      'duplicate', false,
      'processed', true,
      'event_id', p_stripe_event_id,
      'checkout_id', v_checkout.id,
      'service_order_id', v_order.id,
      'payment_status', v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status,
      'payment_id', v_payment.id,
      'refund_status', v_payment.status,
      'amount_refunded_cents', v_payment.amount_refunded_cents
    );
  end if;

  select checkout_attempt.*
  into v_checkout
  from private.checkout_attempts checkout_attempt
  where checkout_attempt.checkout_kind = 'service_order'
    and (
      checkout_attempt.stripe_checkout_session_id = v_object ->> 'id'
      or (
        checkout_attempt.stripe_checkout_session_id is null
        and checkout_attempt.id::text = coalesce(
          nullif(v_object ->> 'client_reference_id', ''),
          v_object #>> '{metadata,checkout_id}'
        )
      )
    )
  order by checkout_attempt.created_at desc
  limit 1
  for update;

  if not found then
    update private.stripe_webhook_events
    set status = 'ignored', error_message = 'service_checkout_not_found', processed_at = now()
    where id = v_event_id;
    return jsonb_build_object(
      'duplicate', false,
      'ignored', true,
      'reason', 'service_checkout_not_found',
      'event_id', p_stripe_event_id
    );
  end if;

  select
    offering.*,
    service_line.id as service_line_key,
    service_line.url_slug as service_line_slug
  into v_service
  from public.service_offerings offering
  join public.service_lines service_line on service_line.id = offering.service_line_id
  where offering.id = v_checkout.service_offering_id
    and service_line.id = 'plate_and_post';

  if v_service.id is null then
    raise exception using errcode = 'P0001', message = 'service_checkout_target_invalid';
  end if;

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
    set status = 'ignored', error_message = 'stale_unpaid_terminal_checkout', processed_at = now()
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
    v_charge_amount := greatest(
      coalesce(nullif(v_object ->> 'amount_total', '')::integer, 0),
      1
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
        v_charge_amount,
        v_checkout.currency,
        'mismatch',
        p_stripe_event_id
      )
      on conflict (stripe_payment_intent_id) do update
        set checkout_attempt_id = excluded.checkout_attempt_id,
            enrollment_id = null,
            service_order_id = null,
            stripe_checkout_session_id = excluded.stripe_checkout_session_id,
            status = 'mismatch',
            last_stripe_event_id = excluded.last_stripe_event_id,
            updated_at = now();
    end if;

    update private.checkout_attempts
    set status = 'failed', updated_at = now()
    where id = v_checkout.id;

    update public.service_orders
    set payment_status = 'failed', updated_at = now()
    where checkout_attempt_id = v_checkout.id
      and payment_status = 'pending';

    insert into private.audit_logs (action, target_type, target_id, metadata)
    values (
      'stripe.service_amount_mismatch',
      'checkout',
      v_checkout.id::text,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'expected_amount_cents', v_checkout.amount_cents,
        'received_amount_cents', nullif(v_object ->> 'amount_total', '')::integer,
        'expected_currency', v_checkout.currency,
        'received_currency', upper(coalesce(v_object ->> 'currency', ''))
      )
    );

    update private.stripe_webhook_events
    set status = 'failed',
        error_message = 'checkout_amount_or_currency_mismatch',
        processed_at = now()
    where id = v_event_id;

    return jsonb_build_object(
      'duplicate', false,
      'processed', false,
      'amount_mismatch', true,
      'event_id', p_stripe_event_id,
      'checkout_id', v_checkout.id
    );
  end if;

  v_payment_intent_id := coalesce(
    nullif(v_object ->> 'payment_intent', ''),
    v_checkout.stripe_payment_intent_id
  );

  update private.checkout_attempts
  set stripe_payment_intent_id = coalesce(v_payment_intent_id, stripe_payment_intent_id),
      stripe_customer_id = coalesce(
        nullif(v_object ->> 'customer', ''),
        stripe_customer_id
      ),
      updated_at = now()
  where id = v_checkout.id;

  if p_event_type in ('checkout.session.async_payment_failed', 'checkout.session.expired') then
    if v_checkout.status in ('paid', 'paid_unallocated')
       or exists (
         select 1
         from public.service_orders paid_order
         where paid_order.checkout_attempt_id = v_checkout.id
           and paid_order.payment_status in ('paid', 'refunded')
       ) then
      update private.stripe_webhook_events
      set status = 'ignored', error_message = 'checkout_already_payment_terminal', processed_at = now()
      where id = v_event_id;
      return jsonb_build_object(
        'duplicate', false,
        'ignored', true,
        'reason', 'checkout_already_payment_terminal',
        'checkout_id', v_checkout.id,
        'event_id', p_stripe_event_id
      );
    end if;

    update private.checkout_attempts
    set status = case
          when p_event_type = 'checkout.session.expired' then 'expired'
          else 'failed'
        end,
        updated_at = now()
    where id = v_checkout.id;

    update public.service_orders
    set payment_status = 'failed', updated_at = now()
    where checkout_attempt_id = v_checkout.id
      and payment_status = 'pending'
    returning * into v_order;

    if v_payment_intent_id is not null then
      insert into private.payment_records (
        checkout_attempt_id,
        service_order_id,
        stripe_payment_intent_id,
        stripe_checkout_session_id,
        amount_cents,
        currency,
        status,
        last_stripe_event_id
      ) values (
        v_checkout.id,
        v_order.id,
        v_payment_intent_id,
        v_checkout.stripe_checkout_session_id,
        v_checkout.amount_cents,
        v_checkout.currency,
        'failed',
        p_stripe_event_id
      )
      on conflict (stripe_payment_intent_id) do update
        set status = case
              when private.payment_records.status in (
                'paid', 'mismatch', 'requires_refund', 'partially_refunded', 'refunded'
              ) then private.payment_records.status
              else 'failed'
            end,
            last_stripe_event_id = excluded.last_stripe_event_id,
            updated_at = now();
    end if;

    update private.stripe_webhook_events
    set status = 'processed', processed_at = now()
    where id = v_event_id;

    return jsonb_build_object(
      'duplicate', false,
      'processed', true,
      'event_id', p_stripe_event_id,
      'checkout_id', v_checkout.id,
      'service_order_id', v_order.id,
      'payment_status', v_order.payment_status,
      'fulfillment_status', v_order.fulfillment_status
    );
  end if;

  v_target_payment_status := case
    when p_event_type = 'checkout.session.async_payment_succeeded'
      or v_object ->> 'payment_status' = 'paid' then 'paid'
    else 'pending'
  end;

  select exists (
    select 1
    from public.service_orders existing_order
    where existing_order.checkout_attempt_id = v_checkout.id
      and existing_order.payment_status in ('paid', 'refunded')
  ) into v_was_paid;

  insert into public.service_orders (
    checkout_attempt_id,
    service_line_id,
    service_offering_id,
    user_id,
    customer_email,
    service_line_slug,
    service_slug,
    service_title,
    fulfillment_method,
    payment_status,
    fulfillment_status,
    amount_cents,
    currency,
    stripe_checkout_session_id,
    stripe_payment_intent_id,
    paid_at
  ) values (
    v_checkout.id,
    v_service.service_line_key,
    v_service.id,
    v_checkout.user_id,
    v_checkout.customer_email,
    v_service.service_line_slug,
    v_service.slug,
    v_service.title,
    v_service.fulfillment_method,
    v_target_payment_status,
    'new',
    v_checkout.amount_cents,
    v_checkout.currency,
    v_checkout.stripe_checkout_session_id,
    v_payment_intent_id,
    case when v_target_payment_status = 'paid' then now() else null end
  )
  on conflict (checkout_attempt_id) do update
    set stripe_payment_intent_id = coalesce(
          excluded.stripe_payment_intent_id,
          public.service_orders.stripe_payment_intent_id
        ),
        payment_status = case
          when public.service_orders.payment_status = 'refunded' then 'refunded'
          when excluded.payment_status = 'paid' then 'paid'
          when public.service_orders.payment_status = 'paid' then 'paid'
          else excluded.payment_status
        end,
        paid_at = coalesce(public.service_orders.paid_at, excluded.paid_at),
        updated_at = now()
  returning * into v_order;

  if v_payment_intent_id is not null then
    insert into private.payment_records (
      checkout_attempt_id,
      service_order_id,
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
      v_order.id,
      v_payment_intent_id,
      v_checkout.stripe_checkout_session_id,
      v_checkout.amount_cents,
      0,
      v_checkout.currency,
      case when v_target_payment_status = 'paid' then 'paid' else 'pending' end,
      p_stripe_event_id,
      case when v_target_payment_status = 'paid' then now() else null end
    )
    on conflict (stripe_payment_intent_id) do update
      set checkout_attempt_id = excluded.checkout_attempt_id,
          enrollment_id = null,
          service_order_id = excluded.service_order_id,
          stripe_checkout_session_id = excluded.stripe_checkout_session_id,
          amount_cents = greatest(private.payment_records.amount_cents, excluded.amount_cents),
          currency = excluded.currency,
          status = case
            when private.payment_records.status in (
              'mismatch', 'requires_refund', 'partially_refunded', 'refunded'
            ) then private.payment_records.status
            when excluded.status = 'paid' then 'paid'
            else private.payment_records.status
          end,
          last_stripe_event_id = excluded.last_stripe_event_id,
          paid_at = coalesce(private.payment_records.paid_at, excluded.paid_at),
          updated_at = now()
    returning * into v_payment;

    if v_payment.status = 'refunded' then
      update public.service_orders
      set payment_status = 'refunded',
          refunded_at = coalesce(refunded_at, v_payment.refunded_at, now()),
          updated_at = now()
      where id = v_order.id
      returning * into v_order;
    end if;
  end if;

  update private.checkout_attempts
  set status = case
        when v_order.payment_status in ('paid', 'refunded') then 'paid'
        else 'payment_pending'
      end,
      updated_at = now()
  where id = v_checkout.id;

  if v_target_payment_status = 'paid' and not v_was_paid then
    insert into private.audit_logs (action, target_type, target_id, metadata)
    values (
      'stripe.service_order_paid',
      'service_order',
      v_order.id::text,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'checkout_id', v_checkout.id,
        'payment_id', v_payment.id,
        'service_line_id', v_order.service_line_id,
        'service_offering_id', v_order.service_offering_id,
        'amount_cents', v_checkout.amount_cents,
        'currency', v_checkout.currency
      )
    );

    perform private.enqueue_job(
      'email',
      jsonb_build_object(
        'template', 'service_order_confirmation',
        'to', v_order.customer_email,
        'service_order_id', v_order.id,
        'service_title', v_order.service_title,
        'amount_cents', v_order.amount_cents,
        'customer_email', v_order.customer_email
      ),
      'service-order-confirmation:' || v_order.id::text
    );

    perform private.enqueue_job(
      'email',
      jsonb_build_object(
        'template', 'service_order_admin_alert',
        'to_role', 'workspace_admin',
        'service_order_id', v_order.id,
        'service_title', v_order.service_title,
        'amount_cents', v_order.amount_cents,
        'customer_email', v_order.customer_email
      ),
      'service-order-admin-alert:' || v_order.id::text
    );
  end if;

  update private.stripe_webhook_events
  set status = 'processed', processed_at = now()
  where id = v_event_id;

  return jsonb_build_object(
    'duplicate', false,
    'processed', true,
    'event_id', p_stripe_event_id,
    'checkout_id', v_checkout.id,
    'service_order_id', v_order.id,
    'payment_status', v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status,
    'payment_id', v_payment.id
  );
exception
  when others then
    update private.stripe_webhook_events
    set status = 'failed', error_message = left(sqlerrm, 1000), processed_at = now()
    where id = v_event_id;
    raise;
end;
$$;

revoke execute on function public.process_service_stripe_event(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.process_service_stripe_event(text, text, jsonb)
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
  v_object jsonb := p_payload #> '{data,object}';
  v_service_checkout_id uuid;
  v_payment_intent_id text;
begin
  if p_event_type = 'charge.refunded' then
    v_payment_intent_id := nullif(v_object ->> 'payment_intent', '');
    select checkout_attempt.id
    into v_service_checkout_id
    from private.checkout_attempts checkout_attempt
    left join private.payment_records payment
      on payment.checkout_attempt_id = checkout_attempt.id
    left join public.service_orders service_order
      on service_order.checkout_attempt_id = checkout_attempt.id
    where checkout_attempt.checkout_kind = 'service_order'
      and v_payment_intent_id is not null
      and (
        checkout_attempt.stripe_payment_intent_id = v_payment_intent_id
        or payment.stripe_payment_intent_id = v_payment_intent_id
        or service_order.stripe_payment_intent_id = v_payment_intent_id
      )
    order by checkout_attempt.created_at desc
    limit 1;
  else
    select checkout_attempt.id
    into v_service_checkout_id
    from private.checkout_attempts checkout_attempt
    where checkout_attempt.checkout_kind = 'service_order'
      and (
        checkout_attempt.stripe_checkout_session_id = v_object ->> 'id'
        or (
          checkout_attempt.stripe_checkout_session_id is null
          and checkout_attempt.id::text = coalesce(
            nullif(v_object ->> 'client_reference_id', ''),
            v_object #>> '{metadata,checkout_id}'
          )
        )
      )
    order by checkout_attempt.created_at desc
    limit 1;
  end if;

  if v_service_checkout_id is not null then
    return public.process_service_stripe_event(
      p_stripe_event_id,
      p_event_type,
      p_payload
    );
  end if;

  return public.process_workshop_stripe_event(
    p_stripe_event_id,
    p_event_type,
    p_payload
  );
end;
$$;

revoke execute on function public.process_stripe_event(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.process_stripe_event(text, text, jsonb)
  to service_role;
