begin;

-- OpenFinance documents use a bounded, classic PDF 1.x profile. This is not a
-- general-purpose PDF parser; it rejects the former header-and-EOF placeholders
-- while remaining deterministic and safe to use from database constraints.
create or replace function private.is_structurally_valid_pdf(p_bytes bytea)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_hex text;
  v_text text;
  v_match text[];
  v_offset integer;
begin
  -- Latin-1 preserves byte positions for the ASCII structural tokens. Replace
  -- NUL first because PostgreSQL text cannot contain it, while allowing the
  -- remainder of a legitimate binary PDF stream to be inspected safely.
  v_text := pg_catalog.convert_from(
    pg_catalog.replace(p_bytes, pg_catalog.decode('00', 'hex'), pg_catalog.convert_to(' ', 'UTF8')),
    'LATIN1'
  );
  if pg_catalog.octet_length(p_bytes) < 10
     or pg_catalog.substr(p_bytes, 1, 5) <> pg_catalog.convert_to('%PDF-', 'UTF8')
     or v_text !~ '/Type[[:space:]]*/Catalog([^[:alnum:]_]|$)'
     or v_text !~ '/Type[[:space:]]*/Page([^[:alnum:]_]|$)' then
    return false;
  end if;

  v_hex := pg_catalog.encode(p_bytes, 'hex');
  -- The terminal `startxref <decimal> %%EOF` footer is matched as hex so this
  -- check never assumes the rest of the binary document is valid text.
  v_match := pg_catalog.regexp_match(
    v_hex,
    '737461727478726566(?:09|0a|0c|0d|20)+((?:3[0-9]){1,7})(?:09|0a|0c|0d|20)+2525454f46(?:09|0a|0c|0d|20)*$'
  );
  if v_match is null then return false; end if;

  v_offset := pg_catalog.convert_from(pg_catalog.decode(v_match[1], 'hex'), 'UTF8')::integer;
  return v_offset >= 0
    and v_offset + 4 <= pg_catalog.octet_length(p_bytes)
    and pg_catalog.substr(p_bytes, v_offset + 1, 4) = pg_catalog.convert_to('xref', 'UTF8');
end;
$$;

create or replace function private.is_canonical_structural_pdf(
  p_content_base64 text,
  p_max_bytes integer
)
returns boolean
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  v_bytes bytea;
begin
  begin
    v_bytes := pg_catalog.decode(p_content_base64, 'base64');
  exception when others then
    return false;
  end;

  return pg_catalog.octet_length(v_bytes) <= p_max_bytes
    and pg_catalog.replace(pg_catalog.encode(v_bytes, 'base64'), pg_catalog.chr(10), '') = p_content_base64
    and private.is_structurally_valid_pdf(v_bytes);
end;
$$;

revoke execute on function private.is_structurally_valid_pdf(bytea) from public, anon;
revoke execute on function private.is_canonical_structural_pdf(text, integer) from public, anon;
grant execute on function private.is_structurally_valid_pdf(bytea) to authenticated;
grant execute on function private.is_canonical_structural_pdf(text, integer) to authenticated;

