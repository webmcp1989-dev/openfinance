begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

insert into public.organizations (id, name) values
  ('90000000-0000-4000-8000-000000000001', 'Foreign Test Organization');

insert into public.customers (id, organization_id, name, portal_origin) values
  (
    '90000000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000001',
    'Foreign Test Customer',
    'https://foreign.example.test'
  );

insert into public.invoices (
  organization_id, customer_id, invoice_number, invoice_date, amount_minor,
  currency, purchase_order_number, status, document_name, document_media_type,
  document_content_base64, document_sha256
) values (
  '90000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002',
  'FOREIGN-INV-01', current_date, 10000, 'USD', 'PO-FOREIGN-01', 'ready',
  'foreign-inv-01.pdf', 'application/pdf', 'JVBERi0xLjQK', repeat('a', 64)
);

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'demo@openfinance.dev'),
  true
);
set local role authenticated;

select plan(16);
select has_table('public', 'organizations', 'organizations exists');
select has_table('public', 'invoices', 'invoices exists');
select is((select relrowsecurity from pg_class where oid = 'public.invoices'::regclass), true, 'invoice RLS is enabled');
select ok(not has_table_privilege('anon', 'public.invoices', 'select'), 'anonymous cannot read invoices');
select ok(has_table_privilege('authenticated', 'public.invoices', 'select'), 'authenticated role can reach invoice RLS');
select ok(not has_table_privilege('authenticated', 'public.invoices', 'insert'), 'authenticated role cannot insert invoices directly');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'invoices'), 1, 'invoice table has one scoped select policy');
select is((select prosecdef from pg_proc where oid = 'public.record_delivery_event(public.delivery_event_type,text,text,jsonb)'::regprocedure), false, 'public RPC wrapper is security invoker');
select is((select prosecdef from pg_proc where oid = 'private.record_delivery_event(public.delivery_event_type,text,text,jsonb)'::regprocedure), true, 'private delivery function is security definer');
select ok((select coalesce(array_to_string(proconfig, ','), '') = 'search_path=""' from pg_proc where oid = 'private.record_delivery_event(public.delivery_event_type,text,text,jsonb)'::regprocedure), 'private function pins an empty search path');

select ok(
  (select count(*) from public.invoices where organization_id = '10000000-0000-4000-8000-000000000001') > 0,
  'the authenticated organization can read its own invoices'
);

select is(
  (select count(*)::integer from public.invoices where organization_id = '90000000-0000-4000-8000-000000000001'),
  0,
  'foreign organization invoices are hidden by RLS'
);

select throws_ok(
  $$
    select public.record_delivery_event(
      'portal_exception',
      'foreign-rls-test-20260829',
      repeat('f', 64),
      '{"items":[{"invoiceNumber":"FOREIGN-INV-01","exceptionCode":"foreign_invoice","message":"Must remain inaccessible."}]}'::jsonb
    )
  $$,
  'P0002',
  'Invoice not found',
  'delivery writeback cannot mutate a foreign organization invoice'
);

select ok(coalesce(not has_function_privilege('public', to_regprocedure('public.rls_auto_enable()'), 'execute'), true), 'PUBLIC cannot invoke the platform RLS event-trigger helper');
select ok(coalesce(not has_function_privilege('anon', to_regprocedure('public.rls_auto_enable()'), 'execute'), true), 'anonymous callers cannot invoke the platform RLS event-trigger helper');
select ok(coalesce(not has_function_privilege('authenticated', to_regprocedure('public.rls_auto_enable()'), 'execute'), true), 'authenticated callers cannot invoke the platform RLS event-trigger helper');

select * from finish();
rollback;
