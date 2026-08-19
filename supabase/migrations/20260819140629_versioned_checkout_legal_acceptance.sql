-- A checkout can be retried while its hold is active. Preserve every distinct
-- accepted document version rather than silently retaining an older record.
alter table private.legal_acceptances
  drop constraint legal_acceptances_one_document_per_checkout;

alter table private.legal_acceptances
  add constraint legal_acceptances_one_version_per_checkout
    unique (checkout_id, document_key, document_version);

create or replace function public.record_checkout_legal_acceptance(
  p_checkout_id uuid,
  p_user_id uuid,
  p_documents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_checkout private.checkout_attempts%rowtype;
  v_inserted integer;
begin
  if p_documents is null
     or jsonb_typeof(p_documents) <> 'array'
     or jsonb_array_length(p_documents) <> 2
     or not exists (
       select 1 from jsonb_array_elements(p_documents) item
       where item ->> 'document_key' = 'terms'
         and length(trim(coalesce(item ->> 'document_version', ''))) between 1 and 64
     )
     or not exists (
       select 1 from jsonb_array_elements(p_documents) item
       where item ->> 'document_key' = 'cancellation'
         and length(trim(coalesce(item ->> 'document_version', ''))) between 1 and 64
     ) then
    raise exception using errcode = 'P0001', message = 'legal_documents_invalid';
  end if;

  select * into v_checkout
  from private.checkout_attempts
  where id = p_checkout_id
    and user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'checkout_not_found';
  end if;

  insert into private.legal_acceptances (
    checkout_id, user_id, document_key, document_version
  )
  select
    p_checkout_id,
    p_user_id,
    item ->> 'document_key',
    trim(item ->> 'document_version')
  from jsonb_array_elements(p_documents) item
  on conflict (checkout_id, document_key, document_version) do nothing;
  get diagnostics v_inserted = row_count;

  update public.profiles
     set terms_accepted_at = greatest(coalesce(terms_accepted_at, '-infinity'::timestamptz), now()),
         updated_at = now()
   where id = p_user_id;

  if v_inserted > 0 then
    insert into private.audit_logs (actor_user_id, action, target_type, target_id, metadata)
    values (
      p_user_id,
      'legal.checkout_acknowledged',
      'checkout',
      p_checkout_id::text,
      jsonb_build_object('documents', p_documents)
    );
  end if;

  return jsonb_build_object('checkout_id', p_checkout_id, 'recorded_documents', v_inserted);
end;
$$;

revoke execute on function public.record_checkout_legal_acceptance(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_checkout_legal_acceptance(uuid, uuid, jsonb)
  to service_role;
