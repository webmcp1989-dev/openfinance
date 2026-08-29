begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(2);

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
      '{"items":[{"invoiceNumber":"INV-10482"},{"invoiceNumber":"INV-10482"}]}'::jsonb
    )
  $$,
  '22023',
  'Invoice numbers must be unique',
  'duplicate invoice numbers are rejected before event processing'
);

select * from finish();
rollback;
