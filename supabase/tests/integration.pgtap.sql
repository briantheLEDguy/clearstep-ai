-- Disposable local-stack integration coverage. The CLI applies every migration
-- before this test runs, and the transaction rollback leaves the local stack
-- reusable for later suites. These fixtures intentionally use .test addresses
-- and non-production identifiers only.
begin;

create extension if not exists pgtap with schema extensions;

select plan(56);

-- Fixed fixture identities make the role and ownership assertions readable.
insert into auth.users (id, email, email_confirmed_at)
values
  ('10000000-0000-4000-8000-000000000001', 'integration-owner@example.test', now()),
  ('10000000-0000-4000-8000-000000000002', 'integration-admin@example.test', now()),
  ('10000000-0000-4000-8000-000000000003', 'integration-customer-a@example.test', now()),
  ('10000000-0000-4000-8000-000000000004', 'integration-customer-b@example.test', now()),
  ('10000000-0000-4000-8000-000000000005', 'integration-waitlist@example.test', now()),
  ('10000000-0000-4000-8000-000000000006', 'integration-quote-owner@example.test', now()),
  ('10000000-0000-4000-8000-000000000007', 'integration-quote-outsider@example.test', now()),
  ('10000000-0000-4000-8000-000000000008', 'integration-seat-filler@example.test', now());

insert into private.staff_members (user_id, email, role, status, activated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'integration-owner@example.test', 'owner', 'active', now()),
  ('10000000-0000-4000-8000-000000000002', 'integration-admin@example.test', 'admin', 'active', now());

insert into public.courses (
  id, slug, title, summary, description, outcomes, level, audience, agenda,
  duration_minutes, price_cents, currency, stripe_product_id, stripe_price_id,
  visibility, status
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    'integration-public-course',
    'Integration public course',
    'A published course used only by disposable database tests.',
    'This published integration-test course validates public catalogue and checkout behaviour.',
    array['A test outcome'],
    'Beginner',
    'Integration-test audience',
    jsonb_build_array(jsonb_build_object('title', 'Test agenda', 'detail', 'Exercise the local database boundary.')),
    60,
    10000,
    'EUR',
    'prod_integrationpublic',
    'price_integrationpublic',
    'public',
    'published'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'integration-private-course',
    'Integration private course',
    'A private published course used only by disposable database tests.',
    'This private integration-test course validates quote ownership without public catalogue exposure.',
    array['A private test outcome'],
    'Tailored',
    'Private integration-test audience',
    jsonb_build_array(jsonb_build_object('title', 'Private agenda', 'detail', 'Exercise quote ownership.')),
    60,
    12500,
    'EUR',
    'prod_integrationprivate',
    'price_integrationprivate',
    'private',
    'published'
  );

insert into public.workshop_sessions (
  id, course_id, format, start_at, end_at, timezone, capacity, status
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'online', now() + interval '2 days', now() + interval '2 days 1 hour', 'Europe/Amsterdam', 1, 'scheduled'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    'online', now() + interval '3 days', now() + interval '3 days 1 hour', 'Europe/Amsterdam', 1, 'scheduled'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000002',
    'online', now() + interval '4 days', now() + interval '4 days 1 hour', 'Europe/Amsterdam', 2, 'scheduled'
  );

insert into private.session_integrations (session_id, google_event_id, meet_url)
values
  ('30000000-0000-4000-8000-000000000001', 'integration_public_checkout', 'https://meet.google.com/integration-checkout'),
  ('30000000-0000-4000-8000-000000000002', 'integration_public_waitlist', 'https://meet.google.com/integration-waitlist'),
  ('30000000-0000-4000-8000-000000000003', 'integration_private_quote', 'https://meet.google.com/integration-quote');

-- Schema-level RLS remains a defensive boundary even for private tables.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has row-level security enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.customer_requests'::regclass),
  'customer-rights records have row-level security enabled'
);

