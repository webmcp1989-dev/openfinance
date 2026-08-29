begin;

create or replace function private.get_invoice_submission_statuses(p_invoice_number text default null)
returns table (
  invoice_number text,
  portal_reference text,
  purchase_order_number text,
  amount_minor bigint,
  currency text,
  status text,
  created_at timestamptz,
  settlement_expected_at timestamptz,
  paid_at timestamptz,
  payment_reference text
)
language sql
stable
security definer
set search_path = ''
as $$
select
  submission.invoice_number,
  submission.portal_reference,
  purchase_order.purchase_order_number,
  submission.amount_minor,
  submission.currency,
  case when settlement.scheduled_for <= statement_timestamp() then 'paid'
       else submission.status::text end,
  submission.created_at,
  settlement.scheduled_for,
  case when settlement.scheduled_for <= statement_timestamp() then settlement.scheduled_for else null end,
  case when settlement.scheduled_for <= statement_timestamp() then settlement.payment_reference else null end
from public.invoice_submissions as submission
join public.purchase_orders as purchase_order on purchase_order.id = submission.purchase_order_id
left join public.payment_settlements as settlement on settlement.invoice_submission_id = submission.id
where submission.supplier_id = (select private.current_supplier_id())
  and submission.is_current
  and (p_invoice_number is null or submission.invoice_number = p_invoice_number)
order by submission.created_at desc
$$;

commit;
