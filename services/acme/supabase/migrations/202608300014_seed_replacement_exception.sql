begin;

-- Keep the human reset authoritative for every challenge fixture. The third
-- historical submission mirrors AR's rejected INV-10479 and gives the
-- replacement tool one genuine, supplier-owned path without affecting the
-- core PO-8844 submission demo.
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
  v_seeded_submissions integer;
  v_seeded_exceptions integer;
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

  update public.purchase_orders
  set remaining_amount_minor = case purchase_order_number
        when 'PO-8701' then authorized_amount_minor - 640000
        when 'PO-8710' then authorized_amount_minor - 1100000
        when 'PO-8955' then authorized_amount_minor - 410000
        else authorized_amount_minor
      end,
      received_amount_minor = case purchase_order_number
        when 'PO-8710' then 0
        when 'PO-8890' then 600000
        else authorized_amount_minor
      end,
      service_entry_required = purchase_order_number = 'PO-8890',
      service_entry_status = case when purchase_order_number = 'PO-8890' then 'pending' else 'not_required' end,
      status = 'open'::public.purchase_order_status,
      version = 1,
      updated_at = v_reset_at
  where supplier_id = v_supplier_id and id in (
    '60000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000003',
    '60000000-0000-4000-8000-000000000004',
    '60000000-0000-4000-8000-000000000005',
    '60000000-0000-4000-8000-000000000006',
    '60000000-0000-4000-8000-000000000007',
    '60000000-0000-4000-8000-000000000008',
    '60000000-0000-4000-8000-000000000009'
  );
  get diagnostics v_updated_orders = row_count;
  if v_updated_orders <> 9 then raise exception using errcode = 'P0002', message = 'Demo purchase-order baseline is incomplete'; end if;

  update public.purchase_order_lines as line
  set invoiced_amount_minor = 410000
  from public.purchase_orders as purchase_order
  where line.purchase_order_id = purchase_order.id
    and purchase_order.supplier_id = v_supplier_id
    and purchase_order.purchase_order_number = 'PO-8955'
    and line.line_number = 1;

  insert into public.submission_batches (
    id, buyer_id, supplier_id, idempotency_key, request_fingerprint,
    response, actor_user_id, created_at
  ) values (
    '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id,
    'seed-exception-portfolio-0001', repeat('a', 64),
    jsonb_build_object('seeded', true, 'itemCount', 3), v_user_id,
    v_reset_at - interval '10 days'
  );

  insert into public.invoice_submissions (
    id, batch_id, buyer_id, supplier_id, purchase_order_id, portal_reference,
    invoice_number, invoice_date, amount_minor, currency, document_name,
    document_media_type, document_sha256, document_size_bytes, status,
    created_at, updated_at
  ) values
    ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '60000000-0000-4000-8000-000000000004', 'ACME-20260820-A1041701', 'INV-10417', '2026-07-24', 640000, 'USD', 'INV-10417.pdf', 'application/pdf', repeat('1', 64), 4096, 'disputed', v_reset_at - interval '10 days', v_reset_at - interval '9 days'),
    ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '60000000-0000-4000-8000-000000000005', 'ACME-20260820-A1046301', 'INV-10463', '2026-08-06', 1100000, 'USD', 'INV-10463.pdf', 'application/pdf', repeat('2', 64), 4096, 'disputed', v_reset_at - interval '9 days', v_reset_at - interval '8 days'),
    ('80000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '60000000-0000-4000-8000-000000000008', 'ACME-20260810-A1047901', 'INV-10479', '2026-08-10', 410000, 'USD', 'INV-10479.pdf', 'application/pdf', repeat('3', 64), 4096, 'rejected', v_reset_at - interval '8 days', v_reset_at - interval '7 days');
  get diagnostics v_seeded_submissions = row_count;

  -- Historical exceptions are not payment candidates and must not consume the
  -- deterministic sequence used by the next live pair of submissions.
  delete from public.payment_settlements
  where invoice_submission_id in (
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000003'
  );
  delete from public.invoice_status_events
  where invoice_submission_id in (
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000003'
  ) and event_code = 'synthetic_payment_scheduled';
  delete from public.audit_events
  where supplier_id = v_supplier_id and action = 'demo_payment_scheduled'
    and entity_id in (
      '80000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003'
    );

  insert into public.invoice_exceptions (
    id, buyer_id, supplier_id, invoice_submission_id, exception_code,
    category, owner, status, message, resolution_guidance, allowed_actions,
    required_document_kind, created_at, updated_at
  ) values
    ('81000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000001', 'missing_delivery_proof', 'document', 'supplier_ar', 'open', 'Proof of delivery is required before Acme can approve this invoice.', 'Supplier AR owns this blocker. Attach the verified proof of delivery and send an approved exception response.', array['respond_to_exception']::text[], 'proof_of_delivery', v_reset_at - interval '9 days', v_reset_at - interval '9 days'),
    ('81000000-0000-4000-8000-000000000002', v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000002', 'missing_goods_receipt', 'receiving', 'buyer_receiving', 'open', 'The purchase order has no posted goods receipt for this invoice.', 'This isn''t mine to fix. Acme receiving must post the missing receipt. Open a tracked invoice inquiry for buyer follow-up; do not fabricate a receipt or claim resolution.', array['create_invoice_inquiry']::text[], null, v_reset_at - interval '8 days', v_reset_at - interval '8 days'),
    ('81000000-0000-4000-8000-000000000003', v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000003', 'tax_total_mismatch', 'tax', 'supplier_ar', 'open', 'The invoice tax total does not match the submitted line totals.', 'Supplier AR owns this blocker. Correct the tax total and submit an approved replacement invoice that supersedes this rejected revision.', array['replace_invoice']::text[], null, v_reset_at - interval '7 days', v_reset_at - interval '7 days');
  get diagnostics v_seeded_exceptions = row_count;

  insert into public.invoice_status_events (
    buyer_id, supplier_id, invoice_submission_id, status, event_code,
    message, actor_kind, created_at
  ) values
    (v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000001', 'disputed', 'missing_delivery_proof', 'Acme requested proof of delivery from supplier AR.', 'buyer', v_reset_at - interval '9 days'),
    (v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000002', 'disputed', 'missing_goods_receipt', 'Acme receiving must post the missing goods receipt.', 'buyer', v_reset_at - interval '8 days'),
    (v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000003', 'rejected', 'tax_total_mismatch', 'Acme rejected the invoice because its tax total does not match the submitted line totals.', 'buyer', v_reset_at - interval '7 days');

  update private.payment_simulator_state set next_sequence = 1 where supplier_id = v_supplier_id;
  get diagnostics v_updated_simulator_state = row_count;
  if v_updated_simulator_state <> 1 then raise exception using errcode = 'P0002', message = 'Demo payment state is incomplete'; end if;

  insert into public.audit_events (
    buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id,
    details, created_at
  ) values (
    v_buyer_id, v_supplier_id, v_user_id, 'demo_state_reset', 'supplier',
    v_supplier_id::text, jsonb_build_object(
      'restoredPurchaseOrderCount', v_updated_orders,
      'seededSubmissionCount', v_seeded_submissions,
      'seededExceptionCount', v_seeded_exceptions,
      'deletedSubmissionCount', v_deleted_submissions,
      'deletedBatchCount', v_deleted_batches
    ), v_reset_at
  );
  return jsonb_build_object(
    'restoredPurchaseOrderCount', v_updated_orders,
    'seededSubmissionCount', v_seeded_submissions,
    'seededExceptionCount', v_seeded_exceptions,
    'deletedSubmissionCount', v_deleted_submissions,
    'deletedBatchCount', v_deleted_batches,
    'resetAt', v_reset_at
  );
end;
$$;

-- Add the new baseline row to an existing live project without deleting its
-- current activity. Every write is deterministic so the data seed is safe if
-- inspected or retried manually.
do $$
declare
  v_actor_user_id uuid;
  v_supplier_id constant uuid := '50000000-0000-4000-8000-000000000001';
  v_buyer_id constant uuid := '40000000-0000-4000-8000-000000000001';
  v_now timestamptz := statement_timestamp();
begin
  select profile.user_id into v_actor_user_id
  from public.profiles as profile
  where profile.supplier_id = v_supplier_id
  order by profile.created_at
  limit 1;
  if v_actor_user_id is null then return; end if;
  perform set_config('request.jwt.claim.sub', v_actor_user_id::text, true);

  insert into public.submission_batches (
    id, buyer_id, supplier_id, idempotency_key, request_fingerprint,
    response, actor_user_id, created_at
  ) values (
    '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id,
    'seed-exception-portfolio-0001', repeat('a', 64),
    jsonb_build_object('seeded', true, 'itemCount', 3), v_actor_user_id,
    v_now - interval '10 days'
  ) on conflict (id) do update
    set response = jsonb_build_object('seeded', true, 'itemCount', 3);

  insert into public.invoice_submissions (
    id, batch_id, buyer_id, supplier_id, purchase_order_id, portal_reference,
    invoice_number, invoice_date, amount_minor, currency, document_name,
    document_media_type, document_sha256, document_size_bytes, status,
    created_at, updated_at
  ) values (
    '80000000-0000-4000-8000-000000000003',
    '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id,
    '60000000-0000-4000-8000-000000000008', 'ACME-20260810-A1047901',
    'INV-10479', '2026-08-10', 410000, 'USD', 'INV-10479.pdf',
    'application/pdf', repeat('3', 64), 4096, 'rejected',
    v_now - interval '8 days', v_now - interval '7 days'
  ) on conflict (id) do nothing;

  delete from public.payment_settlements
  where invoice_submission_id = '80000000-0000-4000-8000-000000000003';
  delete from public.invoice_status_events
  where invoice_submission_id = '80000000-0000-4000-8000-000000000003'
    and event_code = 'synthetic_payment_scheduled';
  delete from public.audit_events
  where supplier_id = v_supplier_id and action = 'demo_payment_scheduled'
    and entity_id = '80000000-0000-4000-8000-000000000003';

  insert into public.invoice_exceptions (
    id, buyer_id, supplier_id, invoice_submission_id, exception_code,
    category, owner, status, message, resolution_guidance, allowed_actions,
    required_document_kind, created_at, updated_at
  ) values (
    '81000000-0000-4000-8000-000000000003', v_buyer_id, v_supplier_id,
    '80000000-0000-4000-8000-000000000003', 'tax_total_mismatch', 'tax',
    'supplier_ar', 'open',
    'The invoice tax total does not match the submitted line totals.',
    'Supplier AR owns this blocker. Correct the tax total and submit an approved replacement invoice that supersedes this rejected revision.',
    array['replace_invoice']::text[], null,
    v_now - interval '7 days', v_now - interval '7 days'
  ) on conflict (invoice_submission_id, exception_code) do nothing;

  insert into public.invoice_status_events (
    buyer_id, supplier_id, invoice_submission_id, status, event_code,
    message, actor_kind, created_at
  )
  select v_buyer_id, v_supplier_id,
    '80000000-0000-4000-8000-000000000003', 'rejected',
    'tax_total_mismatch',
    'Acme rejected the invoice because its tax total does not match the submitted line totals.',
    'buyer', v_now - interval '7 days'
  where not exists (
    select 1 from public.invoice_status_events as event
    where event.invoice_submission_id = '80000000-0000-4000-8000-000000000003'
      and event.event_code = 'tax_total_mismatch'
  );

  update public.purchase_orders
  set remaining_amount_minor = authorized_amount_minor - 410000,
      updated_at = v_now
  where supplier_id = v_supplier_id and purchase_order_number = 'PO-8955';
  update public.purchase_order_lines as line
  set invoiced_amount_minor = 410000
  from public.purchase_orders as purchase_order
  where line.purchase_order_id = purchase_order.id
    and purchase_order.supplier_id = v_supplier_id
    and purchase_order.purchase_order_number = 'PO-8955'
    and line.line_number = 1;
  update private.payment_simulator_state
  set next_sequence = 1
  where supplier_id = v_supplier_id;
end;
$$;

commit;
