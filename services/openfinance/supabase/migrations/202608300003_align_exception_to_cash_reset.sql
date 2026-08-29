begin;

create or replace function private.reset_demo_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_deleted_delivery_events integer;
  v_deleted_remittance_events integer;
  v_deleted_erp_events integer;
  v_deleted_erp_invoices integer;
  v_updated_invoices integer;
  v_updated_sync_state integer;
  v_reset_at timestamptz := statement_timestamp();
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'Authentication required'; end if;
  select profile.organization_id into v_organization_id
  from public.profiles as profile
  where profile.user_id = v_user_id and profile.role in ('admin', 'operator');
  if v_organization_id is distinct from '10000000-0000-4000-8000-000000000001'::uuid then
    raise exception using errcode = '42501', message = 'Demo reset access required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_organization_id::text || ':demo-reset', 0));

  delete from public.audit_events where organization_id = v_organization_id;
  delete from public.payment_remittance_events where organization_id = v_organization_id;
  get diagnostics v_deleted_remittance_events = row_count;
  delete from public.delivery_events where organization_id = v_organization_id;
  get diagnostics v_deleted_delivery_events = row_count;
  delete from public.erp_sync_events where organization_id = v_organization_id;
  get diagnostics v_deleted_erp_events = row_count;
  delete from public.invoices
  where organization_id = v_organization_id and invoice_number like 'ERP-%';
  get diagnostics v_deleted_erp_invoices = row_count;

  update public.erp_sync_state
  set next_invoice_sequence = 1, next_sync_has_invoices = true, updated_at = v_reset_at
  where organization_id = v_organization_id;
  get diagnostics v_updated_sync_state = row_count;
  if v_updated_sync_state <> 1 then raise exception using errcode = 'P0002', message = 'Demo ERP state is incomplete'; end if;

  update public.invoices
  set status = case invoice_number when 'INV-10503' then 'needs_attention'::public.invoice_status else 'ready'::public.invoice_status end,
      portal_reference = null, portal_status = null,
      exception_code = case invoice_number when 'INV-10503' then 'missing_purchase_order' else null end,
      exception_message = case invoice_number when 'INV-10503' then 'Add a valid purchase order before portal submission.' else null end,
      due_date = invoice_date + 30,
      last_portal_checked_at = null,
      paid_amount_minor = 0,
      last_payment_at = null,
      last_payment_reference = null,
      version = 1, updated_at = v_reset_at
  where organization_id = v_organization_id and id in (
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000003',
    '30000000-0000-4000-8000-000000000004'
  );
  get diagnostics v_updated_invoices = row_count;
  if v_updated_invoices <> 4 then raise exception using errcode = 'P0002', message = 'Demo invoice baseline is incomplete'; end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, details, created_at
  ) values (
    v_organization_id, v_user_id, 'demo_state_reset', 'organization', v_organization_id::text,
    jsonb_build_object(
      'restoredInvoiceCount', v_updated_invoices,
      'deletedDeliveryEventCount', v_deleted_delivery_events,
      'deletedRemittanceEventCount', v_deleted_remittance_events,
      'deletedErpEventCount', v_deleted_erp_events,
      'deletedErpInvoiceCount', v_deleted_erp_invoices
    ), v_reset_at
  );
  return jsonb_build_object(
    'restoredInvoiceCount', v_updated_invoices,
    'deletedDeliveryEventCount', v_deleted_delivery_events,
    'deletedRemittanceEventCount', v_deleted_remittance_events,
    'deletedErpEventCount', v_deleted_erp_events,
    'deletedErpInvoiceCount', v_deleted_erp_invoices,
    'resetAt', v_reset_at
  );
end;
$$;

commit;
