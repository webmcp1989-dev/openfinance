begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);
select plan(14);

set local role authenticated;
select public.reset_demo_state();
reset role;

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.submission_requirements'::regclass
      and conname = 'submission_requirements_web_contract'
  ),
  'submission policy has one database-enforced WebMCP contract'
);

select throws_ok(
  $$
    update public.submission_requirements
    set max_document_bytes = 1048577
  $$,
  '23514',
  'new row for relation "submission_requirements" violates check constraint "submission_requirements_web_contract"',
  'submission policy cannot advertise files larger than the WebMCP contract'
);

select throws_ok(
  $$
    update public.submission_requirements
    set accepted_media_types = array['image/png']
  $$,
  '23514',
  'new row for relation "submission_requirements" violates check constraint "submission_requirements_web_contract"',
  'submission policy cannot advertise an unsupported media type'
);

select throws_ok(
  $$
    update public.submission_requirements
    set enforce_remaining_balance = false
  $$,
  '23514',
  'new row for relation "submission_requirements" violates check constraint "submission_requirements_web_contract"',
  'submission policy cannot disable an invariant enforced by the transaction'
);

set local role authenticated;

create function pg_temp.structural_pdf()
returns bytea
language plpgsql
immutable
as $$
declare
  v_prefix text := E'%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n';
begin
  return convert_to(v_prefix || E'xref\n0 4\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n' || octet_length(convert_to(v_prefix, 'UTF8')) || E'\n%%EOF\n', 'UTF8');
end;
$$;

