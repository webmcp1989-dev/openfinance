begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(25);
select has_function('public', 'reset_demo_state', array[]::text[], 'public demo reset wrapper exists');
select has_function('private', 'reset_demo_state', array[]::text[], 'private demo reset implementation exists');
select ok(not (select prosecdef from pg_proc where oid = 'public.reset_demo_state()'::regprocedure), 'public reset wrapper is security invoker');
select ok((select prosecdef from pg_proc where oid = 'private.reset_demo_state()'::regprocedure), 'private reset implementation is security definer');
select ok(not has_function_privilege('anon', 'public.reset_demo_state()', 'execute'), 'anonymous callers cannot reset demo state');
select ok(has_function_privilege('authenticated', 'public.reset_demo_state()', 'execute'), 'authenticated callers can reach the authorized wrapper');

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);
set local role authenticated;

create function pg_temp.structural_pdf()
returns bytea
language plpgsql
immutable
as $$
declare
  v_prefix text := E'%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n';
begin
  return convert_to(v_prefix || E'xref\n0 4\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n' || octet_length(convert_to(v_prefix, 'UTF8')) || E'\n%%EOF\n', 'UTF8');
end;
$$;

create function pg_temp.approve_action(p_action text, p_key text, p_payload jsonb)
returns uuid
language plpgsql
as $$
declare
  v_preview jsonb;
  v_approval jsonb;
begin
  if p_action = 'submit_invoice_batch' then
    select jsonb_build_object('action', p_action, 'invoices', jsonb_agg(jsonb_build_object(
      'invoiceNumber', item.value->'invoiceNumber', 'invoiceDate', item.value->'invoiceDate',
      'amountMinor', item.value->'amountMinor', 'currency', item.value->'currency',
      'purchaseOrderNumber', item.value->'purchaseOrderNumber',
      'document', jsonb_build_object('fileName', item.value->'document'->'fileName', 'mediaType', item.value->'document'->'mediaType', 'sha256', item.value->'document'->'sha256')
    ) order by item.ordinality)) into v_preview
    from jsonb_array_elements(p_payload) with ordinality as item(value, ordinality);
  else
    select jsonb_build_object(
      'action', p_action, 'invoiceNumber', p_payload->'invoiceNumber',
      'exceptionCode', p_payload->'exceptionCode', 'message', p_payload->'message',
      'attachments', coalesce(jsonb_agg(jsonb_build_object(
        'documentKind', item.value->'documentKind', 'fileName', item.value->'fileName',
        'mediaType', item.value->'mediaType', 'sha256', item.value->'sha256'
      ) order by item.ordinality) filter (where item.value is not null), '[]'::jsonb)
    ) into v_preview
    from jsonb_array_elements(coalesce(p_payload->'attachments', '[]'::jsonb)) with ordinality as item(value, ordinality);
  end if;
  v_approval := public.request_document_submission_approval(p_action, p_key, repeat('0', 64), v_preview, 'human');
  perform public.decide_document_submission_approval((v_approval->>'approvalId')::uuid, 'approved');
  return (v_approval->>'approvalId')::uuid;
end;
$$;

