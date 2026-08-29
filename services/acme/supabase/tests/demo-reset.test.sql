begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);
select has_function('public', 'reset_demo_state', array[]::text[], 'public demo reset wrapper exists');
select has_function('private', 'reset_demo_state', array[]::text[], 'private demo reset implementation exists');
select ok(not (select prosecdef from pg_proc where oid = 'public.reset_demo_state()'::regprocedure), 'public reset wrapper is security invoker');
select ok((select prosecdef from pg_proc where oid = 'private.reset_demo_state()'::regprocedure), 'private reset implementation is security definer');
select ok(not has_function_privilege('anon', 'public.reset_demo_state()', 'execute'), 'anonymous callers cannot reset demo state');
select ok(has_function_privilege('authenticated', 'public.reset_demo_state()', 'execute'), 'authenticated callers can reach the authorized wrapper');

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);
set local role authenticated;

select is(
  jsonb_array_length(public.submit_invoice_batch(
    'reset-test-submit-20260829',
    repeat('8', 64),
    jsonb_build_array(jsonb_build_object(
      'invoiceNumber', 'INV-RESET-TEST',
      'invoiceDate', '2026-08-29',
      'amountMinor', 1000,
      'currency', 'USD',
      'purchaseOrderNumber', 'PO-8821',
      'document', jsonb_build_object(
        'fileName', 'INV-RESET-TEST.pdf',
        'mediaType', 'application/pdf',
        'contentBase64', encode(convert_to(E'%PDF-reset-test\n%%EOF', 'UTF8'), 'base64'),
        'sha256', encode(extensions.digest(convert_to(E'%PDF-reset-test\n%%EOF', 'UTF8'), 'sha256'), 'hex')
      )
    ))
  )->'items'),
  1,
  'test setup commits one synthetic invoice'
);
select is((public.reset_demo_state()->>'restoredPurchaseOrderCount'), '3', 'authorized submitter restores all three purchase orders');
reset role;
select is((select count(*)::text from public.invoice_submissions), '0', 'reset removes supplier invoice submissions');
select is((select count(*)::text from public.submission_batches), '0', 'reset removes supplier submission batches');
select is((select count(*)::text from public.purchase_orders where remaining_amount_minor = authorized_amount_minor and status = 'open'), '3', 'reset restores all purchase-order balances');
select is((select count(*)::text from public.audit_events where action = 'demo_state_reset'), '1', 'reset remains visibly auditable');
select is((select next_sequence::text from private.payment_simulator_state), '1', 'reset restores deterministic payment sequence');

update public.profiles set role = 'viewer'
where user_id = (select id from auth.users where lower(email) = 'supplier@acme.demo');
set local role authenticated;
select throws_ok(
  $$ select public.reset_demo_state() $$,
  '42501',
  'Demo reset access required',
  'viewer cannot reset the demo'
);
reset role;
update public.profiles set role = 'submitter'
where user_id = (select id from auth.users where lower(email) = 'supplier@acme.demo');

select * from finish();
rollback;