-- The public RPC exposes only a ready, published public course, never private
-- quote inventory.
set local role anon;
select ok(
  public.public_workshop_catalog() -> 'workshops' @> jsonb_build_array(
    jsonb_build_object('slug', 'integration-public-course')
  ),
  'anon can see a published calendar-ready public workshop through the catalogue RPC'
);
select ok(
  not (public.public_workshop_catalog() -> 'workshops' @> jsonb_build_array(
    jsonb_build_object('slug', 'integration-private-course')
  )),
  'anon catalogue excludes private quote inventory'
);
reset role;

-- Test the user-facing RLS path rather than assuming grants bypass policies.
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
select is(
  (select count(*) from public.profiles where id = '10000000-0000-4000-8000-000000000003'::uuid),
  1::bigint,
  'an authenticated customer can read their own profile'
);
select is(
  (select count(*) from public.profiles where id = '10000000-0000-4000-8000-000000000004'::uuid),
  0::bigint,
  'an authenticated customer cannot read another profile'
);
select throws_ok(
  $$select count(*) from private.customer_requests$$,
  '42501',
  'permission denied for schema private',
  'an authenticated customer cannot query private customer-request records directly'
);
reset role;

-- A capacity-one session exercises serialised checkout creation: an identical
-- retry reuses the active attempt and a second customer cannot claim the seat.
select is(
  (public.create_checkout_hold(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'integration-customer-a@example.test'
  ) ->> 'reused')::boolean,
  false,
  'the first checkout request creates a hold'
);
select is(
  (public.create_checkout_hold(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'integration-customer-a@example.test'
  ) ->> 'reused')::boolean,
  true,
  'a duplicate checkout request reuses the same active attempt'
);
select throws_ok(
  $$select public.create_checkout_hold(
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    'integration-customer-b@example.test'
  )$$,
  'P0001',
  'session_full',
  'a second customer cannot receive the capacity-one checkout hold'
);

select is(
  (public.record_checkout_legal_acceptance(
    (
      select id from private.checkout_attempts
      where session_id = '30000000-0000-4000-8000-000000000001'::uuid
        and user_id = '10000000-0000-4000-8000-000000000003'::uuid
    ),
    '10000000-0000-4000-8000-000000000003',
    jsonb_build_array(
      jsonb_build_object('document_key', 'terms', 'document_version', '2026-08-19'),
      jsonb_build_object('document_key', 'cancellation', 'document_version', '2026-08-19')
    )
  ) ->> 'recorded_documents')::integer,
  2,
  'checkout legal acceptance stores both required document records'
);
select is(
  (public.record_checkout_legal_acceptance(
    (
      select id from private.checkout_attempts
      where session_id = '30000000-0000-4000-8000-000000000001'::uuid
        and user_id = '10000000-0000-4000-8000-000000000003'::uuid
    ),
    '10000000-0000-4000-8000-000000000003',
    jsonb_build_array(
      jsonb_build_object('document_key', 'terms', 'document_version', '2026-08-19'),
      jsonb_build_object('document_key', 'cancellation', 'document_version', '2026-08-19')
    )
  ) ->> 'recorded_documents')::integer,
  0,
  'checkout legal acceptance is idempotent'
);
select is(
  (public.record_checkout_legal_acceptance(
    (
      select id from private.checkout_attempts
      where session_id = '30000000-0000-4000-8000-000000000001'::uuid
        and user_id = '10000000-0000-4000-8000-000000000003'::uuid
    ),
    '10000000-0000-4000-8000-000000000003',
    jsonb_build_array(
      jsonb_build_object('document_key', 'terms', 'document_version', '2026-08-19.1'),
      jsonb_build_object('document_key', 'cancellation', 'document_version', '2026-08-19.1')
    )
  ) ->> 'recorded_documents')::integer,
  2,
  'a revised legal document version records two additional checkout acceptances'
);
select is(
  (
    select count(*)
    from private.legal_acceptances
    where checkout_id = (
      select id from private.checkout_attempts
      where session_id = '30000000-0000-4000-8000-000000000001'::uuid
        and user_id = '10000000-0000-4000-8000-000000000003'::uuid
    )
      and document_version = '2026-08-19'
  ),
  2::bigint,
  'a revised legal document version leaves the original acceptance records immutable'
);
select is(
  (public.record_checkout_legal_acceptance(
    (
      select id from private.checkout_attempts
      where session_id = '30000000-0000-4000-8000-000000000001'::uuid
        and user_id = '10000000-0000-4000-8000-000000000003'::uuid
    ),
    '10000000-0000-4000-8000-000000000003',
    jsonb_build_array(
      jsonb_build_object('document_key', 'terms', 'document_version', '2026-08-19.1'),
      jsonb_build_object('document_key', 'cancellation', 'document_version', '2026-08-19.1')
    )
  ) ->> 'recorded_documents')::integer,
  0,
  'a retry with the revised legal document version is idempotent'
);
select is(
  (
    select count(*)
    from private.legal_acceptances
    where checkout_id = (
      select id from private.checkout_attempts
      where session_id = '30000000-0000-4000-8000-000000000001'::uuid
        and user_id = '10000000-0000-4000-8000-000000000003'::uuid
    )
  ),
  4::bigint,
  'a checkout retains all four document-version acceptance records'
);