select is(
  jsonb_array_length(public.submit_invoice_batch(
    'reset-test-submit-20260829',
    repeat('8', 64),
    jsonb_build_array(jsonb_build_object(
      'invoiceNumber', 'INV-RESET-TEST',
      'invoiceDate', '2026-08-29',
      'amountMinor', 1000,
      'currency', 'USD',
      'purchaseOrderNumber', 'PO-8821',
      'document', jsonb_build_object(
        'fileName', 'INV-RESET-TEST.pdf',
        'mediaType', 'application/pdf',
        'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
        'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
      )
    )),
    pg_temp.approve_action('submit_invoice_batch', 'reset-test-submit-20260829', jsonb_build_array(jsonb_build_object(
      'invoiceNumber', 'INV-RESET-TEST', 'invoiceDate', '2026-08-29', 'amountMinor', 1000,
      'currency', 'USD', 'purchaseOrderNumber', 'PO-8821',
      'document', jsonb_build_object(
        'fileName', 'INV-RESET-TEST.pdf', 'mediaType', 'application/pdf',
        'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
        'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
      )
    )))
  )->'items'),
  1,
  'test setup commits one synthetic invoice'
);
select is((public.reset_demo_state()->>'restoredPurchaseOrderCount'), '9', 'authorized submitter restores all nine purchase orders');
select throws_ok(
  $$ select public.respond_to_invoice_exception(
    'buyer-owner-guard-20260830', repeat('6', 64),
    '{"invoiceNumber":"INV-10463","exceptionCode":"missing_goods_receipt","message":"Supplier resolved it.","attachments":[]}'::jsonb,
    pg_temp.approve_action('respond_to_invoice_exception', 'buyer-owner-guard-20260830', '{"invoiceNumber":"INV-10463","exceptionCode":"missing_goods_receipt","message":"Supplier resolved it.","attachments":[]}'::jsonb)
  ) $$,
  'P0001',
  'This isn''t mine to fix. The buyer owns this blocker; open a tracked AP inquiry instead.',
  'supplier cannot claim resolution of a buyer-receiving blocker'
);
select throws_ok(
  $$ select public.respond_to_invoice_exception(
    'required-proof-guard-20260830', repeat('7', 64),
    '{"invoiceNumber":"INV-10417","exceptionCode":"missing_delivery_proof","message":"Please approve.","attachments":[]}'::jsonb,
    pg_temp.approve_action('respond_to_invoice_exception', 'required-proof-guard-20260830', '{"invoiceNumber":"INV-10417","exceptionCode":"missing_delivery_proof","message":"Please approve.","attachments":[]}'::jsonb)
  ) $$,
  '23514',
  'The required supporting document is missing from this exception response.',
  'supplier-owned delivery exception requires the exact evidence document'
);
reset role;
select is((select count(*)::text from public.invoice_submissions), '3', 'reset restores three independent historical exception submissions');
select is((select count(*)::text from public.submission_batches), '1', 'reset restores the seeded exception batch only');
select is((select count(*)::text from public.purchase_orders where remaining_amount_minor = authorized_amount_minor and status = 'open'), '6', 'six purchase orders retain full available balances');
select is((select count(*)::text from public.invoice_exceptions where status = 'open'), '3', 'reset restores three open owned exceptions');
select is((select count(*)::text from public.invoice_exceptions where owner = 'supplier_ar' and required_document_kind = 'proof_of_delivery'), '1', 'one supplier-owned blocker requires delivery proof');
select is((select count(*)::text from public.invoice_exceptions where owner = 'buyer_receiving' and allowed_actions = array['create_invoice_inquiry']::text[]), '1', 'one buyer-owned receipt blocker allows only a tracked inquiry');
select is((select count(*)::text from public.invoice_exceptions where owner = 'supplier_ar' and allowed_actions = array['replace_invoice']::text[]), '1', 'one supplier-owned rejected invoice allows an approved replacement');
select is((select count(*)::text from public.audit_events where action = 'demo_state_reset'), '1', 'reset remains visibly auditable');
select is((select next_sequence::text from private.payment_simulator_state), '2', 'reset makes the first invoice in the approved pair the deterministic payment candidate');
select has_function('public', 'get_open_buyer_cases', array[]::text[], 'tenant-scoped buyer case read model exists');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_open_buyer_cases()'::regprocedure), 'public buyer case wrapper is security invoker');
select ok(not has_function_privilege('anon', 'public.get_open_buyer_cases()', 'execute'), 'anonymous callers cannot list buyer cases');
select ok(has_function_privilege('authenticated', 'public.get_open_buyer_cases()', 'execute'), 'authenticated suppliers can list their own buyer cases');
select is((select count(*)::text from public.get_open_buyer_cases()), '0', 'reset begins with no open buyer inquiry');

update public.profiles set role = 'viewer'
where user_id = (select id from auth.users where lower(email) = 'supplier@acme.demo');
set local role authenticated;
select throws_ok(
  $$ select public.reset_demo_state() $$,
  '42501',
  'Demo reset access required',
  'viewer cannot reset the demo'
);
reset role;
update public.profiles set role = 'submitter'
where user_id = (select id from auth.users where lower(email) = 'supplier@acme.demo');

select * from finish();
rollback;