create or replace function public.submit_invoice_batch(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoices jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_supplier_id uuid;
  v_item_count integer;
  v_distinct_invoice_count integer;
  v_invoice jsonb;
  v_document jsonb;
  v_document_bytes bytea;
  v_amount_minor bigint;
  v_request_fingerprint text;
begin
  v_supplier_id := private.current_supplier_id();
  if v_supplier_id is null then raise exception using errcode = '42501', message = 'Supplier access required'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Invalid idempotency key';
  end if;
  if p_request_fingerprint !~ '^[a-f0-9]{64}$' then raise exception using errcode = '22023', message = 'Invalid request fingerprint'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_supplier_id::text || ':' || p_idempotency_key, 0));
  if pg_catalog.jsonb_typeof(p_invoices) <> 'array' or pg_catalog.jsonb_array_length(p_invoices) not between 1 and 3 then
    raise exception using errcode = '22023', message = 'invoices must contain between 1 and 3 entries';
  end if;
  select count(*), count(distinct value->>'invoiceNumber') into v_item_count, v_distinct_invoice_count
  from pg_catalog.jsonb_array_elements(p_invoices);
  if v_item_count <> v_distinct_invoice_count then raise exception using errcode = '22023', message = 'Invoice numbers must be unique'; end if;

  for v_invoice in select value from pg_catalog.jsonb_array_elements(p_invoices)
  loop
    if pg_catalog.jsonb_typeof(v_invoice) <> 'object'
       or not (v_invoice ?& array['invoiceNumber', 'invoiceDate', 'amountMinor', 'currency', 'purchaseOrderNumber', 'document'])
       or exists (select 1 from pg_catalog.jsonb_object_keys(v_invoice) as key where key <> all(array['invoiceNumber', 'invoiceDate', 'amountMinor', 'currency', 'purchaseOrderNumber', 'document']))
       or pg_catalog.jsonb_typeof(v_invoice->'invoiceNumber') <> 'string'
       or pg_catalog.jsonb_typeof(v_invoice->'invoiceDate') <> 'string'
       or pg_catalog.jsonb_typeof(v_invoice->'amountMinor') <> 'number'
       or pg_catalog.jsonb_typeof(v_invoice->'currency') <> 'string'
       or pg_catalog.jsonb_typeof(v_invoice->'purchaseOrderNumber') <> 'string'
       or pg_catalog.jsonb_typeof(v_invoice->'document') <> 'object'
       or (v_invoice->>'invoiceNumber') !~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
       or (v_invoice->>'invoiceDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (v_invoice->>'amountMinor') !~ '^[0-9]+$'
       or (v_invoice->>'currency') !~ '^[A-Z]{3}$'
       or (v_invoice->>'purchaseOrderNumber') !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
      raise exception using errcode = '22023', message = 'Invalid invoice fields';
    end if;
    begin perform (v_invoice->>'invoiceDate')::date; v_amount_minor := (v_invoice->>'amountMinor')::bigint;
    exception when others then raise exception using errcode = '22023', message = 'Invalid invoice fields'; end;
    if v_amount_minor <= 0 or v_amount_minor > 9007199254740991 then raise exception using errcode = '22023', message = 'Invalid invoice fields'; end if;

    v_document := v_invoice->'document';
    if not (v_document ?& array['fileName', 'mediaType', 'contentBase64', 'sha256'])
       or exists (select 1 from pg_catalog.jsonb_object_keys(v_document) as key where key <> all(array['fileName', 'mediaType', 'contentBase64', 'sha256']))
       or pg_catalog.jsonb_typeof(v_document->'fileName') <> 'string'
       or pg_catalog.jsonb_typeof(v_document->'mediaType') <> 'string'
       or pg_catalog.jsonb_typeof(v_document->'contentBase64') <> 'string'
       or pg_catalog.jsonb_typeof(v_document->'sha256') <> 'string'
       or (v_document->>'fileName') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
       or v_document->>'mediaType' <> 'application/pdf'
       or char_length(v_document->>'contentBase64') not between 8 and 1400000
       or (v_document->>'contentBase64') !~ '^[A-Za-z0-9+/]+={0,2}$'
       or (v_document->>'sha256') !~ '^[a-f0-9]{64}$' then
      raise exception using errcode = '22023', message = 'Invalid document fields';
    end if;
    begin v_document_bytes := pg_catalog.decode(v_document->>'contentBase64', 'base64');
    exception when others then raise exception using errcode = '22023', message = 'Document is not valid base64'; end;
    if pg_catalog.replace(pg_catalog.encode(v_document_bytes, 'base64'), pg_catalog.chr(10), '') <> v_document->>'contentBase64' then
      raise exception using errcode = '22023', message = 'Document is not canonical base64';
    end if;
    if not private.is_canonical_structural_pdf(v_document->>'contentBase64', 1048576) then
      raise exception using errcode = '22023', message = 'Document is not a valid permitted PDF';
    end if;
    if pg_catalog.encode(extensions.digest(v_document_bytes, 'sha256'), 'hex') <> v_document->>'sha256' then
      raise exception using errcode = '22023', message = 'Document checksum mismatch';
    end if;
  end loop;

  v_request_fingerprint := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_invoices::text, 'UTF8'), 'sha256'), 'hex');
  return private.submit_invoice_batch(p_idempotency_key, v_request_fingerprint, p_invoices);
end;
$$;

revoke execute on function public.submit_invoice_batch(text, text, jsonb) from public, anon;
grant execute on function public.submit_invoice_batch(text, text, jsonb) to authenticated;

