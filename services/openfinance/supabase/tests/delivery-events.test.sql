begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

insert into public.invoices (
  organization_id, customer_id, invoice_number, invoice_date, amount_minor,
  currency, purchase_order_number, status, document_name, document_media_type,
  document_content_base64, document_sha256
) values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'TEST-STATE-01', current_date, 10000, 'USD', 'PO-TEST-01', 'ready',
  'test-state-01.pdf', 'application/pdf', 'JVBERi0xLjQK', repeat('a', 64)
);

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'demo@openfinance.dev'),
  true
);
set local role authenticated;

select plan(7);

select is(
  (select prosecdef from pg_proc where oid = 'public.record_delivery_event(public.delivery_event_type,text,text,jsonb)'::regprocedure),
  false,
  'delivery-event wrapper remains security invoker'
);

select throws_ok(
  $$
    select public.record_delivery_event(
      'portal_result',
      'duplicate-test-20260829',
      repeat('a', 64),
      '{"items":[{"invoiceNumber":"TEST-STATE-01"},{"invoiceNumber":"TEST-STATE-01"}]}'::jsonb
    )
  $$,
  '22023',
  'Invoice numbers must be unique',
  'duplicate invoice numbers are rejected before event processing'
);

select throws_ok(
  $$
    select public.record_delivery_event(
      'portal_result',
      'invalid-status-test-20260829',
      repeat('b', 64),
      '{"items":[{"invoiceNumber":"TEST-STATE-01","portalReference":"ACME-TEST","portalStatus":"invented"}]}'::jsonb
    )
  $$,
  '22023',
  'Invalid portal result fields',
  'database rejects a portal status that bypasses the HTTP schema'
);

select throws_ok(
  $$
    select public.record_delivery_event(
      'portal_exception',
      'invalid-code-test-20260829',
      repeat('c', 64),
      '{"items":[{"invoiceNumber":"TEST-STATE-01","exceptionCode":"BAD CODE","message":"Invalid code"}]}'::jsonb
    )
  $$,
  '22023',
  'Invalid portal exception fields',
  'database rejects an invalid exception code that bypasses the HTTP schema'
);

select lives_ok(
  $$
    select public.record_delivery_event(
      'portal_exception',
      'valid-exception-test-20260829',
      repeat('d', 64),
      '{"items":[{"invoiceNumber":"TEST-STATE-01","exceptionCode":"po_balance","message":"PO balance is insufficient."}]}'::jsonb
    )
  $$,
  'a valid exception is recorded for a ready invoice'
);

select is(
  (select status::text from public.invoices where invoice_number = 'TEST-STATE-01'),
  'needs_attention',
  'the valid exception moves the invoice to needs attention'
);

select throws_ok(
  $$
    select public.record_delivery_event(
      'portal_result',
      'invalid-transition-test-20260829',
      repeat('e', 64),
      '{"items":[{"invoiceNumber":"TEST-STATE-01","portalReference":"ACME-TEST","portalStatus":"received"}]}'::jsonb
    )
  $$,
  '23514',
  'Invoice state does not allow a portal result',
  'a needs-attention invoice cannot be marked submitted by a direct RPC call'
);

select * from finish();
rollback;