create function pg_temp.submit_invoice_batch(p_key text, p_fingerprint text, p_invoices jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_preview jsonb;
  v_approval jsonb;
begin
  select jsonb_build_object(
    'action', 'submit_invoice_batch',
    'invoices', coalesce(jsonb_agg(jsonb_build_object(
      'invoiceNumber', item.value->'invoiceNumber',
      'invoiceDate', item.value->'invoiceDate',
      'amountMinor', item.value->'amountMinor',
      'currency', item.value->'currency',
      'purchaseOrderNumber', item.value->'purchaseOrderNumber',
      'document', jsonb_build_object(
        'fileName', item.value->'document'->'fileName',
        'mediaType', item.value->'document'->'mediaType',
        'sha256', item.value->'document'->'sha256'
      )
    ) order by item.ordinality), '[]'::jsonb)
  ) into v_preview
  from jsonb_array_elements(p_invoices) with ordinality as item(value, ordinality);
  v_approval := public.request_document_submission_approval(
    'submit_invoice_batch', p_key, repeat('0', 64), v_preview, 'human'
  );
  perform public.decide_document_submission_approval((v_approval->>'approvalId')::uuid, 'approved');
  return public.submit_invoice_batch(p_key, p_fingerprint, p_invoices, (v_approval->>'approvalId')::uuid);
end;
$$;

select is(
  (select prosecdef from pg_proc where oid = 'public.submit_invoice_batch(text,text,jsonb)'::regprocedure),
  false,
  'submission wrapper remains security invoker'
);

select ok(
  pg_get_functiondef('public.submit_invoice_batch(text,text,jsonb)'::regprocedure)
    like '%pg_advisory_xact_lock%',
  'submission wrapper serializes retries for one supplier idempotency key'
);

select throws_ok(
  $$
    select pg_temp.submit_invoice_batch(
      'duplicate-batch-test-20260829',
      repeat('a', 64),
      '[{"invoiceNumber":"INV-DUP-01"},{"invoiceNumber":"INV-DUP-01"}]'::jsonb
    )
  $$,
  '22023',
  'Invoice numbers must be unique',
  'database rejects duplicate invoice numbers before submission processing'
);

select throws_ok(
  $$
    select pg_temp.submit_invoice_batch(
      'extra-field-test-20260829',
      repeat('e', 64),
      jsonb_build_array(jsonb_build_object(
        'invoiceNumber', 'INV-EXTRA-01',
        'invoiceDate', '2026-08-29',
        'amountMinor', 1000,
        'currency', 'USD',
        'purchaseOrderNumber', 'PO-8821',
        'supplierId', 'caller-controlled',
        'document', jsonb_build_object(
          'fileName', 'INV-EXTRA-01.pdf',
          'mediaType', 'application/pdf',
          'contentBase64', encode(convert_to('%PDF-extra-test', 'UTF8'), 'base64'),
          'sha256', encode(extensions.digest(convert_to('%PDF-extra-test', 'UTF8'), 'sha256'), 'hex')
        )
      ))
    )
  $$,
  '22023',
  'Invalid invoice fields',
  'database rejects additional caller-controlled invoice fields'
);

select throws_ok(
  $$
    select pg_temp.submit_invoice_batch(
      'noncanonical-test-20260829',
      repeat('d', 64),
      jsonb_build_array(jsonb_build_object(
        'invoiceNumber', 'INV-NONCANONICAL-01',
        'invoiceDate', '2026-08-29',
        'amountMinor', 1000,
        'currency', 'USD',
        'purchaseOrderNumber', 'PO-8821',
        'document', jsonb_build_object(
          'fileName', 'INV-NONCANONICAL-01.pdf',
          'mediaType', 'application/pdf',
          'contentBase64', rtrim(encode(convert_to('%PDF-noncanonical-test', 'UTF8'), 'base64'), '='),
          'sha256', encode(extensions.digest(convert_to('%PDF-noncanonical-test', 'UTF8'), 'sha256'), 'hex')
        )
      ))
    )
  $$,
  '22023',
  'Document is not valid base64',
  'database rejects an alternate base64 representation of the same PDF'
);

select throws_ok(
  $$
    select pg_temp.submit_invoice_batch(
      'missing-eof-test-20260829',
      repeat('c', 64),
      jsonb_build_array(jsonb_build_object(
        'invoiceNumber', 'INV-MISSING-EOF-01',
        'invoiceDate', '2026-08-29',
        'amountMinor', 1000,
        'currency', 'USD',
        'purchaseOrderNumber', 'PO-8821',
        'document', jsonb_build_object(
          'fileName', 'INV-MISSING-EOF-01.pdf',
          'mediaType', 'application/pdf',
          'contentBase64', encode(convert_to('%PDF-incomplete', 'UTF8'), 'base64'),
          'sha256', encode(extensions.digest(convert_to('%PDF-incomplete', 'UTF8'), 'sha256'), 'hex')
        )
      ))
    )
  $$,
  '22023',
  'Document is not a valid permitted PDF',
  'database rejects a PDF signature without an end-of-file marker'
);

select throws_ok(
  $$
    select pg_temp.submit_invoice_batch(
      'pseudo-pdf-test-20260830',
      repeat('f', 64),
      jsonb_build_array(jsonb_build_object(
        'invoiceNumber', 'INV-PSEUDO-PDF-01',
        'invoiceDate', '2026-08-30',
        'amountMinor', 1000,
        'currency', 'USD',
        'purchaseOrderNumber', 'PO-8821',
        'document', jsonb_build_object(
          'fileName', 'INV-PSEUDO-PDF-01.pdf',
          'mediaType', 'application/pdf',
          'contentBase64', encode(convert_to(E'%PDF-1.4\nThis is not a PDF object graph.\n%%EOF\n', 'UTF8'), 'base64'),
          'sha256', encode(extensions.digest(convert_to(E'%PDF-1.4\nThis is not a PDF object graph.\n%%EOF\n', 'UTF8'), 'sha256'), 'hex')
        )
      ))
    )
  $$,
  '22023',
  'Document is not a valid permitted PDF',
  'database rejects the header-and-EOF-only pseudo-PDF from the original defect'
);

create temporary table retry_probe (
  response jsonb not null
) on commit drop;

insert into retry_probe (response)
select pg_temp.submit_invoice_batch(
  'matching-retry-test-20260829',
  repeat('b', 64),
  jsonb_build_array(jsonb_build_object(
    'invoiceNumber', 'INV-RETRY-01',
    'invoiceDate', '2026-08-29',
    'amountMinor', 1000,
    'currency', 'USD',
    'purchaseOrderNumber', 'PO-8821',
    'document', jsonb_build_object(
      'fileName', 'INV-RETRY-01.pdf',
      'mediaType', 'application/pdf',
      'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
      'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
    )
  ))
);

select is(
  pg_temp.submit_invoice_batch(
    'matching-retry-test-20260829',
    repeat('b', 64),
    jsonb_build_array(jsonb_build_object(
      'invoiceNumber', 'INV-RETRY-01',
      'invoiceDate', '2026-08-29',
      'amountMinor', 1000,
      'currency', 'USD',
      'purchaseOrderNumber', 'PO-8821',
      'document', jsonb_build_object(
        'fileName', 'INV-RETRY-01.pdf',
        'mediaType', 'application/pdf',
        'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
        'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
      )
    ))
  ),
  (select response from retry_probe),
  'matching retry returns the original immutable response'
);

select is(
  (select remaining_amount_minor from public.purchase_orders where purchase_order_number = 'PO-8821'),
  2399000::bigint,
  'matching retry decrements the purchase order only once'
);

select throws_ok(
  $$
    select pg_temp.submit_invoice_batch(
      'matching-retry-test-20260829',
      repeat('b', 64),
      jsonb_build_array(jsonb_build_object(
        'invoiceNumber', 'INV-RETRY-01',
        'invoiceDate', '2026-08-29',
        'amountMinor', 1001,
        'currency', 'USD',
        'purchaseOrderNumber', 'PO-8821',
        'document', jsonb_build_object(
          'fileName', 'INV-RETRY-01.pdf',
          'mediaType', 'application/pdf',
          'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
          'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
        )
      ))
    )
  $$,
  '23505',
  'Idempotency key reused with different payload',
  'changed-payload retry is rejected'
);

select * from finish();
rollback;
