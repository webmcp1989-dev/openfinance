begin;

-- These buyer-owned fixtures are independent of the AR database. Shared human-
-- readable identifiers let a browser agent reconcile them without any hidden
-- application-to-application connection.
insert into public.purchase_orders (
  id, buyer_id, supplier_id, purchase_order_number, description, currency,
  authorized_amount_minor, remaining_amount_minor, status, order_date,
  payment_terms, receipt_required, received_amount_minor,
  service_entry_required, service_entry_status, price_tolerance_basis_points,
  amount_tolerance_minor, required_attachment_kinds
) values
  ('60000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'PO-8701', 'Warehouse delivery program', 'USD', 1500000, 860000, 'open', '2026-06-15', 'Net 30', true, 1500000, false, 'not_required', 200, 5000, array['proof_of_delivery']::text[]),
  ('60000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'PO-8710', 'Facilities maintenance', 'USD', 2200000, 1100000, 'open', '2026-06-20', 'Net 45', true, 0, false, 'not_required', 200, 5000, '{}'::text[]),
  ('60000000-0000-4000-8000-000000000006', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'PO-8912', 'Integration training', 'USD', 1200000, 1200000, 'open', '2026-08-01', 'Net 30', true, 1200000, false, 'not_required', 200, 5000, '{}'::text[]),
  ('60000000-0000-4000-8000-000000000007', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'PO-8930', 'Data migration services', 'USD', 1800000, 1800000, 'open', '2026-08-03', 'Net 30', true, 1800000, false, 'not_required', 200, 5000, '{}'::text[]),
  ('60000000-0000-4000-8000-000000000008', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'PO-8955', 'Security assessment', 'USD', 950000, 950000, 'open', '2026-08-05', 'Net 30', true, 950000, false, 'not_required', 200, 5000, '{}'::text[]),
  ('60000000-0000-4000-8000-000000000009', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'PO-8971', 'Support enablement', 'USD', 1400000, 1400000, 'open', '2026-08-07', 'Net 30', true, 1400000, false, 'not_required', 200, 5000, '{}'::text[])
on conflict (buyer_id, purchase_order_number) do nothing;

insert into public.purchase_order_lines (
  purchase_order_id, line_number, description, unit_of_measure,
  ordered_quantity, received_quantity, unit_price_minor, line_amount_minor,
  invoiced_amount_minor
)
select purchase_order.id, 1, purchase_order.description, 'EA', 1,
  case when purchase_order.purchase_order_number = 'PO-8710' then 0 else 1 end,
  purchase_order.authorized_amount_minor, purchase_order.authorized_amount_minor,
  case purchase_order.purchase_order_number
    when 'PO-8701' then 640000
    when 'PO-8710' then 1100000
    else 0
  end
from public.purchase_orders as purchase_order
where purchase_order.id in (
  '60000000-0000-4000-8000-000000000004',
  '60000000-0000-4000-8000-000000000005',
  '60000000-0000-4000-8000-000000000006',
  '60000000-0000-4000-8000-000000000007',
  '60000000-0000-4000-8000-000000000008',
  '60000000-0000-4000-8000-000000000009'
)
on conflict (purchase_order_id, line_number) do nothing;

-- Preserve the existing transaction implementation, but place an explicit
-- authority and evidence guard in front of it. The unchecked implementation is
-- private and has no caller grant.
alter function private.respond_to_invoice_exception(text, text, jsonb)
  rename to respond_to_invoice_exception_unchecked;
revoke execute on function private.respond_to_invoice_exception_unchecked(text, text, jsonb)
  from public, anon, authenticated;

create function private.respond_to_invoice_exception(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_supplier_id uuid;
  v_exception public.invoice_exceptions%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  select profile.supplier_id into v_supplier_id
  from public.profiles as profile
  where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Submitter access required';
  end if;

  select exception.* into v_exception
  from public.invoice_exceptions as exception
  join public.invoice_submissions as submission
    on submission.id = exception.invoice_submission_id
  where exception.supplier_id = v_supplier_id
    and submission.invoice_number = p_payload->>'invoiceNumber'
    and submission.is_current
    and exception.exception_code = p_payload->>'exceptionCode';
  if not found then
    raise exception using errcode = 'P0002', message = 'Open invoice exception not found';
  end if;
  if v_exception.owner not in ('supplier_ar', 'shared')
     or not ('respond_to_exception' = any(v_exception.allowed_actions)) then
    raise exception using errcode = 'P0001',
      message = 'This isn''t mine to fix. The buyer owns this blocker; open a tracked AP inquiry instead.';
  end if;
  if v_exception.required_document_kind is not null and not exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'attachments', '[]'::jsonb)) as attachment(value)
    where attachment.value->>'documentKind' = v_exception.required_document_kind
  ) then
    raise exception using errcode = '23514',
      message = 'The required supporting document is missing from this exception response.';
  end if;

  return private.respond_to_invoice_exception_unchecked(
    p_idempotency_key, p_request_fingerprint, p_payload
  );
