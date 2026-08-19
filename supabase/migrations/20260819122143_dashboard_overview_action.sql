-- The overview deliberately returns only the existing aggregate reporting
-- payload. Detail resources remain on their own role-checked, lazy actions.
create or replace function public.dashboard_overview(p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.staff_has_role(p_actor_user_id, array['owner', 'admin', 'analyst']) then
    raise exception using errcode = 'P0001', message = 'staff_access_required';
  end if;

  return public.staff_admin_action(
    p_actor_user_id,
    'analytics_summary',
    jsonb_build_object(
      'from', now() - interval '30 days',
      'to', now()
    )
  );
end;
$$;

revoke execute on function public.dashboard_overview(uuid)
  from public, anon, authenticated;
grant execute on function public.dashboard_overview(uuid)
  to service_role;
