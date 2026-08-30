-- Administrative fallback for the synthetic OpenFinance AR project only.
-- The private function is the canonical reset implementation. SQL-editor
-- execution supplies the existing demo operator identity explicitly.
begin;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'demo@openfinance.dev'),
  true
);

select private.reset_demo_state();

commit;

select invoice_number, purchase_order_number, status, portal_reference,
       exception_code, paid_amount_minor, version
from public.invoices
where organization_id = '10000000-0000-4000-8000-000000000001'
order by invoice_date, invoice_number;

select
  (select count(*) from public.invoices
   where organization_id = '10000000-0000-4000-8000-000000000001') as canonical_invoice_count,
  (select count(*) from public.invoices
   where organization_id = '10000000-0000-4000-8000-000000000001' and status = 'ready') as ready_invoice_count,
  (select count(*) from public.delivery_events
   where organization_id = '10000000-0000-4000-8000-000000000001') as delivery_event_count,
  (select count(*) from public.audit_events
   where organization_id = '10000000-0000-4000-8000-000000000001') as audit_event_count;
