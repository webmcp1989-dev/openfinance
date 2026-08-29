begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);
set local role authenticated;

select plan(6);

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
    select public.submit_invoice_batch(
      'duplicate-batch-test-20260829',
      repeat('a', 64),
      '[{"invoiceNumber":"INV-DUP-01"},{"invoiceNumber":"INV-DUP-01"}]'::jsonb
    )
  $$,
  '22023',
  'Invoice numbers must be unique',
  'database rejects duplicate invoice numbers before submission processing'
);

create temporary table retry_probe (
  response jsonb not null
) on commit drop;

insert into retry_probe (response)
select public.submit_invoice_batch(
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
      'contentBase64', encode(convert_to('%PDF-retry-test', 'UTF8'), 'base64'),
      'sha256', encode(extensions.digest(convert_to('%PDF-retry-test', 'UTF8'), 'sha256'), 'hex')
    )
  ))
);

select is(
  public.submit_invoice_batch(
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
        'contentBase64', encode(convert_to('%PDF-retry-test', 'UTF8'), 'base64'),
        'sha256', encode(extensions.digest(convert_to('%PDF-retry-test', 'UTF8'), 'sha256'), 'hex')
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
    select public.submit_invoice_batch(
      'matching-retry-test-20260829',
      repeat('c', 64),
      jsonb_build_array(jsonb_build_object(
        'invoiceNumber', 'INV-RETRY-01',
        'invoiceDate', '2026-08-29',
        'amountMinor', 1001,
        'currency', 'USD',
        'purchaseOrderNumber', 'PO-8821',
        'document', jsonb_build_object(
          'fileName', 'INV-RETRY-01.pdf',
          'mediaType', 'application/pdf',
          'contentBase64', encode(convert_to('%PDF-retry-test', 'UTF8'), 'base64'),
          'sha256', encode(extensions.digest(convert_to('%PDF-retry-test', 'UTF8'), 'sha256'), 'hex')
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
