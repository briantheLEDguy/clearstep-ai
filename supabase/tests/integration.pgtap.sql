-- Disposable local-stack integration coverage. The CLI applies every migration
-- before this test runs, and the transaction rollback leaves the local stack
-- reusable for later suites. These fixtures intentionally use .test addresses
-- and non-production identifiers only.
begin;

create extension if not exists pgtap with schema extensions;

select plan(113);

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
  ('10000000-0000-4000-8000-000000000008', 'integration-seat-filler@example.test', now()),
  ('10000000-0000-4000-8000-000000000009', 'integration-analyst@example.test', now());

insert into private.staff_members (user_id, email, role, status, activated_at)
values
  ('10000000-0000-4000-8000-000000000001', 'integration-owner@example.test', 'owner', 'active', now()),
  ('10000000-0000-4000-8000-000000000002', 'integration-admin@example.test', 'admin', 'active', now()),
  ('10000000-0000-4000-8000-000000000009', 'integration-analyst@example.test', 'analyst', 'active', now());

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
select throws_ok(
  $$update private.checkout_attempts
    set grace_expires_at = (
      select start_at + interval '1 second'
      from public.workshop_sessions
      where id = '30000000-0000-4000-8000-000000000001'::uuid
    )
    where checkout_kind = 'workshop'
      and session_id = '30000000-0000-4000-8000-000000000001'::uuid
      and user_id = '10000000-0000-4000-8000-000000000003'::uuid$$,
  '23514',
  'checkout_must_settle_by_session_start',
  'a workshop checkout still cannot settle after its session starts'
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

-- BNC service commerce keeps Plate & Post packages separate from Clearstep
-- workshops while reusing the same authenticated checkout and staff boundary.
select is(
  (select string_agg(id, ',' order by id) from public.service_lines),
  'clearstep,plate_and_post',
  'service lines use the stable Clearstep and Plate & Post identities'
);
select is(
  (select count(*) from public.courses where service_line_id <> 'clearstep'),
  0::bigint,
  'all workshop courses remain explicitly associated with Clearstep'
);
select is(
  (select count(*) from public.service_offerings where service_line_id = 'plate_and_post'),
  3::bigint,
  'the migration seeds three distinct Plate & Post offerings'
);
select is(
  (
    select string_agg(price_cents::text, ',' order by price_cents)
    from public.service_offerings
    where service_line_id = 'plate_and_post'
  ),
  '5000,7500,10000',
  'the three seeded prices are the approved VAT-inclusive euro amounts'
);
select is(
  (
    select count(*)
    from public.service_offerings
    where service_line_id = 'plate_and_post'
      and fulfillment_method <> 'manual_scheduling'
  ),
  0::bigint,
  'every seeded service uses the server-enforced manual-scheduling method'
);
select is(
  jsonb_array_length(public.public_service_catalog() -> 'services'),
  0,
  'the public service catalogue is fail-closed while seeded offerings are draft'
);

update public.service_offerings
set stripe_product_id = 'prod_integrationbasic',
    stripe_price_id = 'price_integrationbasic',
    updated_at = now()
where id = '5b010000-0000-4000-8000-000000000001'::uuid;

select is(
  jsonb_array_length(public.list_service_offerings_for_staff(
    '10000000-0000-4000-8000-000000000002'
  ) -> 'services'),
  3,
  'an administrator can load the shared Plate & Post offering workspace'
);
select throws_ok(
  $$select public.list_service_offerings_for_staff(
    '10000000-0000-4000-8000-000000000007'
  )$$,
  'P0001',
  'staff_admin_required',
  'a customer cannot load provider-linked service catalogue records'
);
select throws_ok(
  $$select public.create_service_checkout_attempt(
    'basic-product-shoot',
    '10000000-0000-4000-8000-000000000003',
    'integration-customer-a@example.test'
  )$$,
  'P0001',
  'service_not_available',
  'an ordinary customer cannot check out a draft offering'
);

create temporary table integration_service_fixture (
  staff_checkout_id uuid,
  customer_checkout_id uuid,
  service_order_id uuid,
  async_checkout_id uuid,
  async_order_id uuid
);
insert into integration_service_fixture (staff_checkout_id)
select (public.create_service_checkout_attempt(
  'basic-product-shoot',
  '10000000-0000-4000-8000-000000000002',
  'integration-admin@example.test'
) ->> 'checkout_id')::uuid;

select throws_ok(
  $$update private.checkout_attempts
    set session_id = '30000000-0000-4000-8000-000000000001'::uuid
    where id = (select staff_checkout_id from integration_service_fixture)$$,
  '23514',
  'new row for relation "checkout_attempts" violates check constraint "checkout_attempts_target_valid"',
  'a service checkout cannot acquire a workshop session target'
);

select ok(
  (
    select extract(epoch from (expires_at - created_at)) between 3599 and 3601
    from private.checkout_attempts
    where id = (select staff_checkout_id from integration_service_fixture)
  ),
  'a service Checkout Session attempt expires after exactly 60 minutes'
);
select is(
  (public.create_service_checkout_attempt(
    'basic-product-shoot',
    '10000000-0000-4000-8000-000000000002',
    'integration-admin@example.test'
  ) ->> 'reused')::boolean,
  true,
  'a staff sandbox retry reuses its active service checkout attempt'
);
select is(
  public.fail_checkout_attempt(
    (select staff_checkout_id from integration_service_fixture),
    '10000000-0000-4000-8000-000000000002',
    'Disposable service checkout fixture',
    'creating'
  ) ->> 'checkout_status',
  'failed',
  'a failed service checkout becomes terminal without a workshop seat hold'
);

select is(
  public.upsert_service_offering(
    '10000000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'catalog_item_id', '5b010000-0000-4000-8000-000000000001',
      'slug', 'basic-product-shoot',
      'title', 'Basic Product Shoot',
      'summary', 'A focused food product photography package.',
      'description', 'Product photography for a food-related product or project.',
      'outcomes', '[]'::jsonb,
      'audience', 'Food brands, restaurants, and hospitality businesses.',
      'fulfillment_method', 'manual_scheduling',
      'price_cents', 5000,
      'currency', 'EUR',
      'stripe_product_id', 'prod_integrationbasic',
      'stripe_price_id', 'price_integrationbasic',
      'visibility', 'public',
      'status', 'published',
      'seo_title', 'Basic Product Shoot | Plate & Post',
      'seo_description', 'Food product photography from Plate & Post.'
    )
  ) -> 'service' ->> 'status',
  'published',
  'the shared staff mutation can publish a Stripe-linked service offering'
);
select is(
  jsonb_array_length(public.public_service_catalog() -> 'services'),
  1,
  'the public catalogue includes only the configured published offering'
);
select ok(
  not ((public.public_service_catalog() -> 'services' -> 0)::text ~ 'stripe_(product|price)_id'),
  'the public catalogue omits provider-only Stripe identifiers'
);

