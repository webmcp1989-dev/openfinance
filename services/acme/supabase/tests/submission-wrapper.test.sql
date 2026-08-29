begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);
set local role authenticated;

select plan(3);

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

select * from finish();
rollback;
