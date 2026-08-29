begin;

create function private.reset_demo_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_supplier_id uuid;
  v_buyer_id uuid;
  v_deleted_submissions integer;
  v_deleted_batches integer;
  v_updated_orders integer;
  v_updated_simulator_state integer;
  v_reset_at timestamptz := statement_timestamp();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  select profile.supplier_id, supplier.buyer_id
    into v_supplier_id, v_buyer_id
  from public.profiles as profile
  join public.suppliers as supplier on supplier.id = profile.supplier_id
  where profile.user_id = v_user_id
    and profile.role in ('admin', 'submitter');

  if v_supplier_id is distinct from '50000000-0000-4000-8000-000000000001'::uuid then
    raise exception using errcode = '42501', message = 'Demo reset access required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_supplier_id::text || ':demo-reset', 0));

  delete from public.audit_events
  where supplier_id = v_supplier_id;

  delete from public.invoice_submissions
  where supplier_id = v_supplier_id;
  get diagnostics v_deleted_submissions = row_count;

  delete from public.submission_batches
  where supplier_id = v_supplier_id;
  get diagnostics v_deleted_batches = row_count;

  update private.payment_simulator_state
  set next_sequence = 1
  where supplier_id = v_supplier_id;
  get diagnostics v_updated_simulator_state = row_count;

  if v_updated_simulator_state <> 1 then
    raise exception using errcode = 'P0002', message = 'Demo payment state is incomplete';
  end if;

  update public.purchase_orders
  set remaining_amount_minor = authorized_amount_minor,
      status = 'open'::public.purchase_order_status,
      version = 1,
      updated_at = v_reset_at
  where supplier_id = v_supplier_id
    and id in (
      '60000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000002',
      '60000000-0000-4000-8000-000000000003'
    );
  get diagnostics v_updated_orders = row_count;

  if v_updated_orders <> 3 then
    raise exception using errcode = 'P0002', message = 'Demo purchase-order baseline is incomplete';
  end if;

  insert into public.audit_events (
    buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id, details, created_at
  ) values (
    v_buyer_id, v_supplier_id, v_user_id, 'demo_state_reset', 'supplier',
    v_supplier_id::text,
    jsonb_build_object(
      'restoredPurchaseOrderCount', v_updated_orders,
      'deletedSubmissionCount', v_deleted_submissions,
      'deletedBatchCount', v_deleted_batches
    ),
    v_reset_at
  );

  return jsonb_build_object(
    'restoredPurchaseOrderCount', v_updated_orders,
    'deletedSubmissionCount', v_deleted_submissions,
    'deletedBatchCount', v_deleted_batches,
    'resetAt', v_reset_at
  );
end;
$$;

revoke execute on function private.reset_demo_state() from public, anon;
grant execute on function private.reset_demo_state() to authenticated;

create function public.reset_demo_state()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.reset_demo_state()
$$;

revoke execute on function public.reset_demo_state() from public, anon;
grant execute on function public.reset_demo_state() to authenticated;

commit;