update integration_service_fixture
set customer_checkout_id = (public.create_service_checkout_attempt(
  'basic-product-shoot',
  '10000000-0000-4000-8000-000000000003',
  'integration-customer-a@example.test'
) ->> 'checkout_id')::uuid;

select is(
  (
    select checkout_kind
    from private.checkout_attempts
    where id = (select customer_checkout_id from integration_service_fixture)
  ),
  'service_order',
  'a customer service checkout persists an explicit service-order target'
);
update integration_service_fixture
set service_order_id = (public.attach_service_stripe_checkout(
    (select customer_checkout_id from integration_service_fixture),
    '10000000-0000-4000-8000-000000000003',
    'cs_test_integrationservice',
    'cus_integrationservice'
  ) ->> 'service_order_id')::uuid;
select is(
  (
    select payment_status
    from public.service_orders
    where id = (select service_order_id from integration_service_fixture)
  ),
  'pending',
  'service attachment creates the pending immutable-snapshot order before redirect'
);
select is(
  (public.attach_service_stripe_checkout(
    (select customer_checkout_id from integration_service_fixture),
    '10000000-0000-4000-8000-000000000003',
    'cs_test_integrationservice',
    'cus_integrationservice'
  ) ->> 'reused')::boolean,
  true,
  'retrying the same service attachment reuses its pending order atomically'
);
select throws_ok(
  $$select public.attach_service_stripe_checkout(
    (select customer_checkout_id from integration_service_fixture),
    '10000000-0000-4000-8000-000000000003',
    'cs_test_integrationserviceother',
    'cus_integrationservice'
  )$$,
  'P0001',
  'service_checkout_not_attachable',
  'a conflicting attachment cannot replace the order snapshot or Stripe Session'
);
select is(
  public.process_stripe_event(
    'evt_integration_service_paid',
    'checkout.session.completed',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object(
          'id', 'cs_test_integrationservice',
          'client_reference_id', (select customer_checkout_id::text from integration_service_fixture),
          'payment_status', 'paid',
          'amount_total', 5000,
          'currency', 'eur',
          'payment_intent', 'pi_integrationservice',
          'customer', 'cus_integrationservice'
        )
      )
    )
  ) ->> 'payment_status',
  'paid',
  'a verified paid Stripe event creates a paid service order'
);

