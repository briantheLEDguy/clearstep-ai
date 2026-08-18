create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'clearstep-booking-maintenance';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'clearstep-booking-maintenance',
    '* * * * *',
    'select public.run_booking_maintenance()'
  );
end;
$$;
