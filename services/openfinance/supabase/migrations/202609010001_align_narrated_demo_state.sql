begin;

-- Preserve the complete canonical 24-invoice reset, then narrow only the live
-- narrated candidate set. Historical rows remain realistic but no longer
-- appear as ready work for the agent.
alter function private.reset_demo_state()
  rename to reset_demo_state_before_narrated_alignment;
revoke execute on function private.reset_demo_state_before_narrated_alignment()
  from public, anon, authenticated;

create function private.reset_demo_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_organization_id uuid;
  v_updated integer;
begin
  v_result := private.reset_demo_state_before_narrated_alignment();
  select profile.organization_id into v_organization_id
  from public.profiles as profile
  where profile.user_id = auth.uid() and profile.role in ('admin', 'operator');
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Operator access required';
  end if;

  update public.invoices as invoice
  set status = seed.status,
      portal_reference = seed.portal_reference,
      portal_status = seed.portal_status,
      exception_code = seed.exception_code,
      exception_message = seed.exception_message,
      last_portal_checked_at = null,
      paid_amount_minor = 0,
      last_payment_at = null,
      last_payment_reference = null,
      version = 1,
      updated_at = statement_timestamp()
  from (values
    ('INV-10417', 'needs_attention'::public.invoice_status,
      'ACME-20260820-A1041701'::text, 'disputed'::text,
      'missing_delivery_proof'::text,
      'Acme requires proof of delivery. Supplier AR can attach the verified document and respond.'::text),
    ('INV-10463', 'needs_attention'::public.invoice_status,
      'ACME-20260820-A1046301'::text, 'disputed'::text,
      'missing_goods_receipt'::text,
      'Acme receiving must post the missing goods receipt. The supplier can open a tracked buyer case.'::text),
    ('INV-10522', 'accepted'::public.invoice_status,
      'ACME-20260821-A1052201'::text, 'accepted'::text, null::text, null::text),
    ('INV-10538', 'accepted'::public.invoice_status,
      'ACME-20260822-A1053801'::text, 'accepted'::text, null::text, null::text),
    ('INV-10544', 'accepted'::public.invoice_status,
      'ACME-20260823-A1054401'::text, 'accepted'::text, null::text, null::text),
    ('INV-10561', 'accepted'::public.invoice_status,
      'ACME-20260824-A1056101'::text, 'accepted'::text, null::text, null::text)
  ) as seed(invoice_number, status, portal_reference, portal_status,
    exception_code, exception_message)
  where invoice.organization_id = v_organization_id
    and invoice.invoice_number = seed.invoice_number;
  get diagnostics v_updated = row_count;
  if v_updated <> 6 then
    raise exception using errcode = 'P0002', message = 'Narrated invoice baseline is incomplete';
  end if;
  if (select count(*) from public.invoices
      where organization_id = v_organization_id and status = 'ready') <> 3 then
    raise exception using errcode = 'P0002', message = 'Narrated ready queue is incomplete';
  end if;

  return v_result || jsonb_build_object('readyInvoiceCount', 3);
end;
$$;

revoke execute on function private.reset_demo_state() from public, anon, authenticated;

-- Keep all existing delivery behavior as the normal engine. This wrapper adds
-- the one legitimate no-replacement transition the earlier implementation did
-- not model: an existing disputed receipt becomes accepted after AP verifies
-- the exact requested supplier evidence.
alter function private.record_delivery_event(
  public.delivery_event_type, text, text, jsonb
) rename to record_delivery_event_without_evidence_resolution;
revoke execute on function private.record_delivery_event_without_evidence_resolution(
  public.delivery_event_type, text, text, jsonb
) from public, anon, authenticated;

