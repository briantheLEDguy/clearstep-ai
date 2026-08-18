-- Run after storing `project_url` and a Supabase secret API key in Vault.
-- This is intentionally separate from migrations so a fresh project never
-- receives a broken cron job before its deployment secrets exist.
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select vault.create_secret('https://PROJECT_REF.supabase.co', 'project_url');
select vault.create_secret('sb_secret_REPLACE_ME', 'automation_secret_key');

select cron.schedule(
  'clearstep-automation-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/automation-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'automation_secret_key')
    ),
    body := '{"source":"cron"}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
