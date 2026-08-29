begin;

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
  if v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Supplier access required';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Invalid idempotency key';
  end if;

  if p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid request fingerprint';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_supplier_id::text || ':' || p_idempotency_key, 0)
  );

  if pg_catalog.jsonb_typeof(p_invoices) <> 'array'
     or pg_catalog.jsonb_array_length(p_invoices) not between 1 and 3 then
    raise exception using errcode = '22023', message = 'invoices must contain between 1 and 3 entries';
  end if;

  select count(*), count(distinct value->>'invoiceNumber')
  into v_item_count, v_distinct_invoice_count
  from pg_catalog.jsonb_array_elements(p_invoices);

  if v_item_count <> v_distinct_invoice_count then
    raise exception using errcode = '22023', message = 'Invoice numbers must be unique';
  end if;

  for v_invoice in select value from pg_catalog.jsonb_array_elements(p_invoices)
  loop
    if pg_catalog.jsonb_typeof(v_invoice) <> 'object'
       or not (v_invoice ?& array[
         'invoiceNumber', 'invoiceDate', 'amountMinor', 'currency',
         'purchaseOrderNumber', 'document'
       ])
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(v_invoice) as key
         where key <> all(array[
           'invoiceNumber', 'invoiceDate', 'amountMinor', 'currency',
           'purchaseOrderNumber', 'document'
         ])
       )
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

    begin
      perform (v_invoice->>'invoiceDate')::date;
      v_amount_minor := (v_invoice->>'amountMinor')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'Invalid invoice fields';
    end;

    if v_amount_minor <= 0 or v_amount_minor > 9007199254740991 then
      raise exception using errcode = '22023', message = 'Invalid invoice fields';
    end if;

    v_document := v_invoice->'document';
    if not (v_document ?& array['fileName', 'mediaType', 'contentBase64', 'sha256'])
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(v_document) as key
         where key <> all(array['fileName', 'mediaType', 'contentBase64', 'sha256'])
       )
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

    begin
      v_document_bytes := pg_catalog.decode(v_document->>'contentBase64', 'base64');
    exception when others then
      raise exception using errcode = '22023', message = 'Document is not valid base64';
    end;

    if pg_catalog.replace(
         pg_catalog.encode(v_document_bytes, 'base64'),
         pg_catalog.chr(10),
         ''
       ) <> v_document->>'contentBase64' then
      raise exception using errcode = '22023', message = 'Document is not canonical base64';
    end if;

    if pg_catalog.octet_length(v_document_bytes) > 1048576
       or pg_catalog.octet_length(v_document_bytes) < 10
       or pg_catalog.substr(v_document_bytes, 1, 5) <> pg_catalog.convert_to('%PDF-', 'UTF8')
       or position(
         pg_catalog.convert_to('%%EOF', 'UTF8') in
         case
           when pg_catalog.octet_length(v_document_bytes) > 1024 then
             pg_catalog.substr(
               v_document_bytes,
               pg_catalog.octet_length(v_document_bytes) - 1023
             )
           else v_document_bytes
         end
       ) = 0 then
      raise exception using errcode = '22023', message = 'Document is not a valid permitted PDF';
    end if;

    if pg_catalog.encode(extensions.digest(v_document_bytes, 'sha256'), 'hex')
       <> v_document->>'sha256' then
      raise exception using errcode = '22023', message = 'Document checksum mismatch';
    end if;
  end loop;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_invoices::text, 'UTF8'), 'sha256'),
    'hex'
  );

  return private.submit_invoice_batch(
    p_idempotency_key,
    v_request_fingerprint,
    p_invoices
  );
end;
$$;

revoke execute on function public.submit_invoice_batch(text, text, jsonb) from public, anon;
grant execute on function public.submit_invoice_batch(text, text, jsonb) to authenticated;

commit;
