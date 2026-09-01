begin;

-- Consent intentionally excludes PDF base64, so its metadata fingerprint cannot
-- equal the existing full-payload idempotency fingerprint. Approval is bound to
-- the exact visible manifest (including each document SHA-256); the underlying
-- mutation separately derives and validates full request identity and verifies
-- that the PDF bytes match the approved SHA-256.
create or replace function private.assert_document_submission_approval(
  p_approval_id uuid,
  p_action text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_supplier_id uuid;
  v_approval public.document_submission_approvals%rowtype;
begin
  select profile.supplier_id into v_supplier_id
  from public.profiles as profile
  where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_user_id is null or v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Submitter access required';
  end if;
  select approval.* into v_approval
  from public.document_submission_approvals as approval
  where approval.id = p_approval_id
    and approval.supplier_id = v_supplier_id
    and approval.actor_user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'Document approval is required';
  end if;
  if v_approval.action <> p_action
     or v_approval.idempotency_key <> p_idempotency_key
     or v_approval.preview <> p_manifest then
    raise exception using errcode = 'P0001', message = 'Document approval does not match this request';
  end if;
  if v_approval.status = 'consumed' then
    return;
  end if;
  if v_approval.status <> 'approved' or v_approval.expires_at <= statement_timestamp() then
    raise exception using errcode = 'P0001', message = 'Document approval is not active';
  end if;
end;
$$;

revoke execute on function private.assert_document_submission_approval(uuid, text, text, text, jsonb)
  from public, anon, authenticated;

commit;
