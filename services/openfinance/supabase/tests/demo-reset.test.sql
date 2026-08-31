begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(19);
select has_function('public', 'reset_demo_state', array[]::text[], 'public demo reset wrapper exists');
select has_function('private', 'reset_demo_state', array[]::text[], 'private demo reset implementation exists');
select ok((select prosecdef from pg_proc where oid = 'public.reset_demo_state()'::regprocedure), 'public reset wrapper enforces the human-only boundary as security definer');
select ok((select prosecdef from pg_proc where oid = 'private.reset_demo_state()'::regprocedure), 'private reset implementation is security definer');
select ok(not has_function_privilege('anon', 'public.reset_demo_state()', 'execute'), 'anonymous callers cannot reset demo state');
select ok(has_function_privilege('authenticated', 'public.reset_demo_state()', 'execute'), 'authenticated callers can reach the authorized wrapper');
select ok(not has_function_privilege('authenticated', 'private.reset_demo_state()', 'execute'), 'authenticated callers cannot bypass the public reset boundary');

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'demo@openfinance.dev'),
  true
);
set local role authenticated;

select is((public.sync_invoices_from_erp('reset-test-sync-20260829')->>'importedCount'), '2', 'test setup creates two ERP invoices');
select is((public.reset_demo_state()->>'restoredInvoiceCount'), '24', 'authorized operator restores the full canonical invoice portfolio');
reset role;
select is((select count(*)::text from public.invoices where invoice_number like 'ERP-%'), '0', 'reset removes synthetic ERP imports');
select is((select count(*)::text from public.invoices where status = 'ready'), '3', 'reset restores exactly three narrated Acme candidates');
select is((select count(*)::text from public.invoices where invoice_number in ('INV-10482', 'INV-10491', 'INV-10507') and status = 'ready'), '3', 'the narrated ready candidates are stable');
select is((select count(*)::text from public.invoices where invoice_number = 'INV-10417' and status = 'needs_attention' and portal_status = 'disputed' and exception_code = 'missing_delivery_proof'), '1', 'reset restores the supplier-owned evidence exception');
select is((select count(*)::text from public.invoices where invoice_number = 'INV-10463' and status = 'needs_attention' and portal_status = 'disputed' and exception_code = 'missing_goods_receipt'), '1', 'reset restores the buyer-owned receipt blocker');
select is((select count(*)::text from public.invoices where invoice_number in ('INV-10522', 'INV-10538', 'INV-10544', 'INV-10561') and status = 'accepted'), '4', 'former ready fixtures remain visible as accepted history');
select is((select count(*)::text from public.invoices where invoice_number = 'INV-10503' and status = 'needs_attention' and exception_code = 'missing_purchase_order'), '1', 'reset restores the deliberate missing-PO exception');
select is((select count(*)::text from public.audit_events where action = 'demo_state_reset'), '1', 'reset remains visibly auditable');
select is((select next_invoice_sequence::text || ':' || next_sync_has_invoices::text from public.erp_sync_state), '1:true', 'reset restores deterministic ERP sync state');

update public.profiles set role = 'viewer'
where user_id = (select id from auth.users where lower(email) = 'demo@openfinance.dev');
set local role authenticated;
select throws_ok(
  $$ select public.reset_demo_state() $$,
  '42501',
  'Demo reset access required',
  'viewer cannot reset the demo'
);
reset role;
update public.profiles set role = 'operator'
where user_id = (select id from auth.users where lower(email) = 'demo@openfinance.dev');

select * from finish();
rollback;