-- Join the waitlist using the real RPC, then stage a known offer token so the
-- ownership check can be exercised without exposing a token from staff output.
insert into private.seat_holds (session_id, user_id, status, expires_at)
values (
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000008',
  'active',
  now() + interval '31 minutes'
);
select is(
  public.join_session_waitlist(
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000005',
    'integration-waitlist@example.test',
    'Integration waitlist customer'
  ) ->> 'status',
  'waiting',
  'a full session accepts a customer into its waitlist'
);
update private.seat_holds
set status = 'released'
where session_id = '30000000-0000-4000-8000-000000000002'::uuid
  and user_id = '10000000-0000-4000-8000-000000000008'::uuid;
update public.waitlist_entries
set status = 'offered', offered_at = now(), offer_expires_at = now() + interval '1 hour'
where session_id = '30000000-0000-4000-8000-000000000002'::uuid
  and user_id = '10000000-0000-4000-8000-000000000005'::uuid;
insert into private.waitlist_offers (waitlist_entry_id, token_hash, expires_at)
select id, encode(extensions.digest('integration-waitlist-token', 'sha256'), 'hex'), now() + interval '1 hour'
from public.waitlist_entries
where session_id = '30000000-0000-4000-8000-000000000002'::uuid
  and user_id = '10000000-0000-4000-8000-000000000005'::uuid;
select throws_ok(
  $$select public.create_checkout_hold(
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000005',
    'integration-waitlist@example.test',
    encode(extensions.digest('wrong-integration-waitlist-token', 'sha256'), 'hex')
  )$$,
  'P0001',
  'invalid_waitlist_offer',
  'a waitlisted customer cannot use an unrelated offer token'
);
select is(
  public.create_checkout_hold(
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000005',
    'integration-waitlist@example.test',
    encode(extensions.digest('integration-waitlist-token', 'sha256'), 'hex')
  ) ->> 'source',
  'waitlist',
  'the matching waitlist offer creates a waitlist-sourced checkout hold'
);

-- A quote token is additionally bound to the verified request email and then
-- to the first authenticated customer who successfully resolves it.
insert into private.private_workshop_requests (
  id, contact_name, email, organization, goals, consent_to_contact
)
values (
  '40000000-0000-4000-8000-000000000001',
  'Integration quote owner',
  'integration-quote-owner@example.test',
  'Integration organisation',
  'Validate private quote ownership in the disposable local database.',
  true
);
insert into private.private_workshop_quotes (
  id, request_id, course_id, session_id, amount_cents, description, valid_until,
  status, created_by, checkout_token_hash, checkout_expires_at
)
values (
  '40000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  12500,
  'Private integration-test quote.',
  current_date + 7,
  'sent',
  '10000000-0000-4000-8000-000000000001',
  encode(extensions.digest('integration-quote-token', 'sha256'), 'hex'),
  now() + interval '1 day'
);
-- These same-timestamp rows exercise the quote-history primary-key cursor.
insert into private.private_workshop_quotes (
  id, request_id, amount_cents, description, valid_until, status, created_by, created_at
)
values
  (
    '40000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    12600,
    'First disposable quote-history record.',
    date '2030-12-31',
    'draft',
    '10000000-0000-4000-8000-000000000001',
    timestamptz '2030-01-01 12:00:00+00'
  ),
  (
    '40000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000001',
    12700,
    'Second disposable quote-history record.',
    date '2030-12-31',
    'draft',
    '10000000-0000-4000-8000-000000000001',
    timestamptz '2030-01-01 12:00:00+00'
  );
