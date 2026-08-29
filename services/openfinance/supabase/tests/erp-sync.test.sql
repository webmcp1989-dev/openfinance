begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

delete from public.erp_sync_events
where organization_id = '10000000-0000-4000-8000-000000000001';
delete from public.audit_events
where organization_id = '10000000-0000-4000-8000-000000000001'
  and action = 'erp_invoice_sync_completed';
delete from public.invoices
where organization_id = '10000000-0000-4000-8000-000000000001'
  and invoice_number like 'ERP-%';
update public.erp_sync_state
set next_invoice_sequence = 1, next_sync_has_invoices = true, updated_at = now()
where organization_id = '10000000-0000-4000-8000-000000000001';

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'demo@openfinance.dev'),
  true
);
set local role authenticated;

select plan(17);
select has_table('public', 'erp_sync_state', 'ERP sync state exists');
select has_table('public', 'erp_sync_events', 'ERP sync idempotency events exist');
select is((select relrowsecurity from pg_class where oid = 'public.erp_sync_state'::regclass), true, 'ERP sync state has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'public.erp_sync_events'::regclass), true, 'ERP sync events have RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.erp_sync_state', 'select'), 'authenticated users cannot read internal sync state');
select ok(not has_table_privilege('authenticated', 'public.erp_sync_events', 'select'), 'authenticated users cannot read internal idempotency records');
select is((select prosecdef from pg_proc where oid = 'public.sync_invoices_from_erp(text)'::regprocedure), false, 'public sync wrapper is security invoker');
select is((select prosecdef from pg_proc where oid = 'private.sync_invoices_from_erp(text)'::regprocedure), true, 'private sync function is security definer');

select is(
  (public.sync_invoices_from_erp('erp-sync-test-first-0001')->>'importedCount'),
  '2',
  'first sync imports two invoices'
);
select is((select count(*)::text from public.invoices where invoice_number like 'ERP-%'), '2', 'first sync inserts exactly two tenant invoices');
select is(
  (public.sync_invoices_from_erp('erp-sync-test-first-0001')->>'importedCount'),
  '2',
  'same key replays the first result'
);
select is((select count(*)::text from public.invoices where invoice_number like 'ERP-%'), '2', 'idempotent replay inserts nothing');
select is(
  (public.sync_invoices_from_erp('erp-sync-test-second-0002')->>'importedCount'),
  '0',
  'second sync reports no new invoices'
);
select is((select count(*)::text from public.invoices where invoice_number like 'ERP-%'), '2', 'empty sync inserts nothing');
select is(
  (public.sync_invoices_from_erp('erp-sync-test-third-0003')->>'importedCount'),
  '2',
  'third sync imports the next two invoices'
);
select is((select count(*)::text from public.invoices where invoice_number like 'ERP-%'), '4', 'third sync produces four unique ERP invoices in total');
select is((select count(*)::text from public.audit_events
  where organization_id = '10000000-0000-4000-8000-000000000001'
    and action = 'erp_invoice_sync_completed'), '3', 'each distinct sync attempt is audited');

select * from finish();
rollback;