select is(
  (
    select payment_status
    from public.service_orders
    where id = (select service_order_id from integration_service_fixture)
  ),
  'paid',
  'Stripe owns and persists the service-order payment status'
);
select is(
  (
    select fulfillment_status
    from public.service_orders
    where id = (select service_order_id from integration_service_fixture)
  ),
  'new',
  'a newly paid service order enters the independent staff fulfillment queue'
);
select is(
  (
    select count(*)
    from private.automation_jobs
    where payload ->> 'template' in (
      'service_order_confirmation', 'service_order_admin_alert'
    )
      and payload ->> 'service_order_id' = (
        select service_order_id::text from integration_service_fixture
      )
  ),
  2::bigint,
  'the first paid transition queues one customer confirmation and one staff alert'
);
select is(
  (public.process_stripe_event(
    'evt_integration_service_paid',
    'checkout.session.completed',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object('id', 'cs_test_integrationservice')
      )
    )
  ) ->> 'duplicate')::boolean,
  true,
  'a duplicate service payment event is idempotently recognized'
);
select is(
  (
    select count(*)
    from private.automation_jobs
    where payload ->> 'template' in (
      'service_order_confirmation', 'service_order_admin_alert'
    )
      and payload ->> 'service_order_id' = (
        select service_order_id::text from integration_service_fixture
      )
  ),
  2::bigint,
  'a duplicate paid event queues no duplicate service-order email'
);

update integration_service_fixture
set async_checkout_id = (public.create_service_checkout_attempt(
  'basic-product-shoot',
  '10000000-0000-4000-8000-000000000004',
  'integration-customer-b@example.test'
) ->> 'checkout_id')::uuid;
update integration_service_fixture
set async_order_id = (public.attach_service_stripe_checkout(
  (select async_checkout_id from integration_service_fixture),
  '10000000-0000-4000-8000-000000000004',
  'cs_test_integrationasync',
  'cus_integrationasync'
) ->> 'service_order_id')::uuid;
select is(
  public.process_stripe_event(
    'evt_integration_service_pending',
    'checkout.session.completed',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object(
          'id', 'cs_test_integrationasync',
          'payment_status', 'unpaid',
          'amount_total', 5000,
          'currency', 'eur',
          'payment_intent', 'pi_integrationasync'
        )
      )
    )
  ) ->> 'payment_status',
  'pending',
  'an unpaid completed Checkout Session remains pending for asynchronous settlement'
);
select is(
  public.process_stripe_event(
    'evt_integration_service_async_paid',
    'checkout.session.async_payment_succeeded',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object(
          'id', 'cs_test_integrationasync',
          'payment_status', 'paid',
          'amount_total', 5000,
          'currency', 'eur',
          'payment_intent', 'pi_integrationasync'
        )
      )
    )
  ) ->> 'payment_status',
  'paid',
  'an asynchronous success promotes the same pending service order to paid'
);
select is(
  public.process_stripe_event(
    'evt_integration_service_late_expired',
    'checkout.session.expired',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object(
          'id', 'cs_test_integrationasync',
          'payment_status', 'unpaid'
        )
      )
    )
  ) ->> 'reason',
  'checkout_already_payment_terminal',
  'an out-of-order expiry cannot reverse an asynchronously paid service order'
);
select is(
  (public.process_stripe_event(
    'evt_integration_service_async_paid',
    'checkout.session.async_payment_succeeded',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object('id', 'cs_test_integrationasync')
      )
    )
  ) ->> 'duplicate')::boolean,
  true,
  'a duplicate asynchronous success event is idempotently recognized'
);
select is(
  (
    select count(*)
    from private.automation_jobs
    where payload ->> 'template' in (
      'service_order_confirmation', 'service_order_admin_alert'
    )
      and payload ->> 'service_order_id' = (
        select async_order_id::text from integration_service_fixture
      )
  ),
  2::bigint,
  'asynchronous settlement queues its notifications exactly once'
);