select throws_ok(
  $$select public.resolve_private_quote_checkout(
    encode(extensions.digest('integration-quote-token', 'sha256'), 'hex'),
    '10000000-0000-4000-8000-000000000007',
    'integration-quote-outsider@example.test'
  )$$,
  'P0001',
  'private_quote_invalid_or_expired',
  'a quote token cannot be resolved by a different verified email'
);
select is(
  (public.resolve_private_quote_checkout(
    encode(extensions.digest('integration-quote-token', 'sha256'), 'hex'),
    '10000000-0000-4000-8000-000000000006',
    'integration-quote-owner@example.test'
  ) ->> 'session_id')::uuid,
  '30000000-0000-4000-8000-000000000003'::uuid,
  'the matching verified customer can resolve their private quote'
);

select lives_ok(
  $$select public.list_private_request_quotes_page(
    '10000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    null,
    null,
    1
  )$$,
  'an administrator can load a bounded private-request quote-history page'
);
select is(
  jsonb_array_length(public.list_private_request_quotes_page(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    null,
    null,
    1
  ) -> 'items'),
  1,
  'a private-request quote-history page honors its limit'
);
select is(
  (public.list_private_request_quotes_page(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    null,
    null,
    1
  ) -> 'items' -> 0) ? 'checkout_token_hash',
  false,
  'quote history omits the checkout-token verifier'
);
select is(
  (
    with first_page as (
      select public.list_private_request_quotes_page(
        '10000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        null,
        null,
        1
      ) as page
    ), second_page as (
      select public.list_private_request_quotes_page(
        '10000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        (page -> 'next_cursor' ->> 'at')::timestamptz,
        (page -> 'next_cursor' ->> 'id')::uuid,
        1
      ) as page
      from first_page
    )
    select page -> 'items' -> 0 ->> 'id' from second_page
  ),
  '40000000-0000-4000-8000-000000000003',
  'the quote-history cursor reaches the same-timestamp record without a skip or duplicate'
);
select throws_ok(
  $$select public.list_private_request_quotes_page(
    '10000000-0000-4000-8000-000000000007',
    '40000000-0000-4000-8000-000000000001',
    null,
    null,
    1
  )$$,
  'P0001',
  'staff_admin_required',
  'a non-staff account cannot load private-request quote history'
);

insert into public.enrollments (
  id, session_id, user_id, attendee_email, status, amount_cents, currency, confirmed_at
)
values (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000006',
  'integration-quote-owner@example.test',
  'confirmed',
  12500,
  'EUR',
  now()
);
select is(
  public.create_customer_request(
    '10000000-0000-4000-8000-000000000006',
    'cancellation',
    '50000000-0000-4000-8000-000000000001',
    'Please review this cancellation request.'
  ) -> 'request' ->> 'kind',
  'cancellation',
  'a customer can submit a cancellation request for their own enrollment'
);
select throws_ok(
  $$select public.create_customer_request(
    '10000000-0000-4000-8000-000000000007',
    'cancellation',
    '50000000-0000-4000-8000-000000000001',
    'Attempt to submit a cancellation for somebody else.'
  )$$,
  'P0001',
  'customer_request_enrollment_not_found',
  'a customer cannot submit a cancellation request for another enrollment'
);
select is(
  public.create_customer_request(
    '10000000-0000-4000-8000-000000000006',
    'access',
    null,
    'Please review this data access request.'
  ) -> 'request' ->> 'kind',
  'access',
  'a customer can submit a data-subject request without an enrollment'
);
select is(
  jsonb_array_length(public.list_customer_requests_for_staff(
    '10000000-0000-4000-8000-000000000002'
  ) -> 'requests'),
  1,
  'an administrator can review cancellation requests but not data-rights requests'
);
select throws_ok(
  $$select public.update_customer_request(
    '10000000-0000-4000-8000-000000000002',
    (select id from private.customer_requests where kind = 'access'),
    'in_review',
    null
  )$$,
  'P0001',
  'customer_request_not_found',
  'an administrator cannot update a data-rights request'
);
select lives_ok(
  $$select public.update_customer_request(
    '10000000-0000-4000-8000-000000000002',
    (select id from private.customer_requests where kind = 'cancellation'),
    'in_review',
    null
  )$$,
  'an administrator can update a cancellation request for manual review'
);
select is(
  jsonb_array_length(public.list_customer_requests_for_staff(
    '10000000-0000-4000-8000-000000000001'
  ) -> 'requests'),
  2,
  'an owner can review both cancellation and data-rights requests'
);

