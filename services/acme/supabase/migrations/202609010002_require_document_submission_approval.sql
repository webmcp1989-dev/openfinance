begin;

-- A WebMCP agent may prepare a document action, but only the signed-in AP
-- portal user can approve it. The final database mutation verifies that the
-- approved, bounded metadata is identical to the documents being committed.
create table public.document_submission_approvals (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (action in (
    'submit_invoice_batch',
    'respond_to_invoice_exception',
    'replace_rejected_invoice'
  )),
  initiated_by text not null check (initiated_by in ('agent', 'human')),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  preview jsonb not null check (
    jsonb_typeof(preview) = 'object'
    and octet_length(convert_to(preview::text, 'UTF8')) <= 16384
    and preview->>'action' = action
    and preview::text not like '%"contentBase64"%'
  ),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'consumed')),
  expires_at timestamptz not null default (statement_timestamp() + interval '5 minutes'),
  approved_at timestamptz,
  denied_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at),
  check ((status <> 'approved') or approved_at is not null),
  check ((status <> 'denied') or denied_at is not null),
  check ((status <> 'consumed') or (approved_at is not null and consumed_at is not null))
);

create index document_submission_approvals_actor_created_idx
  on public.document_submission_approvals (actor_user_id, created_at desc);
create index document_submission_approvals_supplier_status_idx
  on public.document_submission_approvals (supplier_id, status, expires_at);

alter table public.document_submission_approvals enable row level security;
revoke all on public.document_submission_approvals from public, anon, authenticated;

