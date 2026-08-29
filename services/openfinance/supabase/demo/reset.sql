-- Administrative demo reset for the OpenFinance AR project only.
-- This is not a migration or runtime integration. It restores only the fixed
-- synthetic challenge organization and invoices. Review the project selector
-- in Supabase before running it.

begin;

select pg_advisory_xact_lock(hashtextextended('openfinance-ar-demo-reset', 0));

delete from public.audit_events
where organization_id = '10000000-0000-4000-8000-000000000001';

delete from public.delivery_events
where organization_id = '10000000-0000-4000-8000-000000000001';

delete from public.erp_sync_events
where organization_id = '10000000-0000-4000-8000-000000000001';

delete from public.invoices
where organization_id = '10000000-0000-4000-8000-000000000001'
  and invoice_number like 'ERP-%';

do $$
declare
  v_updated integer;
begin
  update public.erp_sync_state
  set next_invoice_sequence = 1,
      next_sync_has_invoices = true,
      updated_at = now()
  where organization_id = '10000000-0000-4000-8000-000000000001';

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'OpenFinance demo reset expected 1 ERP sync state row but updated %', v_updated;
  end if;
end;
$$;

do $$
declare
  v_updated integer;
begin
  update public.invoices
  set status = case invoice_number
        when 'INV-10503' then 'needs_attention'::public.invoice_status
        else 'ready'::public.invoice_status
      end,
      portal_reference = null,
      portal_status = null,
      exception_code = case invoice_number
        when 'INV-10503' then 'missing_purchase_order'
        else null
      end,
      exception_message = case invoice_number
        when 'INV-10503' then 'Add a valid purchase order before portal submission.'
        else null
      end,
      version = 1,
      updated_at = now()
  where organization_id = '10000000-0000-4000-8000-000000000001'
    and id in (
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '30000000-0000-4000-8000-000000000004'
    );

  get diagnostics v_updated = row_count;
  if v_updated <> 4 then
    raise exception 'OpenFinance demo reset expected 4 invoices but updated %', v_updated;
  end if;
end;
$$;

commit;

select invoice_number, purchase_order_number, status, portal_reference,
       exception_code, version
from public.invoices
where organization_id = '10000000-0000-4000-8000-000000000001'
order by invoice_number;

select
  (select count(*) from public.delivery_events
   where organization_id = '10000000-0000-4000-8000-000000000001') as delivery_event_count,
  (select count(*) from public.audit_events
   where organization_id = '10000000-0000-4000-8000-000000000001') as audit_event_count;