select lives_ok(
  $$select public.dashboard_overview('10000000-0000-4000-8000-000000000001')$$,
  'a staff member can load the aggregate-only overview action'
);
select throws_ok(
  $$select public.dashboard_overview('10000000-0000-4000-8000-000000000007')$$,
  'P0001',
  'staff_access_required',
  'a non-staff account cannot load the aggregate-only overview action'
);

select lives_ok(
  $$select public.list_staff_page(
    '10000000-0000-4000-8000-000000000001', 'enrollments', null, null, 50
  )$$,
  'an owner can load a bounded cursor page of bookings'
);
select is(
  (public.list_staff_page(
    '10000000-0000-4000-8000-000000000001', 'enrollments', null, null, 50
  ) -> 'items' -> 0) ? 'stripe_payment_intent_id',
  false,
  'a booking cursor page omits Stripe payment identifiers not needed by the workspace'
);
select is(
  jsonb_array_length(public.list_staff_page(
    '10000000-0000-4000-8000-000000000002', 'customer_requests', null, null, 50
  ) -> 'items'),
  1,
  'an administrator cursor page excludes data-rights requests'
);
select throws_ok(
  $$select public.list_staff_page(
    '10000000-0000-4000-8000-000000000002', 'audit', null, null, 50
  )$$,
  'P0001',
  'staff_owner_required',
  'an administrator cannot load owner-only audit pages'
);
select throws_ok(
  $$select public.list_staff_page(
    '10000000-0000-4000-8000-000000000001', 'enrollments', now(), null, 50
  )$$,
  'P0001',
  'staff_page_cursor_invalid',
  'a partial cursor is rejected rather than producing an unstable page'
);

-- Equal timestamps exercise the primary-key tiebreaker. These future-dated
-- disposable rows sort ahead of incidental audit records created by fixtures.
insert into private.audit_logs (action, target_type, target_id, occurred_at)
select 'integration.cursor_page', 'integration_test', series::text, now() + interval '1 hour'
from generate_series(1, 51) as series;
select is(
  jsonb_array_length(public.list_staff_page(
    '10000000-0000-4000-8000-000000000001', 'audit', null, null, 50
  ) -> 'items'),
  50,
  'an owner receives the requested first audit page size'
);
select is(
  jsonb_typeof(public.list_staff_page(
    '10000000-0000-4000-8000-000000000001', 'audit', null, null, 50
  ) -> 'next_cursor' -> 'id'),
  'string',
  'an audit cursor serializes its bigint identifier as text'
);
select is(
  (
    with first_page as (
      select public.list_staff_page(
        '10000000-0000-4000-8000-000000000001', 'audit', null, null, 50
      ) as page
    ), second_page as (
      select public.list_staff_page(
        '10000000-0000-4000-8000-000000000001',
        'audit',
        (page -> 'next_cursor' ->> 'at')::timestamptz,
        page -> 'next_cursor' ->> 'id',
        1
      ) as page
      from first_page
    )
    select page -> 'items' -> 0 ->> 'target_id' from second_page
  ),
  '1',
  'the second audit page reaches the same-timestamp row without a skip or duplicate'
);

-- An unrecognized verified webhook is persisted once; the same Stripe event
-- id must be idempotently recognized on retry.
select is(
  (public.process_stripe_event(
    'evt_integration_unrecognized', 'integration.unrecognized', '{}'::jsonb
  ) ->> 'duplicate')::boolean,
  false,
  'the first webhook delivery is processed once'
);
select is(
  (public.process_stripe_event(
    'evt_integration_unrecognized', 'integration.unrecognized', '{}'::jsonb
  ) ->> 'duplicate')::boolean,
  true,
  'the same webhook event id is idempotently recognized as a duplicate'
);

