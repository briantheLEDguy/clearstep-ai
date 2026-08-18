insert into public.courses (
  id,
  slug,
  title,
  summary,
  description,
  outcomes,
  level,
  audience,
  agenda,
  duration_minutes,
  price_cents,
  currency,
  stripe_product_id,
  stripe_price_id,
  status,
  seo_title,
  seo_description
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    'make-ai-useful',
    'Make AI useful in your everyday work',
    'Learn a practical prompting method, build one useful workflow, and leave with a clear next step.',
    'A welcoming, hands-on introduction for people who want useful results from AI without becoming technical experts. Bring one real task from your week and turn it into a repeatable workflow with guided support.',
    array[
      'A clear prompting method you can reuse',
      'One working AI-assisted workflow based on your own task',
      'A simple checklist for reviewing quality and protecting sensitive information',
      'A practical next-step plan for the week after the workshop'
    ],
    'Beginner',
    'Freelancers, founders, and small-business teams who are new to practical AI.',
    jsonb_build_array(
      jsonb_build_object('title', 'Start with the work', 'detail', 'Choose a real task and define what a useful result looks like.'),
      jsonb_build_object('title', 'Use a clear method', 'detail', 'Build context, instructions, examples, and a review step into one prompt.'),
      jsonb_build_object('title', 'Make it repeatable', 'detail', 'Test, improve, and document a workflow you can use again.')
    ),
    180,
    14900,
    'EUR',
    null,
    null,
    'draft',
    'Make AI useful in your everyday work | Clearstep',
    'A practical three-hour AI workshop in Amsterdam for freelancers and small-business owners.'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'clearer-content-with-ai',
    'Create clearer content with AI',
    'Turn a rough idea into useful, on-brand content while keeping your judgment and voice in the process.',
    'A practical session for anyone who writes client updates, newsletters, web copy, or social posts. You will create a lightweight content workflow that starts with your expertise and keeps human review at the center.',
    array[
      'A reusable brief that gives AI the right context',
      'A practical workflow from idea to edited draft',
      'A voice-check that helps content still sound like you',
      'Prompts for repurposing one idea across useful formats'
    ],
    'Beginner',
    'Business owners and communicators who want to publish more consistently without sounding generic.',
    jsonb_build_array(
      jsonb_build_object('title', 'Find the useful idea', 'detail', 'Turn your expertise and audience needs into a focused content brief.'),
      jsonb_build_object('title', 'Draft with direction', 'detail', 'Use AI to explore and structure, not replace your point of view.'),
      jsonb_build_object('title', 'Edit for trust', 'detail', 'Check accuracy, voice, clarity, and the action you want readers to take.')
    ),
    180,
    12900,
    'EUR',
    null,
    null,
    'draft',
    'Create clearer content with AI | Clearstep',
    'A practical live online workshop for creating useful, on-brand content with AI.'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'simplify-admin-with-ai',
    'Simplify recurring admin with AI',
    'Spot the repeatable parts of routine admin and turn one of them into a safer, faster workflow.',
    'Map a recurring administrative task, identify where AI helps and where it should not, then build a practical workflow with sensible review points. The focus is time saved without losing control.',
    array[
      'A map of one recurring process',
      'A reusable AI-assisted workflow with review points',
      'Clear guidance on what information not to share',
      'A simple way to measure whether the workflow is worthwhile'
    ],
    'Beginner',
    'Owners and operations leads with recurring notes, summaries, handovers, or client follow-ups.',
    jsonb_build_array(
      jsonb_build_object('title', 'Map the routine', 'detail', 'Separate judgment-heavy work from repeatable steps.'),
      jsonb_build_object('title', 'Build the workflow', 'detail', 'Create prompts, templates, and checks around one real process.'),
      jsonb_build_object('title', 'Use it responsibly', 'detail', 'Set boundaries for privacy, accuracy, and final approval.')
    ),
    180,
    14900,
    'EUR',
    null,
    null,
    'draft',
    'Simplify recurring admin with AI | Clearstep',
    'A practical in-person workshop for simplifying recurring admin with safe, reviewable AI workflows.'
  )
on conflict (id) do update
set
  slug = excluded.slug,
  title = excluded.title,
  summary = excluded.summary,
  description = excluded.description,
  outcomes = excluded.outcomes,
  level = excluded.level,
  audience = excluded.audience,
  agenda = excluded.agenda,
  duration_minutes = excluded.duration_minutes,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  stripe_product_id = coalesce(public.courses.stripe_product_id, excluded.stripe_product_id),
  stripe_price_id = coalesce(public.courses.stripe_price_id, excluded.stripe_price_id),
  status = public.courses.status,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description,
  updated_at = now();

insert into public.workshop_sessions (
  id,
  course_id,
  format,
  start_at,
  end_at,
  timezone,
  venue,
  capacity,
  status
)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '11111111-1111-4111-8111-111111111111',
    'in_person',
    '2026-09-18T09:30:00+02:00',
    '2026-09-18T12:30:00+02:00',
    'Europe/Amsterdam',
    'Amsterdam',
    10,
    'draft'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '22222222-2222-4222-8222-222222222222',
    'online',
    '2026-10-02T13:00:00+02:00',
    '2026-10-02T16:00:00+02:00',
    'Europe/Amsterdam',
    null,
    14,
    'draft'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '33333333-3333-4333-8333-333333333333',
    'in_person',
    '2026-11-12T09:30:00+01:00',
    '2026-11-12T12:30:00+01:00',
    'Europe/Amsterdam',
    'Utrecht',
    10,
    'draft'
  )
on conflict (id) do update
set
  course_id = excluded.course_id,
  format = excluded.format,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  timezone = excluded.timezone,
  venue = excluded.venue,
  capacity = excluded.capacity,
  status = public.workshop_sessions.status,
  updated_at = now();

select private.enqueue_job(
  'calendar_session',
  jsonb_build_object(
    'session_id', s.id,
    'course_title', c.title,
    'start_at', s.start_at,
    'end_at', s.end_at,
    'timezone', s.timezone,
    'format', s.format,
    'venue', s.venue,
    'google_event_id', si.google_event_id,
    'meet_url', si.meet_url
  ),
  'calendar-session:' || s.id::text || ':seed'
)
from public.workshop_sessions s
join public.courses c on c.id = s.course_id
left join private.session_integrations si on si.session_id = s.id
where s.id in (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'
);

-- Seed records stay draft until real Stripe Products and EUR Prices (with
-- VAT-inclusive tax_behavior) are added and an operator publishes them.