create or replace function private.replace_rejected_invoice(
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
  v_user_id uuid := auth.uid(); v_supplier_id uuid; v_buyer_id uuid;
  v_request public.invoice_replacement_requests%rowtype; v_original public.invoice_submissions%rowtype;
  v_original_po public.purchase_orders%rowtype; v_replacement_po public.purchase_orders%rowtype;
  v_requirements public.submission_requirements%rowtype; v_batch public.submission_batches%rowtype;
  v_replacement_id uuid := extensions.gen_random_uuid(); v_amount_minor bigint; v_document_bytes bytea;
  v_document_sha256 text; v_reference text; v_result jsonb;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'Authentication required'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 or p_request_fingerprint !~ '^[a-f0-9]{64}$' then raise exception using errcode = '22023', message = 'Invalid idempotency contract'; end if;
  select profile.supplier_id, supplier.buyer_id into v_supplier_id, v_buyer_id from public.profiles as profile join public.suppliers as supplier on supplier.id = profile.supplier_id where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then raise exception using errcode = '42501', message = 'Submitter access required'; end if;
  select request.* into v_request from public.invoice_replacement_requests as request where request.supplier_id = v_supplier_id and request.idempotency_key = p_idempotency_key;
  if found then
    if v_request.request_fingerprint <> p_request_fingerprint then raise exception using errcode = '23505', message = 'Idempotency key reused with different payload'; end if;
    if v_request.result is null then raise exception using errcode = '40001', message = 'Replacement is still being processed'; end if;
    return v_request.result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_supplier_id::text || ':invoice-replacement', 0));
  select submission.* into v_original from public.invoice_submissions as submission where submission.supplier_id = v_supplier_id and submission.invoice_number = p_invoice->>'invoiceNumber' and submission.is_current for update;
  if not found then raise exception using errcode = 'P0002', message = 'Current invoice submission not found'; end if;
  if v_original.status not in ('rejected', 'disputed') then raise exception using errcode = '23514', message = 'Only rejected or disputed invoices can be replaced'; end if;
  if not exists (select 1 from public.invoice_exceptions as exception where exception.invoice_submission_id = v_original.id and exception.status in ('open', 'responded') and 'replace_invoice' = any(exception.allowed_actions)) then raise exception using errcode = '23514', message = 'Portal has not authorized invoice replacement'; end if;
  if exists (select 1 from public.payment_settlements as settlement where settlement.invoice_submission_id = v_original.id) then raise exception using errcode = '23514', message = 'An invoice with a payment schedule cannot be replaced'; end if;
  begin v_amount_minor := (p_invoice->>'amountMinor')::bigint; exception when others then raise exception using errcode = '22023', message = 'Invalid replacement amount'; end;
  if (p_invoice->>'invoiceNumber') !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' or (p_invoice->>'invoiceDate')::date is null or v_amount_minor <= 0 or (p_invoice->>'currency') !~ '^[A-Z]{3}$' or (p_invoice->>'purchaseOrderNumber') !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' or (p_invoice->'document'->>'fileName') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' or p_invoice->'document'->>'mediaType' <> 'application/pdf' or (p_invoice->'document'->>'sha256') !~ '^[a-f0-9]{64}$' or octet_length(p_invoice->'document'->>'contentBase64') > 1400000 then raise exception using errcode = '22023', message = 'Replacement invoice fields are invalid'; end if;
  begin v_document_bytes := decode(p_invoice->'document'->>'contentBase64', 'base64'); exception when others then raise exception using errcode = '22023', message = 'Document is not valid base64'; end;
  select requirements.* into strict v_requirements from public.submission_requirements as requirements where requirements.buyer_id = v_buyer_id;
  v_document_sha256 := encode(extensions.digest(v_document_bytes, 'sha256'), 'hex');
  if not private.is_canonical_structural_pdf(p_invoice->'document'->>'contentBase64', v_requirements.max_document_bytes) or v_document_sha256 <> p_invoice->'document'->>'sha256' then raise exception using errcode = '22023', message = 'Replacement document is not a valid permitted PDF'; end if;
  select purchase_order.* into strict v_original_po from public.purchase_orders as purchase_order where purchase_order.id = v_original.purchase_order_id for update;
  select purchase_order.* into v_replacement_po from public.purchase_orders as purchase_order where purchase_order.supplier_id = v_supplier_id and purchase_order.purchase_order_number = p_invoice->>'purchaseOrderNumber' for update;
  if not found or v_replacement_po.status <> 'open' then raise exception using errcode = '23514', message = 'Replacement purchase order is not open for this supplier'; end if;
  if v_replacement_po.currency <> p_invoice->>'currency' then raise exception using errcode = '23514', message = 'Replacement currency does not match purchase order'; end if;
  if (case when v_replacement_po.id = v_original_po.id then v_replacement_po.remaining_amount_minor + v_original.amount_minor else v_replacement_po.remaining_amount_minor end) < v_amount_minor then raise exception using errcode = '23514', message = 'Replacement exceeds purchase order balance'; end if;
  insert into public.invoice_replacement_requests (buyer_id, supplier_id, original_submission_id, idempotency_key, request_fingerprint, actor_user_id) values (v_buyer_id, v_supplier_id, v_original.id, p_idempotency_key, p_request_fingerprint, v_user_id) returning * into v_request;
  insert into public.submission_batches (buyer_id, supplier_id, idempotency_key, request_fingerprint, actor_user_id) values (v_buyer_id, v_supplier_id, p_idempotency_key, p_request_fingerprint, v_user_id) returning * into v_batch;
  if v_replacement_po.id = v_original_po.id then update public.purchase_orders set remaining_amount_minor = remaining_amount_minor + v_original.amount_minor - v_amount_minor, version = version + 1, updated_at = statement_timestamp() where id = v_original_po.id;
  else update public.purchase_orders set remaining_amount_minor = remaining_amount_minor + v_original.amount_minor, version = version + 1, updated_at = statement_timestamp() where id = v_original_po.id; update public.purchase_orders set remaining_amount_minor = remaining_amount_minor - v_amount_minor, version = version + 1, updated_at = statement_timestamp() where id = v_replacement_po.id; end if;
  update public.invoice_submissions set is_current = false, status = 'voided', updated_at = statement_timestamp() where id = v_original.id;
  v_reference := 'ACME-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.invoice_submissions (id, batch_id, buyer_id, supplier_id, purchase_order_id, portal_reference, invoice_number, invoice_date, amount_minor, currency, document_name, document_media_type, document_sha256, document_size_bytes, revision, supersedes_submission_id, is_current) values (v_replacement_id, v_batch.id, v_buyer_id, v_supplier_id, v_replacement_po.id, v_reference, v_original.invoice_number, (p_invoice->>'invoiceDate')::date, v_amount_minor, p_invoice->>'currency', p_invoice->'document'->>'fileName', 'application/pdf', v_document_sha256, octet_length(v_document_bytes), v_original.revision + 1, v_original.id, true);
  update public.invoice_exceptions set status = 'resolved', resolved_at = statement_timestamp(), updated_at = statement_timestamp() where invoice_submission_id = v_original.id and status in ('open', 'responded');
  insert into public.invoice_status_events (buyer_id, supplier_id, invoice_submission_id, status, event_code, message, actor_kind) values (v_buyer_id, v_supplier_id, v_original.id, 'voided', 'invoice_replaced', 'Invoice was superseded by revision ' || (v_original.revision + 1) || '.', 'supplier');
  v_result := jsonb_build_object('invoiceNumber', v_original.invoice_number, 'revision', v_original.revision + 1, 'portalReference', v_reference, 'portalStatus', 'received', 'supersededPortalReference', v_original.portal_reference, 'purchaseOrderNumber', v_replacement_po.purchase_order_number, 'remainingAmountMinor', (case when v_replacement_po.id = v_original_po.id then v_replacement_po.remaining_amount_minor + v_original.amount_minor - v_amount_minor else v_replacement_po.remaining_amount_minor - v_amount_minor end), 'currency', v_replacement_po.currency, 'submittedAt', statement_timestamp());
  update public.invoice_replacement_requests set replacement_submission_id = v_replacement_id, result = v_result where id = v_request.id;
  update public.submission_batches set response = jsonb_build_object('batchId', v_batch.id, 'items', jsonb_build_array(v_result), 'submittedAt', statement_timestamp()) where id = v_batch.id;
  insert into public.audit_events (buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id, details) values (v_buyer_id, v_supplier_id, v_user_id, 'rejected_invoice_replaced', 'invoice_submission', v_replacement_id::text, jsonb_build_object('invoiceNumber', v_original.invoice_number, 'revision', v_original.revision + 1, 'supersedes', v_original.id));
  return v_result;
end;
$$;

revoke execute on function private.replace_rejected_invoice(text, text, jsonb) from public, anon;
grant execute on function private.replace_rejected_invoice(text, text, jsonb) to authenticated;

alter table public.invoice_attachments drop constraint invoice_attachments_pdf_structure_check;
alter table public.invoice_attachments add constraint invoice_attachments_pdf_structure_check
  check (private.is_canonical_structural_pdf(content_base64, 1048576));

commit;
