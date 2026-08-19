create or replace function private.enforce_checkout_before_session_start()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Fixed services use their own 60-minute checkout deadline and are not
  -- associated with workshop sessions. The target-shape constraint remains
  -- authoritative for their null session and hold references.
  if new.checkout_kind = 'service_order' then
    return new;
  end if;

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
