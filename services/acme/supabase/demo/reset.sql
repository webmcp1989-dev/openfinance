-- Administrative demo reset for the independent Acme AP project only.
-- This is not a migration or runtime integration. It removes only the fixed
-- synthetic supplier's challenge receipts and restores its three seeded POs.
-- Review the project selector in Supabase before running it.

begin;

select pg_advisory_xact_lock(hashtextextended('acme-ap-demo-reset', 0));

delete from public.audit_events
where supplier_id = '50000000-0000-4000-8000-000000000001';

delete from public.invoice_submissions
where supplier_id = '50000000-0000-4000-8000-000000000001';

delete from public.submission_batches
where supplier_id = '50000000-0000-4000-8000-000000000001';

do $$
declare
  v_updated integer;
begin
  update public.purchase_orders
  set remaining_amount_minor = authorized_amount_minor,
      status = 'open'::public.purchase_order_status,
      version = 1,
      updated_at = now()
  where supplier_id = '50000000-0000-4000-8000-000000000001'
    and id in (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000003'
    );

  get diagnostics v_updated = row_count;
  if v_updated <> 3 then
    raise exception 'Acme demo reset expected 3 purchase orders but updated %', v_updated;
  end if;
end;
$$;

commit;

select purchase_order_number, status, authorized_amount_minor,
       remaining_amount_minor, version
from public.purchase_orders
where supplier_id = '50000000-0000-4000-8000-000000000001'
order by purchase_order_number;

select
  (select count(*) from public.submission_batches
   where supplier_id = '50000000-0000-4000-8000-000000000001') as submission_batch_count,
  (select count(*) from public.invoice_submissions
   where supplier_id = '50000000-0000-4000-8000-000000000001') as invoice_submission_count,
  (select count(*) from public.audit_events
   where supplier_id = '50000000-0000-4000-8000-000000000001') as audit_event_count;