set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000003';
set local request.jwt.claim.role = 'authenticated';
select is(
  jsonb_array_length(public.list_my_service_orders(
    '10000000-0000-4000-8000-000000000003'
  ) -> 'orders'),
  1,
  'an authenticated customer can list their own service orders'
);
select ok(
  not (
    public.list_my_service_orders('10000000-0000-4000-8000-000000000003')
      -> 'orders' -> 0 ? 'stripe_checkout_session_id'
  ),
  'the account read model omits provider-only checkout identifiers'
);
select throws_ok(
  $$select public.list_my_service_orders(
    '10000000-0000-4000-8000-000000000004'
  )$$,
  'P0001',
  'service_orders_access_denied',
  'an authenticated customer cannot request another account service-order list'
);
select is(
  (select count(*) from public.service_orders),
  1::bigint,
  'service-order row-level security exposes only the signed-in customer order'
);
reset role;

select is(
  jsonb_array_length(public.list_service_orders_for_staff(
    '10000000-0000-4000-8000-000000000002', 10
  ) -> 'orders'),
  2,
  'the same staff workspace can load the service fulfillment queue'
);
select ok(
  public.list_service_orders_for_staff(
    '10000000-0000-4000-8000-000000000002', 10
  ) -> 'orders' -> 0 ? 'stripe_payment_intent_id',
  'the protected staff order model includes the Stripe reconciliation identifier'
);
select throws_ok(
  $$select public.update_service_order_fulfillment(
    '10000000-0000-4000-8000-000000000002',
    (select service_order_id from integration_service_fixture),
    'scheduled'
  )$$,
  'P0001',
  'service_fulfillment_transition_invalid',
  'staff cannot skip the service fulfillment sequence'
);
select is(
  public.update_service_order_fulfillment(
    '10000000-0000-4000-8000-000000000002',
    (select service_order_id from integration_service_fixture),
    'contacted'
  ) -> 'order' ->> 'fulfillment_status',
  'contacted',
  'staff can mark a paid service order as contacted'
);
select is(
  public.update_service_order_fulfillment(
    '10000000-0000-4000-8000-000000000002',
    (select service_order_id from integration_service_fixture),
    'scheduled'
  ) -> 'order' ->> 'fulfillment_status',
  'scheduled',
  'staff can schedule a contacted service order'
);
select is(
  public.update_service_order_fulfillment(
    '10000000-0000-4000-8000-000000000002',
    (select service_order_id from integration_service_fixture),
    'in_progress'
  ) -> 'order' ->> 'fulfillment_status',
  'in_progress',
  'staff can move a scheduled service order into production'
);
select is(
  public.update_service_order_fulfillment(
    '10000000-0000-4000-8000-000000000002',
    (select service_order_id from integration_service_fixture),
    'delivered'
  ) -> 'order' ->> 'fulfillment_status',
  'delivered',
  'staff can deliver an in-progress service order'
);

select is(
  public.create_customer_request(
    '10000000-0000-4000-8000-000000000003',
    'change',
    null,
    (select service_order_id from integration_service_fixture),
    'Please review a scheduling change for this service order.'
  ) -> 'request' ->> 'service_order_id',
  (select service_order_id::text from integration_service_fixture),
  'a customer can submit human-reviewed change intake for their own service order'
);
select throws_ok(
  $$select public.create_customer_request(
    '10000000-0000-4000-8000-000000000004',
    'cancellation',
    null,
    (select service_order_id from integration_service_fixture),
    'Attempt to cancel another customer service order.'
  )$$,
  'P0001',
  'customer_request_service_order_not_found',
  'a customer cannot reference another account service order in rights intake'
);
select ok(
  exists (
    select 1
    from jsonb_array_elements(
      public.list_customer_requests_page(
        '10000000-0000-4000-8000-000000000002',
        null,
        null,
        50
      ) -> 'items'
    ) item
    where item ->> 'service_order_id' = (
      select service_order_id::text from integration_service_fixture
    )
      and item ->> 'kind' = 'change'
  ),
  'the paged staff request queue exposes a service-order change target to an admin'
);
select throws_ok(
  $$select public.list_customer_requests_page(
    '10000000-0000-4000-8000-000000000007',
    null,
    null,
    50
  )$$,
  'P0001',
  'staff_admin_required',
  'a customer cannot read the paged staff request queue'
);

