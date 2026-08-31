begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);

set local role authenticated;
select public.reset_demo_state();
reset role;

update private.payment_simulator_state
set next_sequence = 1
where supplier_id = '50000000-0000-4000-8000-000000000001';

select plan(15);

select has_table('public', 'payment_settlements', 'payment settlements exist');
select has_function('public', 'get_invoice_submission_statuses', array['text'], 'effective submission status wrapper exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.payment_settlements'::regclass),
  true,
  'payment settlements enforce RLS'
);
select ok(
  not (select prosecdef from pg_proc
       where oid = 'public.get_invoice_submission_statuses(text)'::regprocedure),
  'public status wrapper uses caller privileges'
);
select ok(
  not has_function_privilege('anon', 'public.get_invoice_submission_statuses(text)', 'execute'),
  'anonymous callers cannot read payment-aware statuses'
);
select ok(
  has_function_privilege('authenticated', 'public.get_invoice_submission_statuses(text)', 'execute'),
  'authenticated suppliers can reach the scoped status function'
);
select ok(
  has_table_privilege('authenticated', 'public.payment_settlements', 'select')
  and not has_table_privilege('authenticated', 'public.payment_settlements', 'insert')
  and not has_table_privilege('authenticated', 'public.payment_settlements', 'update')
  and not has_table_privilege('authenticated', 'public.payment_settlements', 'delete'),
  'authenticated callers can read RLS-scoped remittance but cannot forge or modify settlements'
);
select ok(
  not has_table_privilege('authenticated', 'private.payment_simulator_state', 'select'),
  'the deterministic sequence state is not exposed to application callers'
);
select is(
  (select prosecdef from pg_proc where oid = 'private.schedule_demo_payment()'::regprocedure),
  true,
  'payment scheduling trigger is security definer'
);
select ok(
  (select coalesce(array_to_string(proconfig, ','), '') = 'search_path=""'
   from pg_proc where oid = 'private.schedule_demo_payment()'::regprocedure),
  'payment scheduling trigger pins an empty search path'
);

set local role authenticated;

create function pg_temp.structural_pdf()
returns bytea
language plpgsql
immutable
as $$
declare
  v_prefix text := E'%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n';
begin
  return convert_to(v_prefix || E'xref\n0 4\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n' || octet_length(convert_to(v_prefix, 'UTF8')) || E'\n%%EOF\n', 'UTF8');
end;
$$;

select public.submit_invoice_batch(
  'payment-pair-test-20260829',
  repeat('9', 64),
  jsonb_build_array(
    jsonb_build_object(
      'invoiceNumber', 'INV-PAYTEST-01',
      'invoiceDate', '2026-08-29',
      'amountMinor', 1000,
      'currency', 'USD',
      'purchaseOrderNumber', 'PO-8821',
      'document', jsonb_build_object(
        'fileName', 'INV-PAYTEST-01.pdf',
        'mediaType', 'application/pdf',
        'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
        'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
      )
    ),
    jsonb_build_object(
      'invoiceNumber', 'INV-PAYTEST-02',
      'invoiceDate', '2026-08-29',
      'amountMinor', 1000,
      'currency', 'USD',
      'purchaseOrderNumber', 'PO-8821',
      'document', jsonb_build_object(
        'fileName', 'INV-PAYTEST-02.pdf',
        'mediaType', 'application/pdf',
        'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
        'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
      )
    )
  )
);

reset role;

select is(
  (select count(*)::integer
   from public.payment_settlements as settlement
   join public.invoice_submissions as submission on submission.id = settlement.invoice_submission_id
   where submission.invoice_number in ('INV-PAYTEST-01', 'INV-PAYTEST-02')),
  1,
  'exactly one of each committed invoice pair receives a settlement schedule'
);

set local role authenticated;

select is(
  (select count(*)::integer from public.get_invoice_submission_statuses(null)
   where invoice_number in ('INV-PAYTEST-01', 'INV-PAYTEST-02')
     and settlement_expected_at is not null),
  1,
  'the eligible receipt exposes one authoritative expected settlement time'
);

reset role;
update public.payment_settlements
set scheduled_for = statement_timestamp() - interval '1 second'
where invoice_submission_id = (
  select id from public.invoice_submissions where invoice_number = 'INV-PAYTEST-02'
);
set local role authenticated;

select results_eq(
  $$
    select status from public.get_invoice_submission_statuses(null)
    where invoice_number in ('INV-PAYTEST-01', 'INV-PAYTEST-02')
    order by invoice_number
  $$,
  $$ values ('received'::text), ('paid'::text) $$,
  'the read-only status function advances only the eligible second invoice to paid'
);

select is(
  (select count(*)::integer from public.get_invoice_submission_statuses(null)
   where invoice_number in ('INV-PAYTEST-01', 'INV-PAYTEST-02')
     and status = 'paid'
     and paid_at is not null
     and payment_reference ~ '^PAY-[0-9]{8}-[A-F0-9]{8}$'),
  1,
  'a paid result includes its verifiable timestamp and payment reference'
);

select is(
  (select count(*)::integer from public.audit_events
   where action = 'demo_payment_scheduled'
     and details->>'invoiceNumber' = 'INV-PAYTEST-02'),
  1,
  'scheduling the synthetic settlement leaves one immutable audit event'
);

select * from finish();
rollback;
