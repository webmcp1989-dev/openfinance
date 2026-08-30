-- Administrative fallback for the synthetic Acme AP project only.
-- The private function is the canonical reset implementation. SQL-editor
-- execution supplies the existing demo submitter identity explicitly.
begin;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);

select private.reset_demo_state();

commit;

select purchase_order_number, status, authorized_amount_minor,
       remaining_amount_minor, received_amount_minor, version
from public.purchase_orders
where supplier_id = '50000000-0000-4000-8000-000000000001'
order by purchase_order_number;

select
  (select count(*) from public.submission_batches
   where supplier_id = '50000000-0000-4000-8000-000000000001') as submission_batch_count,
  (select count(*) from public.invoice_submissions
   where supplier_id = '50000000-0000-4000-8000-000000000001') as invoice_submission_count,
  (select count(*) from public.invoice_exceptions
   where supplier_id = '50000000-0000-4000-8000-000000000001' and status = 'open') as open_exception_count,
  (select count(*) from public.audit_events
   where supplier_id = '50000000-0000-4000-8000-000000000001') as audit_event_count,
  (select next_sequence from private.payment_simulator_state
   where supplier_id = '50000000-0000-4000-8000-000000000001') as next_payment_sequence;