end;
$$;

revoke execute on function private.respond_to_invoice_exception(text, text, jsonb)
  from public, anon;
grant execute on function private.respond_to_invoice_exception(text, text, jsonb)
  to authenticated;

create or replace function public.respond_to_invoice_exception(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.respond_to_invoice_exception($1, $2, $3)
$$;

revoke execute on function public.respond_to_invoice_exception(text, text, jsonb)
  from public, anon;
grant execute on function public.respond_to_invoice_exception(text, text, jsonb)
  to authenticated;

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

  insert into public.submission_batches (
    id, buyer_id, supplier_id, idempotency_key, request_fingerprint,
    response, actor_user_id, created_at
  ) values (
    '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id,
    'seed-exception-portfolio-0001', repeat('a', 64),
    jsonb_build_object('seeded', true, 'itemCount', 2), v_user_id,
    v_reset_at - interval '10 days'
  );

  insert into public.invoice_submissions (
    id, batch_id, buyer_id, supplier_id, purchase_order_id, portal_reference,
    invoice_number, invoice_date, amount_minor, currency, document_name,
    document_media_type, document_sha256, document_size_bytes, status,
    created_at, updated_at
  ) values
    ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '60000000-0000-4000-8000-000000000004', 'ACME-20260820-A1041701', 'INV-10417', '2026-07-24', 640000, 'USD', 'INV-10417.pdf', 'application/pdf', repeat('1', 64), 4096, 'disputed', v_reset_at - interval '10 days', v_reset_at - interval '9 days'),
    ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '60000000-0000-4000-8000-000000000005', 'ACME-20260820-A1046301', 'INV-10463', '2026-08-06', 1100000, 'USD', 'INV-10463.pdf', 'application/pdf', repeat('2', 64), 4096, 'disputed', v_reset_at - interval '9 days', v_reset_at - interval '8 days');
  get diagnostics v_seeded_submissions = row_count;

  -- Seeded exception records are not payment candidates. Remove the simulator
  -- artifact created for the second insert, then restart the live sequence so
  -- the next pair of user submissions still demonstrates one payment.
  delete from public.payment_settlements
  where invoice_submission_id in (
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002'
  );
  delete from public.invoice_status_events
  where invoice_submission_id in (
    '80000000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000002'
  ) and event_code = 'synthetic_payment_scheduled';
  delete from public.audit_events
  where supplier_id = v_supplier_id and action = 'demo_payment_scheduled'
    and entity_id in (
      '80000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002'
    );

  insert into public.invoice_exceptions (
    id, buyer_id, supplier_id, invoice_submission_id, exception_code,
    category, owner, status, message, resolution_guidance, allowed_actions,
    required_document_kind, created_at, updated_at
  ) values
    ('81000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000001', 'missing_delivery_proof', 'document', 'supplier_ar', 'open', 'Proof of delivery is required before Acme can approve this invoice.', 'Supplier AR owns this blocker. Attach the verified proof of delivery and send an approved exception response.', array['respond_to_exception']::text[], 'proof_of_delivery', v_reset_at - interval '9 days', v_reset_at - interval '9 days'),
    ('81000000-0000-4000-8000-000000000002', v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000002', 'missing_goods_receipt', 'receiving', 'buyer_receiving', 'open', 'The purchase order has no posted goods receipt for this invoice.', 'This isn''t mine to fix. Acme receiving must post the missing receipt. Open a tracked invoice inquiry for buyer follow-up; do not fabricate a receipt or claim resolution.', array['create_invoice_inquiry']::text[], null, v_reset_at - interval '8 days', v_reset_at - interval '8 days');
  get diagnostics v_seeded_exceptions = row_count;

  insert into public.invoice_status_events (
    buyer_id, supplier_id, invoice_submission_id, status, event_code,
    message, actor_kind, created_at
  ) values
    (v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000001', 'disputed', 'missing_delivery_proof', 'Acme requested proof of delivery from supplier AR.', 'buyer', v_reset_at - interval '9 days'),
    (v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000002', 'disputed', 'missing_goods_receipt', 'Acme receiving must post the missing goods receipt.', 'buyer', v_reset_at - interval '8 days');

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

-- A live project already has a synthetic profile. Add the two baseline
-- exceptions without deleting any current demo activity. This migration-owned
-- seed may attribute its audit records to a viewer; runtime mutations remain
-- protected by the submitter-only functions above. Fresh projects get the same
-- baseline when the documented human reset is first run.
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
    jsonb_build_object('seeded', true, 'itemCount', 2), v_actor_user_id,
    v_now - interval '10 days'
  ) on conflict (id) do nothing;

  insert into public.invoice_submissions (
    id, batch_id, buyer_id, supplier_id, purchase_order_id, portal_reference,
    invoice_number, invoice_date, amount_minor, currency, document_name,
    document_media_type, document_sha256, document_size_bytes, status,
    created_at, updated_at
  ) values
    ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '60000000-0000-4000-8000-000000000004', 'ACME-20260820-A1041701', 'INV-10417', '2026-07-24', 640000, 'USD', 'INV-10417.pdf', 'application/pdf', repeat('1', 64), 4096, 'disputed', v_now - interval '10 days', v_now - interval '9 days'),
    ('80000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '60000000-0000-4000-8000-000000000005', 'ACME-20260820-A1046301', 'INV-10463', '2026-08-06', 1100000, 'USD', 'INV-10463.pdf', 'application/pdf', repeat('2', 64), 4096, 'disputed', v_now - interval '9 days', v_now - interval '8 days')
  on conflict (id) do nothing;

  delete from public.payment_settlements
  where invoice_submission_id in ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002');
  delete from public.invoice_status_events
  where invoice_submission_id in ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002')
    and event_code = 'synthetic_payment_scheduled';
  delete from public.audit_events
  where supplier_id = v_supplier_id and action = 'demo_payment_scheduled'
    and entity_id in ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002');

  insert into public.invoice_exceptions (
    id, buyer_id, supplier_id, invoice_submission_id, exception_code,
    category, owner, status, message, resolution_guidance, allowed_actions,
    required_document_kind, created_at, updated_at
  ) values
    ('81000000-0000-4000-8000-000000000001', v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000001', 'missing_delivery_proof', 'document', 'supplier_ar', 'open', 'Proof of delivery is required before Acme can approve this invoice.', 'Supplier AR owns this blocker. Attach the verified proof of delivery and send an approved exception response.', array['respond_to_exception']::text[], 'proof_of_delivery', v_now - interval '9 days', v_now - interval '9 days'),
    ('81000000-0000-4000-8000-000000000002', v_buyer_id, v_supplier_id, '80000000-0000-4000-8000-000000000002', 'missing_goods_receipt', 'receiving', 'buyer_receiving', 'open', 'The purchase order has no posted goods receipt for this invoice.', 'This isn''t mine to fix. Acme receiving must post the missing receipt. Open a tracked invoice inquiry for buyer follow-up; do not fabricate a receipt or claim resolution.', array['create_invoice_inquiry']::text[], null, v_now - interval '8 days', v_now - interval '8 days')
  on conflict (invoice_submission_id, exception_code) do nothing;

  insert into public.invoice_status_events (
    buyer_id, supplier_id, invoice_submission_id, status, event_code,
    message, actor_kind, created_at
  )
  select v_buyer_id, v_supplier_id, seed.invoice_submission_id, 'disputed',
    seed.event_code, seed.message, 'buyer', seed.created_at
  from (values
    ('80000000-0000-4000-8000-000000000001'::uuid, 'missing_delivery_proof', 'Acme requested proof of delivery from supplier AR.', v_now - interval '9 days'),
    ('80000000-0000-4000-8000-000000000002'::uuid, 'missing_goods_receipt', 'Acme receiving must post the missing goods receipt.', v_now - interval '8 days')
  ) as seed(invoice_submission_id, event_code, message, created_at)
  where not exists (
    select 1 from public.invoice_status_events as event
    where event.invoice_submission_id = seed.invoice_submission_id
      and event.event_code = seed.event_code
  );

  update public.purchase_orders
  set remaining_amount_minor = case purchase_order_number
        when 'PO-8701' then authorized_amount_minor - 640000
        when 'PO-8710' then authorized_amount_minor - 1100000
        else remaining_amount_minor
      end,
      updated_at = v_now
  where supplier_id = v_supplier_id and purchase_order_number in ('PO-8701', 'PO-8710');
end;
$$;

commit;
