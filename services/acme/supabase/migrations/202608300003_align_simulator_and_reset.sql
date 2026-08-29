begin;

create or replace function private.schedule_demo_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_sequence_number bigint;
  v_payment_reference text;
  v_scheduled_for timestamptz;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  insert into private.payment_simulator_state (supplier_id, next_sequence)
  values (new.supplier_id, 2)
  on conflict (supplier_id) do update
    set next_sequence = private.payment_simulator_state.next_sequence + 1
  returning next_sequence - 1 into v_sequence_number;

  if mod(v_sequence_number, 2) = 0 then
    v_scheduled_for := statement_timestamp() + interval '10 seconds';
    v_payment_reference := 'PAY-' || to_char(current_date, 'YYYYMMDD') || '-' ||
      upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.payment_settlements (
      invoice_submission_id, buyer_id, supplier_id, sequence_number,
      scheduled_for, payment_reference, amount_minor, currency, payment_method
    ) values (
      new.id, new.buyer_id, new.supplier_id, v_sequence_number,
      v_scheduled_for, v_payment_reference, new.amount_minor, new.currency, 'ach'
    );
    insert into public.invoice_status_events (
      buyer_id, supplier_id, invoice_submission_id, status, event_code, message, actor_kind
    ) values (
      new.buyer_id, new.supplier_id, new.id, 'payment_scheduled',
      'synthetic_payment_scheduled', 'Synthetic ACH payment is scheduled for ' || v_scheduled_for || '.', 'system'
    );
    insert into public.audit_events (
      buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id, details
    ) values (
      new.buyer_id, new.supplier_id, v_actor_user_id, 'demo_payment_scheduled',
      'invoice_submission', new.id::text,
      jsonb_build_object(
        'invoiceNumber', new.invoice_number, 'paymentReference', v_payment_reference,
        'scheduledFor', v_scheduled_for, 'simulatorSequence', v_sequence_number
      )
    );
  end if;
  return new;
end;
$$;

create or replace function private.reset_demo_state()
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
  if v_user_id is null then raise exception using errcode = '28000', message = 'Authentication required'; end if;
  select profile.supplier_id, supplier.buyer_id into v_supplier_id, v_buyer_id
  from public.profiles as profile join public.suppliers as supplier on supplier.id = profile.supplier_id
  where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_supplier_id is distinct from '50000000-0000-4000-8000-000000000001'::uuid then
    raise exception using errcode = '42501', message = 'Demo reset access required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_supplier_id::text || ':demo-reset', 0));

  delete from public.audit_events where supplier_id = v_supplier_id;
  delete from public.invoice_replacement_requests where supplier_id = v_supplier_id;
  delete from public.invoice_inquiries where supplier_id = v_supplier_id;
  delete from public.invoice_exception_responses where supplier_id = v_supplier_id;
  delete from public.invoice_exceptions where supplier_id = v_supplier_id;
  delete from public.invoice_status_events where supplier_id = v_supplier_id;
  delete from public.invoice_attachments where supplier_id = v_supplier_id;
  delete from public.invoice_submissions where supplier_id = v_supplier_id;
  get diagnostics v_deleted_submissions = row_count;
  delete from public.submission_batches where supplier_id = v_supplier_id;
  get diagnostics v_deleted_batches = row_count;

  update private.payment_simulator_state set next_sequence = 1 where supplier_id = v_supplier_id;
  get diagnostics v_updated_simulator_state = row_count;
  if v_updated_simulator_state <> 1 then raise exception using errcode = 'P0002', message = 'Demo payment state is incomplete'; end if;

  update public.purchase_orders
  set remaining_amount_minor = authorized_amount_minor,
      received_amount_minor = case purchase_order_number
        when 'PO-8821' then authorized_amount_minor
        when 'PO-8844' then authorized_amount_minor
        else 600000 end,
      service_entry_required = purchase_order_number = 'PO-8890',
      service_entry_status = case when purchase_order_number = 'PO-8890' then 'pending' else 'not_required' end,
      status = 'open'::public.purchase_order_status, version = 1, updated_at = v_reset_at
  where supplier_id = v_supplier_id and id in (
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000003'
  );
  get diagnostics v_updated_orders = row_count;
  if v_updated_orders <> 3 then raise exception using errcode = 'P0002', message = 'Demo purchase-order baseline is incomplete'; end if;

  insert into public.audit_events (
    buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id, details, created_at
  ) values (
    v_buyer_id, v_supplier_id, v_user_id, 'demo_state_reset', 'supplier', v_supplier_id::text,
    jsonb_build_object(
      'restoredPurchaseOrderCount', v_updated_orders,
      'deletedSubmissionCount', v_deleted_submissions,
      'deletedBatchCount', v_deleted_batches
    ), v_reset_at
  );
  return jsonb_build_object(
    'restoredPurchaseOrderCount', v_updated_orders,
    'deletedSubmissionCount', v_deleted_submissions,
    'deletedBatchCount', v_deleted_batches,
    'resetAt', v_reset_at
  );
end;
$$;

commit;
