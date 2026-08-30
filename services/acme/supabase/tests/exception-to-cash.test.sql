begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(21);
select has_table('public', 'purchase_order_lines', 'purchase-order line context exists');
select has_table('public', 'invoice_status_events', 'invoice status timeline exists');
select has_table('public', 'invoice_exceptions', 'structured invoice exceptions exist');
select has_table('public', 'invoice_exception_responses', 'supplier exception responses exist');
select has_table('public', 'invoice_inquiries', 'supplier inquiries exist');
select has_table('public', 'invoice_replacement_requests', 'replacement request ledger exists');
select is((select relrowsecurity from pg_class where oid = 'public.invoice_exceptions'::regclass), true, 'invoice exceptions enforce RLS');
select is((select relrowsecurity from pg_class where oid = 'public.invoice_inquiries'::regclass), true, 'invoice inquiries enforce RLS');
select ok(not has_table_privilege('authenticated', 'public.invoice_exceptions', 'insert'), 'authenticated callers cannot forge buyer exceptions');
select ok(not has_table_privilege('authenticated', 'public.invoice_status_events', 'insert'), 'authenticated callers cannot forge status events');
select ok(not (select prosecdef from pg_proc where oid = 'public.respond_to_invoice_exception(text,text,jsonb)'::regprocedure), 'public exception-response wrapper uses caller privileges');
select ok(not (select prosecdef from pg_proc where oid = 'public.replace_rejected_invoice(text,text,jsonb)'::regprocedure), 'public replacement wrapper uses caller privileges');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('private.create_invoice_inquiry(text,text,jsonb)'::regprocedure)) > 0, 'concurrent inquiry retries are serialized');
select ok(
  position('owner not in' in pg_get_functiondef('private.respond_to_invoice_exception(text,text,jsonb)'::regprocedure)) > 0
  and position('pg_advisory_xact_lock' in pg_get_functiondef('private.respond_to_invoice_exception_unchecked(text,text,jsonb)'::regprocedure)) > 0,
  'exception responses enforce owner authority before the serialized mutation'
);
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.invoice_attachments'::regclass
    and conname = 'invoice_attachments_pdf_structure_check'
    and position('is_canonical_structural_pdf' in pg_get_constraintdef(oid)) > 0
), 'supporting-evidence PDFs require canonical structural validation');
select is(
  (select proargnames::text from pg_proc where oid = 'public.create_invoice_inquiry(text,text,jsonb)'::regprocedure),
  '{p_idempotency_key,p_request_fingerprint,p_payload}',
  'PostgREST can resolve named inquiry RPC arguments'
);
select ok(position('extensions.digest' in pg_get_functiondef('public.respond_to_invoice_exception(text,text,jsonb)'::regprocedure)) > 0, 'exception-response wrapper derives its request fingerprint in PostgreSQL');
select ok(position('extensions.digest' in pg_get_functiondef('public.create_invoice_inquiry(text,text,jsonb)'::regprocedure)) > 0, 'inquiry wrapper derives its request fingerprint in PostgreSQL');
select ok(position('extensions.digest' in pg_get_functiondef('public.replace_rejected_invoice(text,text,jsonb)'::regprocedure)) > 0, 'replacement wrapper derives its request fingerprint in PostgreSQL');

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);
set local role authenticated;

select lives_ok(
  $$
    select public.create_invoice_inquiry(
      'security-inquiry-fingerprint-0001',
      repeat('a', 64),
      '{"invoiceNumber":"INV-10417","inquiryType":"invoice_inquiry","subject":"First request","message":"First canonical payload."}'::jsonb
    )
  $$,
  'a direct authenticated inquiry call accepts its first canonical payload'
);
select throws_ok(
  $$
    select public.create_invoice_inquiry(
      'security-inquiry-fingerprint-0001',
      repeat('a', 64),
      '{"invoiceNumber":"INV-10417","inquiryType":"invoice_inquiry","subject":"Changed request","message":"A changed payload must not inherit the first result."}'::jsonb
    )
  $$,
  '23505',
  'Idempotency key reused with different payload',
  'a forged repeated caller fingerprint cannot hide a changed inquiry payload'
);

select * from finish();
rollback;