-- Construct the exact consent manifest from the final payload. Document bytes
-- are intentionally omitted; their already validated SHA-256 values bind the
-- approved metadata to the PDFs checked by each authoritative mutation.
create function private.document_submission_manifest(p_action text, p_payload jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_manifest jsonb;
begin
  if p_action = 'submit_invoice_batch' then
    select jsonb_build_object(
      'action', p_action,
      'invoices', coalesce(jsonb_agg(jsonb_build_object(
        'invoiceNumber', invoice.value->'invoiceNumber',
        'invoiceDate', invoice.value->'invoiceDate',
        'amountMinor', invoice.value->'amountMinor',
        'currency', invoice.value->'currency',
        'purchaseOrderNumber', invoice.value->'purchaseOrderNumber',
        'document', jsonb_build_object(
          'fileName', invoice.value->'document'->'fileName',
          'mediaType', invoice.value->'document'->'mediaType',
          'sha256', invoice.value->'document'->'sha256'
        )
      ) order by invoice.ordinality), '[]'::jsonb)
    ) into v_manifest
    from jsonb_array_elements(p_payload) with ordinality as invoice(value, ordinality);
  elsif p_action = 'respond_to_invoice_exception' then
    select jsonb_build_object(
      'action', p_action,
      'invoiceNumber', p_payload->'invoiceNumber',
      'exceptionCode', p_payload->'exceptionCode',
      'message', p_payload->'message',
      'attachments', coalesce(jsonb_agg(jsonb_build_object(
        'documentKind', attachment.value->'documentKind',
        'fileName', attachment.value->'fileName',
        'mediaType', attachment.value->'mediaType',
        'sha256', attachment.value->'sha256'
      ) order by attachment.ordinality) filter (where attachment.value is not null), '[]'::jsonb)
    ) into v_manifest
    from jsonb_array_elements(coalesce(p_payload->'attachments', '[]'::jsonb))
      with ordinality as attachment(value, ordinality);
  elsif p_action = 'replace_rejected_invoice' then
    v_manifest := jsonb_build_object(
      'action', p_action,
      'invoice', jsonb_build_object(
        'invoiceNumber', p_payload->'invoiceNumber',
        'invoiceDate', p_payload->'invoiceDate',
        'amountMinor', p_payload->'amountMinor',
        'currency', p_payload->'currency',
        'purchaseOrderNumber', p_payload->'purchaseOrderNumber',
        'document', jsonb_build_object(
          'fileName', p_payload->'document'->'fileName',
          'mediaType', p_payload->'document'->'mediaType',
          'sha256', p_payload->'document'->'sha256'
        )
      )
    );
  else
    raise exception using errcode = '22023', message = 'Unsupported document approval action';
  end if;
  return v_manifest;
end;
$$;

revoke execute on function private.document_submission_manifest(text, jsonb)
  from public, anon, authenticated;

create function private.request_document_submission_approval(
  p_action text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_preview jsonb,
  p_initiated_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_supplier_id uuid;
  v_buyer_id uuid;
  v_approval public.document_submission_approvals%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  select profile.supplier_id, supplier.buyer_id into v_supplier_id, v_buyer_id
  from public.profiles as profile
  join public.suppliers as supplier on supplier.id = profile.supplier_id
  where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Submitter access required';
  end if;
  if p_action not in ('submit_invoice_batch', 'respond_to_invoice_exception', 'replace_rejected_invoice')
     or p_initiated_by not in ('agent', 'human')
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128
     or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_preview) <> 'object'
     or p_preview->>'action' is distinct from p_action
     or octet_length(convert_to(p_preview::text, 'UTF8')) > 16384
     or p_preview::text like '%"contentBase64"%' then
    raise exception using errcode = '22023', message = 'Invalid document approval request';
  end if;

  insert into public.document_submission_approvals (
    buyer_id, supplier_id, actor_user_id, action, initiated_by,
    idempotency_key, request_fingerprint, preview
  ) values (
    v_buyer_id, v_supplier_id, v_user_id, p_action, p_initiated_by,
    p_idempotency_key, p_request_fingerprint, p_preview
  ) returning * into v_approval;

  return jsonb_build_object(
    'approvalId', v_approval.id,
    'status', v_approval.status,
    'expiresAt', v_approval.expires_at
  );
end;
$$;

create function private.decide_document_submission_approval(p_approval_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_supplier_id uuid;
  v_approval public.document_submission_approvals%rowtype;
  v_now timestamptz := statement_timestamp();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  select profile.supplier_id into v_supplier_id
  from public.profiles as profile
  where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Submitter access required';
  end if;
  if p_decision not in ('approved', 'denied') then
    raise exception using errcode = '22023', message = 'Invalid approval decision';
  end if;
  select approval.* into v_approval
  from public.document_submission_approvals as approval
  where approval.id = p_approval_id
    and approval.supplier_id = v_supplier_id
    and approval.actor_user_id = v_user_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Document approval not found';
  end if;
  if v_approval.status <> 'pending' or v_approval.expires_at <= v_now then
    raise exception using errcode = 'P0001', message = 'Document approval is no longer pending';
  end if;

  if p_decision = 'approved' then
    update public.document_submission_approvals
    set status = 'approved', approved_at = v_now
    where id = v_approval.id
    returning * into v_approval;
  else
    update public.document_submission_approvals
    set status = 'denied', denied_at = v_now
    where id = v_approval.id
    returning * into v_approval;
  end if;

  return jsonb_build_object(
    'approvalId', v_approval.id,
    'status', v_approval.status,
    'expiresAt', v_approval.expires_at
  );
end;
$$;

create function private.assert_document_submission_approval(
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
     or v_approval.request_fingerprint <> p_request_fingerprint
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

create function private.consume_document_submission_approval(p_approval_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.document_submission_approvals
  set status = 'consumed', consumed_at = statement_timestamp()
  where id = p_approval_id and status = 'approved';
end;
$$;

revoke execute on function private.request_document_submission_approval(text, text, text, jsonb, text),
  private.decide_document_submission_approval(uuid, text),
  private.assert_document_submission_approval(uuid, text, text, text, jsonb),
  private.consume_document_submission_approval(uuid)
  from public, anon, authenticated;

create function public.request_document_submission_approval(
  p_action text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_preview jsonb,
  p_initiated_by text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.request_document_submission_approval($1, $2, $3, $4, $5)
$$;

create function public.decide_document_submission_approval(p_approval_id uuid, p_decision text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.decide_document_submission_approval($1, $2)
$$;

revoke execute on function public.request_document_submission_approval(text, text, text, jsonb, text),
  public.decide_document_submission_approval(uuid, text)
  from public, anon;
grant execute on function public.request_document_submission_approval(text, text, text, jsonb, text),
  public.decide_document_submission_approval(uuid, text)
  to authenticated;

-- Keep the existing business implementations and response shapes. Only these
-- new wrappers are callable by authenticated clients, and approval assertion,
-- business mutation, and consumption share one PostgreSQL transaction.
create function public.submit_invoice_batch(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoices jsonb,
  p_approval_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.assert_document_submission_approval(
    p_approval_id, 'submit_invoice_batch', p_idempotency_key, p_request_fingerprint,
    private.document_submission_manifest('submit_invoice_batch', p_invoices)
  );
  v_result := public.submit_invoice_batch(p_idempotency_key, p_request_fingerprint, p_invoices);
  perform private.consume_document_submission_approval(p_approval_id);
  return v_result;
end;
$$;

create function public.respond_to_invoice_exception(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb,
  p_approval_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.assert_document_submission_approval(
    p_approval_id, 'respond_to_invoice_exception', p_idempotency_key, p_request_fingerprint,
    private.document_submission_manifest('respond_to_invoice_exception', p_payload)
  );
  v_result := private.respond_to_invoice_exception(p_idempotency_key, p_request_fingerprint, p_payload);
  perform private.consume_document_submission_approval(p_approval_id);
  return v_result;
end;
$$;

create function public.replace_rejected_invoice(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoice jsonb,
  p_approval_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.assert_document_submission_approval(
    p_approval_id, 'replace_rejected_invoice', p_idempotency_key, p_request_fingerprint,
    private.document_submission_manifest('replace_rejected_invoice', p_invoice)
  );
  v_result := private.replace_rejected_invoice(p_idempotency_key, p_request_fingerprint, p_invoice);
  perform private.consume_document_submission_approval(p_approval_id);
  return v_result;
end;
$$;

revoke execute on function public.submit_invoice_batch(text, text, jsonb),
  public.respond_to_invoice_exception(text, text, jsonb),
  public.replace_rejected_invoice(text, text, jsonb),
  private.submit_invoice_batch(text, text, jsonb),
  private.respond_to_invoice_exception(text, text, jsonb),
  private.replace_rejected_invoice(text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.submit_invoice_batch(text, text, jsonb, uuid),
  public.respond_to_invoice_exception(text, text, jsonb, uuid),
  public.replace_rejected_invoice(text, text, jsonb, uuid)
  from public, anon;
grant execute on function public.submit_invoice_batch(text, text, jsonb, uuid),
  public.respond_to_invoice_exception(text, text, jsonb, uuid),
  public.replace_rejected_invoice(text, text, jsonb, uuid)
  to authenticated;

-- Demo reset clears unfinished and historical consent artifacts for the signed-
-- in supplier while preserving the established canonical reset behavior.
alter function private.reset_demo_state()
  rename to reset_demo_state_before_document_approvals;
revoke execute on function private.reset_demo_state_before_document_approvals()
  from public, anon, authenticated;

create function private.reset_demo_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_supplier_id uuid;
begin
  v_result := private.reset_demo_state_before_document_approvals();
  select profile.supplier_id into v_supplier_id
  from public.profiles as profile
  where profile.user_id = auth.uid() and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Submitter access required';
  end if;
  delete from public.document_submission_approvals where supplier_id = v_supplier_id;
  return v_result || jsonb_build_object('documentApprovalsCleared', true);
end;
$$;

revoke execute on function private.reset_demo_state() from public, anon;
grant execute on function private.reset_demo_state() to authenticated;

commit;