-- Browser analytics remains consent-only and independent of transactional
-- reporting. No account identifier, request URL, or pre-consent event is used.
select is(
  (public.ingest_analytics_event(
    '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'page_view', null, null, repeat('a', 64), now()
  ) ->> 'accepted')::boolean,
  false,
  'an event with no active consent is not accepted'
);
create temporary table integration_analytics_fixture (consent_id uuid not null);
insert into integration_analytics_fixture (consent_id)
select (public.grant_analytics_consent('2026-08-19', repeat('b', 64)) ->> 'consent_id')::uuid;
select is(
  (public.ingest_analytics_event(
    (select consent_id from integration_analytics_fixture),
    '70000000-0000-4000-8000-000000000002',
    'page_view', null, null, repeat('c', 64), now()
  ) ->> 'accepted')::boolean,
  true,
  'an allowlisted anonymous event with active consent is accepted'
);
select ok(
  (
    select course_id is null
    from private.analytics_events
    where consent_id = (select consent_id from integration_analytics_fixture)
  ),
  'a consented page view stores no course identifier'
);
select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'analytics_events'
      and column_name = any(array[
        'user_id', 'page_path', 'referrer', 'utm_medium', 'utm_campaign', 'properties'
      ])
  ),
  0::bigint,
  'the analytics event schema omits account, path, referrer, campaign, and arbitrary-property columns'
);
select is(
  (public.withdraw_analytics_consent((select consent_id from integration_analytics_fixture))
    ->> 'events_deleted')::integer,
  1,
  'withdrawing consent deletes associated raw analytics events'
);

insert into private.analytics_consents (id, policy_version, expires_at)
values
  ('60000000-0000-4000-8000-000000000002', '2026-08-19', now() + interval '180 days'),
  ('60000000-0000-4000-8000-000000000003', '2026-08-19', now() + interval '180 days');
insert into private.analytics_events (
  event_name, anonymous_id, utm_source, occurred_at, consent_id
)
values
  (
    'page_view', '70000000-0000-4000-8000-000000000003', null,
    now(), '60000000-0000-4000-8000-000000000002'
  ),
  (
    'page_view', '70000000-0000-4000-8000-000000000004', null,
    now() - interval '31 days', '60000000-0000-4000-8000-000000000003'
  );
insert into private.analytics_daily (
  day, event_name, dimension, event_count, unique_anonymous_visitors, distinct_consent_count
)
values (
  ((now() at time zone 'Europe/Amsterdam')::date - interval '13 months')::date,
  'page_view', '', 20, 20, 20
);
select lives_ok(
  $$select public.rollup_and_retain_analytics()$$,
  'analytics rollup and retention maintenance completes for consented rows'
);
select is(
  (select count(*) from private.analytics_daily
   where day = (now() at time zone 'Europe/Amsterdam')::date
     and event_name = 'page_view'
     and dimension = ''),
  0::bigint,
  'reports suppress a daily browser-analytics aggregate below 20 consent ids'
);
select is(
  (select count(*) from private.analytics_events
   where consent_id = '60000000-0000-4000-8000-000000000003'::uuid),
  0::bigint,
  'analytics raw events older than 30 days are purged'
);
select is(
  (select count(*) from private.analytics_daily
   where day = ((now() at time zone 'Europe/Amsterdam')::date - interval '13 months')::date
     and event_name = 'page_view'),
  0::bigint,
  'analytics daily aggregates older than 12 months are purged'
);
select ok(
  private.analytics_event_count('checkout_started', now() - interval '1 hour', now() + interval '1 hour') >= 1,
  'operational checkout reporting remains available after browser analytics events are removed'
);
select ok(
  public.retention_review_status('10000000-0000-4000-8000-000000000001')
    -> 'pending_categories' ? 'bookings_payments',
  'the retention registry exposes unresolved transactional-retention approval as pending'
);

select * from finish();
rollback;
