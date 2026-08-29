begin;

create function private.replace_rejected_invoice(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoice jsonb
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
  v_request public.invoice_replacement_requests%rowtype;
  v_original public.invoice_submissions%rowtype;
  v_original_po public.purchase_orders%rowtype;
  v_replacement_po public.purchase_orders%rowtype;
  v_requirements public.submission_requirements%rowtype;
  v_batch public.submission_batches%rowtype;
  v_replacement_id uuid := extensions.gen_random_uuid();
  v_amount_minor bigint;
  v_document_bytes bytea;
  v_document_sha256 text;
  v_reference text;
  v_result jsonb;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'Authentication required'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128
     or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid idempotency contract';
  end if;

  select profile.supplier_id, supplier.buyer_id into v_supplier_id, v_buyer_id
  from public.profiles as profile
  join public.suppliers as supplier on supplier.id = profile.supplier_id
  where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then raise exception using errcode = '42501', message = 'Submitter access required'; end if;

  select request.* into v_request
  from public.invoice_replacement_requests as request
  where request.supplier_id = v_supplier_id and request.idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key reused with different payload';
    end if;
    if v_request.result is null then
      raise exception using errcode = '40001', message = 'Replacement is still being processed';
    end if;
    return v_request.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_supplier_id::text || ':invoice-replacement', 0));

  select submission.* into v_original
  from public.invoice_submissions as submission
  where submission.supplier_id = v_supplier_id
    and submission.invoice_number = p_invoice->>'invoiceNumber'
    and submission.is_current
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Current invoice submission not found'; end if;
  if v_original.status not in ('rejected', 'disputed') then
    raise exception using errcode = '23514', message = 'Only rejected or disputed invoices can be replaced';
  end if;
  if not exists (
    select 1 from public.invoice_exceptions as exception
    where exception.invoice_submission_id = v_original.id and exception.status in ('open', 'responded')
      and 'replace_invoice' = any(exception.allowed_actions)
  ) then
    raise exception using errcode = '23514', message = 'Portal has not authorized invoice replacement';
  end if;
  if exists (select 1 from public.payment_settlements as settlement where settlement.invoice_submission_id = v_original.id) then
    raise exception using errcode = '23514', message = 'An invoice with a payment schedule cannot be replaced';
  end if;

  begin
    v_amount_minor := (p_invoice->>'amountMinor')::bigint;
  exception when others then
    raise exception using errcode = '22023', message = 'Invalid replacement amount';
  end;
  if (p_invoice->>'invoiceNumber') !~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
     or (p_invoice->>'invoiceDate')::date is null
     or v_amount_minor <= 0
     or (p_invoice->>'currency') !~ '^[A-Z]{3}$'
     or (p_invoice->>'purchaseOrderNumber') !~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
     or (p_invoice->'document'->>'fileName') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
     or p_invoice->'document'->>'mediaType' <> 'application/pdf'
     or (p_invoice->'document'->>'sha256') !~ '^[a-f0-9]{64}$'
     or octet_length(p_invoice->'document'->>'contentBase64') > 1400000 then
    raise exception using errcode = '22023', message = 'Replacement invoice fields are invalid';
  end if;

  begin v_document_bytes := decode(p_invoice->'document'->>'contentBase64', 'base64');
  exception when others then raise exception using errcode = '22023', message = 'Document is not valid base64'; end;
  select requirements.* into strict v_requirements
  from public.submission_requirements as requirements where requirements.buyer_id = v_buyer_id;
  v_document_sha256 := encode(extensions.digest(v_document_bytes, 'sha256'), 'hex');
  if octet_length(v_document_bytes) > v_requirements.max_document_bytes
     or octet_length(v_document_bytes) < 5
     or substring(v_document_bytes from 1 for 5) <> convert_to('%PDF-', 'UTF8')
     or position(convert_to('%%EOF', 'UTF8') in substring(v_document_bytes from greatest(1, octet_length(v_document_bytes) - 1023))) = 0
     or v_document_sha256 <> p_invoice->'document'->>'sha256' then
    raise exception using errcode = '22023', message = 'Replacement document is not a valid permitted PDF';
  end if;

  select purchase_order.* into strict v_original_po
  from public.purchase_orders as purchase_order where purchase_order.id = v_original.purchase_order_id
  for update;
  select purchase_order.* into v_replacement_po
  from public.purchase_orders as purchase_order
  where purchase_order.supplier_id = v_supplier_id
    and purchase_order.purchase_order_number = p_invoice->>'purchaseOrderNumber'
  for update;
  if not found or v_replacement_po.status <> 'open' then
    raise exception using errcode = '23514', message = 'Replacement purchase order is not open for this supplier';
  end if;
  if v_replacement_po.currency <> p_invoice->>'currency' then
    raise exception using errcode = '23514', message = 'Replacement currency does not match purchase order';
  end if;
  if (case when v_replacement_po.id = v_original_po.id
      then v_replacement_po.remaining_amount_minor + v_original.amount_minor
      else v_replacement_po.remaining_amount_minor end) < v_amount_minor then
    raise exception using errcode = '23514', message = 'Replacement exceeds purchase order balance';
  end if;

  insert into public.invoice_replacement_requests (
    buyer_id, supplier_id, original_submission_id, idempotency_key,
    request_fingerprint, actor_user_id
  ) values (
    v_buyer_id, v_supplier_id, v_original.id, p_idempotency_key,
    p_request_fingerprint, v_user_id
  ) returning * into v_request;

  insert into public.submission_batches (
    buyer_id, supplier_id, idempotency_key, request_fingerprint, actor_user_id
  ) values (
    v_buyer_id, v_supplier_id, p_idempotency_key, p_request_fingerprint, v_user_id
  ) returning * into v_batch;

  if v_replacement_po.id = v_original_po.id then
    update public.purchase_orders
    set remaining_amount_minor = remaining_amount_minor + v_original.amount_minor - v_amount_minor,
        version = version + 1, updated_at = statement_timestamp()
    where id = v_original_po.id;
  else
    update public.purchase_orders
    set remaining_amount_minor = remaining_amount_minor + v_original.amount_minor,
        version = version + 1, updated_at = statement_timestamp()
    where id = v_original_po.id;
    update public.purchase_orders
    set remaining_amount_minor = remaining_amount_minor - v_amount_minor,
        version = version + 1, updated_at = statement_timestamp()
    where id = v_replacement_po.id;
  end if;

  update public.invoice_submissions
  set is_current = false, status = 'voided', updated_at = statement_timestamp()
  where id = v_original.id;

  v_reference := 'ACME-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.invoice_submissions (
    id, batch_id, buyer_id, supplier_id, purchase_order_id, portal_reference,
    invoice_number, invoice_date, amount_minor, currency, document_name,
    document_media_type, document_sha256, document_size_bytes, revision,
    supersedes_submission_id, is_current
  ) values (
    v_replacement_id, v_batch.id, v_buyer_id, v_supplier_id, v_replacement_po.id, v_reference,
    v_original.invoice_number, (p_invoice->>'invoiceDate')::date, v_amount_minor,
    p_invoice->>'currency', p_invoice->'document'->>'fileName',
    'application/pdf', v_document_sha256, octet_length(v_document_bytes),
    v_original.revision + 1, v_original.id, true
  );

  update public.invoice_exceptions
  set status = 'resolved', resolved_at = statement_timestamp(), updated_at = statement_timestamp()
  where invoice_submission_id = v_original.id and status in ('open', 'responded');
  insert into public.invoice_status_events (
    buyer_id, supplier_id, invoice_submission_id, status, event_code, message, actor_kind
  ) values (
    v_buyer_id, v_supplier_id, v_original.id, 'voided', 'invoice_replaced',
    'Invoice was superseded by revision ' || (v_original.revision + 1) || '.', 'supplier'
  );

  v_result := jsonb_build_object(
    'invoiceNumber', v_original.invoice_number,
    'revision', v_original.revision + 1,
    'portalReference', v_reference,
    'portalStatus', 'received',
    'supersededPortalReference', v_original.portal_reference,
    'purchaseOrderNumber', v_replacement_po.purchase_order_number,
    'remainingAmountMinor', (case when v_replacement_po.id = v_original_po.id
      then v_replacement_po.remaining_amount_minor + v_original.amount_minor - v_amount_minor
      else v_replacement_po.remaining_amount_minor - v_amount_minor end),
    'currency', v_replacement_po.currency,
    'submittedAt', statement_timestamp()
  );
  update public.invoice_replacement_requests
  set replacement_submission_id = v_replacement_id, result = v_result where id = v_request.id;
  update public.submission_batches set response = jsonb_build_object(
    'batchId', v_batch.id, 'items', jsonb_build_array(v_result), 'submittedAt', statement_timestamp()
  ) where id = v_batch.id;
  insert into public.audit_events (
    buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_buyer_id, v_supplier_id, v_user_id, 'rejected_invoice_replaced',
    'invoice_submission', v_replacement_id::text,
    jsonb_build_object('invoiceNumber', v_original.invoice_number, 'revision', v_original.revision + 1, 'supersedes', v_original.id)
  );
  return v_result;
end;
$$;

revoke execute on function private.replace_rejected_invoice(text, text, jsonb) from public, anon;
grant execute on function private.replace_rejected_invoice(text, text, jsonb) to authenticated;

create function public.replace_rejected_invoice(text, text, jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.replace_rejected_invoice($1, $2, $3) $$;

revoke execute on function public.replace_rejected_invoice(text, text, jsonb) from public, anon;
grant execute on function public.replace_rejected_invoice(text, text, jsonb) to authenticated;

commit;
