begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

insert into public.buyers (id, name) values
  ('90000000-0000-4000-8000-000000000011', 'Foreign Test Buyer');

insert into public.suppliers (id, buyer_id, supplier_code, name) values
  (
    '90000000-0000-4000-8000-000000000012',
    '90000000-0000-4000-8000-000000000011',
    'FOREIGN-SUP-01',
    'Foreign Test Supplier'
  );

insert into public.purchase_orders (
  buyer_id, supplier_id, purchase_order_number, description,
  currency, authorized_amount_minor, remaining_amount_minor
) values (
  '90000000-0000-4000-8000-000000000011',
  '90000000-0000-4000-8000-000000000012',
  'PO-FOREIGN-01', 'Foreign tenant purchase order', 'USD', 100000, 100000
);

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);
set local role authenticated;

select plan(15);
select has_table('public', 'suppliers', 'suppliers exists');
select has_table('public', 'purchase_orders', 'purchase orders exist');
select has_table('public', 'invoice_submissions', 'invoice submissions exist');
select is((select relrowsecurity from pg_class where oid = 'public.purchase_orders'::regclass), true, 'purchase order RLS is enabled');
select is((select relrowsecurity from pg_class where oid = 'public.invoice_submissions'::regclass), true, 'submission RLS is enabled');
select ok(not has_table_privilege('anon', 'public.purchase_orders', 'select'), 'anonymous cannot read purchase orders');
select ok(has_table_privilege('authenticated', 'public.purchase_orders', 'select'), 'authenticated role can reach purchase-order RLS');
select ok(not has_table_privilege('authenticated', 'public.invoice_submissions', 'insert'), 'authenticated role cannot insert submissions directly');
select is((select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'purchase_orders'), 1, 'purchase orders have one supplier-scoped select policy');
select is((select prosecdef from pg_proc where oid = 'public.submit_invoice_batch(text,text,jsonb)'::regprocedure), false, 'public RPC wrapper is security invoker');
select is((select prosecdef from pg_proc where oid = 'private.submit_invoice_batch(text,text,jsonb)'::regprocedure), true, 'private submit function is security definer');
select ok((select coalesce(array_to_string(proconfig, ','), '') = 'search_path=""' from pg_proc where oid = 'private.submit_invoice_batch(text,text,jsonb)'::regprocedure), 'private function pins an empty search path');

select ok(
  (select count(*) from public.purchase_orders where supplier_id = '50000000-0000-4000-8000-000000000001') > 0,
  'the authenticated supplier can read its own purchase orders'
);

select is(
  (select count(*)::integer from public.purchase_orders where supplier_id = '90000000-0000-4000-8000-000000000012'),
  0,
  'foreign supplier purchase orders are hidden by RLS'
);

select throws_ok(
  $$
    select public.submit_invoice_batch(
      'foreign-rls-test-20260829',
      repeat('f', 64),
      jsonb_build_array(jsonb_build_object(
        'invoiceNumber', 'INV-FOREIGN-01',
        'invoiceDate', '2026-08-29',
        'amountMinor', 1000,
        'currency', 'USD',
        'purchaseOrderNumber', 'PO-FOREIGN-01',
        'document', jsonb_build_object(
          'fileName', 'INV-FOREIGN-01.pdf',
          'mediaType', 'application/pdf',
          'contentBase64', encode(convert_to('%PDF-foreign-test', 'UTF8'), 'base64'),
          'sha256', encode(extensions.digest(convert_to('%PDF-foreign-test', 'UTF8'), 'sha256'), 'hex')
        )
      ))
    )
  $$,
  '23514',
  'Purchase order is not open for this supplier',
  'submission cannot consume a foreign supplier purchase order'
);

select * from finish();
rollback;