select is(
  public.process_stripe_event(
    'evt_integration_service_refund',
    'charge.refunded',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object(
          'id', 'ch_integrationservice',
          'payment_intent', 'pi_integrationservice',
          'amount', 5000,
          'amount_refunded', 5000,
          'currency', 'eur'
        )
      )
    )
  ) ->> 'payment_status',
  'refunded',
  'a full verified refund independently updates service payment status'
);
select is(
  (
    select fulfillment_status
    from public.service_orders
    where id = (select service_order_id from integration_service_fixture)
  ),
  'delivered',
  'a refund does not rewrite the staff-owned fulfillment history'
);
select is(
  (
    select count(*)
    from private.automation_jobs
    where payload ->> 'template' = 'service_order_refund'
      and payload ->> 'to' = 'integration-customer-a@example.test'
  ),
  1::bigint,
  'a full refund queues one service-specific customer notice'
);
select is(
  (public.process_stripe_event(
    'evt_integration_service_refund',
    'charge.refunded',
    jsonb_build_object(
      'data', jsonb_build_object(
        'object', jsonb_build_object('payment_intent', 'pi_integrationservice')
      )
    )
  ) ->> 'duplicate')::boolean,
  true,
  'a duplicate service refund event is idempotently recognized'
);
select is(
  (
    select count(*)
    from private.automation_jobs
    where payload ->> 'template' = 'service_order_refund'
      and payload ->> 'to' = 'integration-customer-a@example.test'
  ),
  1::bigint,
  'a duplicate refund queues no duplicate customer notice'
);
select is(
  (public.create_service_checkout_attempt(
    'basic-product-shoot',
    '10000000-0000-4000-8000-000000000003',
    'integration-customer-a@example.test'
  ) ->> 'reused')::boolean,
  false,
  'a customer can start a fresh service checkout after the prior attempt is terminal'
);
select is(
  public.update_service_offering_price(
    '10000000-0000-4000-8000-000000000002',
    '5b010000-0000-4000-8000-000000000001',
    5000,
    'price_integrationbasicv2',
    5000,
    'price_integrationbasic'
  ) -> 'service' ->> 'stripe_price_id',
  'price_integrationbasicv2',
  'a staff price change atomically installs a newly verified Stripe Price'
);
select throws_ok(
  $$select public.update_service_offering_price(
    '10000000-0000-4000-8000-000000000002',
    '5b010000-0000-4000-8000-000000000001',
    5000,
    'price_integrationbasicv3',
    5000,
    'price_integrationbasic'
  )$$,
  'P0001',
  'service_price_changed',
  'a stale admin price write cannot overwrite a newer Stripe Price link'
);
select is(
  public.service_analytics_summary(
    '10000000-0000-4000-8000-000000000009',
    now() - interval '1 hour',
    now() + interval '1 second'
  ),
  jsonb_build_object(
    'service_line_id', 'plate_and_post',
    'orders_started', 2,
    'paid_orders', 2,
    'pending_orders', 0,
    'refunded_orders', 1,
    'gross_revenue_cents', 10000,
    'refunded_cents', 5000,
    'net_revenue_cents', 5000,
    'currency', 'EUR'
  ),
  'an analyst receives only aggregate Plate & Post order and payment metrics'
);
select throws_ok(
  $$select public.service_analytics_summary(
    '10000000-0000-4000-8000-000000000007',
    now() - interval '1 hour',
    now()
  )$$,
  'P0001',
  'staff_access_required',
  'a customer cannot access protected service commerce analytics'
);

select * from finish();
rollback;