create function private.record_delivery_event(
  p_event_type public.delivery_event_type,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_existing public.delivery_events%rowtype;
  v_item jsonb;
  v_invoice public.invoices%rowtype;
  v_document_name text;
  v_result jsonb;
  v_recorded_at timestamptz;
begin
  if p_event_type <> 'portal_result'
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ? 'items')
     or jsonb_typeof(p_payload->'items') <> 'array'
     or jsonb_array_length(p_payload->'items') <> 1 then
    return private.record_delivery_event_without_evidence_resolution(
      p_event_type, p_idempotency_key, p_request_fingerprint, p_payload
    );
  end if;
  v_item := p_payload->'items'->0;
  if jsonb_typeof(v_item) <> 'object'
     or (v_item ? 'supersedesPortalReference')
     or v_item->>'portalStatus' <> 'accepted' then
    return private.record_delivery_event_without_evidence_resolution(
      p_event_type, p_idempotency_key, p_request_fingerprint, p_payload
    );
  end if;

  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$'
     or exists (select 1 from jsonb_object_keys(p_payload) as key where key <> 'items')
     or not (v_item ?& array['invoiceNumber', 'portalReference', 'portalStatus'])
     or exists (select 1 from jsonb_object_keys(v_item) as key
                where key not in ('invoiceNumber', 'portalReference', 'portalStatus'))
     or (v_item->>'invoiceNumber') !~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
     or coalesce(v_item->>'portalReference', '') = ''
     or char_length(v_item->>'portalReference') > 120 then
    raise exception using errcode = '22023', message = 'Invalid evidence-resolution result';
  end if;

  select profile.organization_id into v_organization_id
  from public.profiles as profile
  where profile.user_id = v_user_id and profile.role in ('admin', 'operator');
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Operator access required';
  end if;

  select event.* into v_existing
  from public.delivery_events as event
  where event.organization_id = v_organization_id
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key reused with different payload';
    end if;
    return v_existing.result;
  end if;

  select invoice.* into v_invoice
  from public.invoices as invoice
  where invoice.organization_id = v_organization_id
    and invoice.invoice_number = v_item->>'invoiceNumber'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Invoice not found';
  end if;

  if v_invoice.status not in ('needs_attention', 'rejected')
     or v_invoice.portal_status is distinct from 'disputed'
     or v_invoice.portal_reference is distinct from (v_item->>'portalReference')
     or v_invoice.exception_code is distinct from 'missing_delivery_proof' then
    return private.record_delivery_event_without_evidence_resolution(
      p_event_type, p_idempotency_key, p_request_fingerprint, p_payload
    );
  end if;

  select document.file_name into v_document_name
  from public.invoice_supporting_documents as document
  where document.organization_id = v_organization_id
    and document.invoice_id = v_invoice.id
    and document.document_kind = 'proof_of_delivery'
  order by document.created_at desc, document.id desc
  limit 1;
  if v_document_name is null then
    raise exception using errcode = '23514', message = 'Verified proof of delivery is missing';
  end if;

  v_recorded_at := statement_timestamp();
  update public.invoices
  set status = 'accepted',
      portal_status = 'accepted',
      exception_code = null,
      exception_message = null,
      last_portal_checked_at = v_recorded_at,
      version = version + 1,
      updated_at = v_recorded_at
  where id = v_invoice.id;

  v_result := jsonb_build_object(
    'eventType', p_event_type,
    'items', jsonb_build_array(jsonb_build_object(
      'invoiceNumber', v_invoice.invoice_number,
      'recorded', true
    )),
    'recordedAt', v_recorded_at
  );
  insert into public.delivery_events (
    organization_id, customer_id, event_type, idempotency_key,
    request_fingerprint, payload, result, actor_user_id, created_at
  ) values (
    v_organization_id, v_invoice.customer_id, p_event_type, p_idempotency_key,
    p_request_fingerprint, p_payload, v_result, v_user_id, v_recorded_at
  );
  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id,
    details, created_at
  ) values (
    v_organization_id, v_user_id, 'portal_exception_resolved', 'invoice',
    v_invoice.id::text,
    jsonb_build_object(
      'invoiceNumber', v_invoice.invoice_number,
      'portalReference', v_invoice.portal_reference,
      'exceptionCode', v_invoice.exception_code,
      'documentName', v_document_name,
      'resolution', 'proof_of_delivery_attached',
      'invoiceStatus', 'accepted'
    ),
    v_recorded_at
  );
  return v_result;
end;
$$;

revoke execute on function private.record_delivery_event(
  public.delivery_event_type, text, text, jsonb
) from public, anon;
grant execute on function private.record_delivery_event(
  public.delivery_event_type, text, text, jsonb
) to authenticated;

commit;
