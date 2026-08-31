begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);
select has_table('public', 'invoice_supporting_documents', 'supporting documents exist');
select has_table('public', 'payment_remittance_events', 'remittance events exist');
select is((select relrowsecurity from pg_class where oid = 'public.invoice_supporting_documents'::regclass), true, 'supporting documents enforce RLS');
select is((select relrowsecurity from pg_class where oid = 'public.payment_remittance_events'::regclass), true, 'remittance events enforce RLS');
select ok(not has_table_privilege('anon', 'public.invoice_supporting_documents', 'select'), 'anonymous callers cannot read supporting documents');
select ok(not has_table_privilege('authenticated', 'public.payment_remittance_events', 'insert'), 'authenticated callers cannot forge remittance records');
select ok((select prosecdef from pg_proc where oid = 'private.record_payment_remittance(text,text,jsonb)'::regprocedure), 'private remittance mutation is security definer');
select ok(not (select prosecdef from pg_proc where oid = 'public.record_payment_remittance(text,text,jsonb)'::regprocedure), 'public remittance wrapper uses caller privileges');
select ok(not has_function_privilege('anon', 'public.record_payment_remittance(text,text,jsonb)', 'execute'), 'anonymous callers cannot record remittance');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('private.record_payment_remittance(text,text,jsonb)'::regprocedure)) > 0, 'concurrent remittance retries are serialized');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.invoice_supporting_documents'::regclass
    and conname = 'invoice_supporting_documents_pdf_structure_check'
    and position('%%EOF' in pg_get_constraintdef(oid)) > 0
), 'supporting-document PDFs require a terminal marker');
select ok(exists (
  select 1
  from public.invoice_supporting_documents as document
  join public.invoices as invoice on invoice.id = document.invoice_id
  where document.file_name = 'INV-10482-proof-of-delivery.pdf'
    and document.sha256 <> invoice.document_sha256
), 'proof-of-delivery evidence is distinct from the invoice PDF');
select ok(exists (
  select 1
  from public.invoice_supporting_documents as document
  join public.invoices as invoice on invoice.id = document.invoice_id
  where invoice.invoice_number = 'INV-10417'
    and document.document_kind = 'proof_of_delivery'
    and document.file_name = 'INV-10417-proof-of-delivery.pdf'
    and document.sha256 = encode(extensions.digest(decode(document.content_base64, 'base64'), 'sha256'), 'hex')
    and document.sha256 <> invoice.document_sha256
), 'supplier-owned exception has an exact integrity-verified delivery proof');
select ok(position('extensions.digest' in pg_get_functiondef('public.record_payment_remittance(text,text,jsonb)'::regprocedure)) > 0, 'remittance wrapper derives its request fingerprint in PostgreSQL');

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'demo@openfinance.dev'),
  true
);
set local role authenticated;

select is((public.reset_demo_state()->>'readyInvoiceCount'), '3', 'test setup restores the narrated AR baseline');
select lives_ok(
  $$
    select public.record_delivery_event(
      'portal_result',
      'evidence-resolution-test-20260901',
      repeat('b', 64),
      '{"items":[{"invoiceNumber":"INV-10417","portalReference":"ACME-20260820-A1041701","portalStatus":"accepted"}]}'::jsonb
    )
  $$,
  'verified AP evidence resolution can be recorded without inventing a replacement reference'
);
select is(
  (select status::text || ':' || portal_status || ':' || coalesce(exception_code, 'none')
   from public.invoices where invoice_number = 'INV-10417'),
  'accepted:accepted:none',
  'evidence resolution visibly advances the AR invoice and clears its exception'
);
select is(
  (select details->>'documentName' from public.audit_events
   where action = 'portal_exception_resolved' and details->>'invoiceNumber' = 'INV-10417'
   order by created_at desc limit 1),
  'INV-10417-proof-of-delivery.pdf',
  'the resolution audit retains the exact approved evidence name'
);

select lives_ok(
  $$
    select public.record_payment_remittance(
      'security-remittance-fingerprint-0001',
      repeat('a', 64),
      '{"invoiceNumber":"INV-10311","paymentReference":"SEC-PAY-0001","amountMinor":100,"currency":"USD","paymentMethod":"ach","paidAt":"2026-08-30T12:00:00Z"}'::jsonb
    )
  $$,
  'a direct authenticated remittance call accepts its first canonical payload'
);
select throws_ok(
  $$
    select public.record_payment_remittance(
      'security-remittance-fingerprint-0001',
      repeat('a', 64),
      '{"invoiceNumber":"INV-10311","paymentReference":"SEC-PAY-CHANGED","amountMinor":200,"currency":"USD","paymentMethod":"ach","paidAt":"2026-08-30T12:01:00Z"}'::jsonb
    )
  $$,
  '23505',
  'Idempotency key reused with different payload',
  'a forged repeated caller fingerprint cannot hide changed remittance fields'
);

select * from finish();
rollback;
