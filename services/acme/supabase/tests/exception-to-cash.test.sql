begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(42);
select has_table('public', 'purchase_order_lines', 'purchase-order line context exists');
select has_table('public', 'invoice_status_events', 'invoice status timeline exists');
select has_table('public', 'invoice_exceptions', 'structured invoice exceptions exist');
select has_table('public', 'invoice_exception_responses', 'supplier exception responses exist');
select has_table('public', 'invoice_inquiries', 'supplier inquiries exist');
select has_table('public', 'invoice_replacement_requests', 'replacement request ledger exists');
select is((select relrowsecurity from pg_class where oid = 'public.invoice_exceptions'::regclass), true, 'invoice exceptions enforce RLS');
select is((select relrowsecurity from pg_class where oid = 'public.invoice_inquiries'::regclass), true, 'invoice inquiries enforce RLS');
select ok(not has_table_privilege('authenticated', 'public.invoice_exceptions', 'insert'), 'authenticated callers cannot forge buyer exceptions');
select ok(not has_table_privilege('authenticated', 'public.invoice_status_events', 'insert'), 'authenticated callers cannot forge status events');
select ok(not (select prosecdef from pg_proc where oid = 'public.respond_to_invoice_exception(text,text,jsonb)'::regprocedure), 'public exception-response wrapper uses caller privileges');
select ok(not (select prosecdef from pg_proc where oid = 'public.replace_rejected_invoice(text,text,jsonb)'::regprocedure), 'public replacement wrapper uses caller privileges');
select has_function('public', 'get_invoice_workflow_items', array[]::text[], 'tenant-scoped exception workflow read model exists');
select ok(not (select prosecdef from pg_proc where oid = 'public.get_invoice_workflow_items()'::regprocedure), 'public workflow read wrapper uses caller privileges');
select ok(not has_function_privilege('anon', 'public.get_invoice_workflow_items()', 'execute'), 'anonymous callers cannot read exception workflows');
select ok(has_function_privilege('authenticated', 'public.get_invoice_workflow_items()', 'execute'), 'authenticated suppliers can read their exception workflows');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('private.create_invoice_inquiry(text,text,jsonb)'::regprocedure)) > 0, 'concurrent inquiry retries are serialized');
select ok(
  position('owner not in' in pg_get_functiondef('private.respond_to_invoice_exception(text,text,jsonb)'::regprocedure)) > 0
  and position('pg_advisory_xact_lock' in pg_get_functiondef('private.respond_to_invoice_exception_unchecked(text,text,jsonb)'::regprocedure)) > 0,
  'exception responses enforce owner authority before the serialized mutation'
);
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.invoice_attachments'::regclass
    and conname = 'invoice_attachments_pdf_structure_check'
    and position('is_canonical_structural_pdf' in pg_get_constraintdef(oid)) > 0
), 'supporting-evidence PDFs require canonical structural validation');
select is(
  (select proargnames::text from pg_proc where oid = 'public.create_invoice_inquiry(text,text,jsonb)'::regprocedure),
  '{p_idempotency_key,p_request_fingerprint,p_payload}',
  'PostgREST can resolve named inquiry RPC arguments'
);
select ok(position('extensions.digest' in pg_get_functiondef('public.respond_to_invoice_exception(text,text,jsonb)'::regprocedure)) > 0, 'exception-response wrapper derives its request fingerprint in PostgreSQL');
select ok(position('extensions.digest' in pg_get_functiondef('public.create_invoice_inquiry(text,text,jsonb)'::regprocedure)) > 0, 'inquiry wrapper derives its request fingerprint in PostgreSQL');
select ok(position('extensions.digest' in pg_get_functiondef('public.replace_rejected_invoice(text,text,jsonb)'::regprocedure)) > 0, 'replacement wrapper derives its request fingerprint in PostgreSQL');
select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);
set local role authenticated;

select is(
  (public.reset_demo_state()->>'seededExceptionCount'),
  '3',
  'security and workflow tests start from the canonical three-exception baseline'
);
select ok(exists (
  select 1
  from public.invoice_exceptions as exception
  join public.invoice_submissions as submission
    on submission.id = exception.invoice_submission_id
  where submission.invoice_number = 'INV-10479'
    and submission.status = 'rejected'
    and submission.is_current
    and exception.owner = 'supplier_ar'
    and exception.status = 'open'
    and exception.allowed_actions = array['replace_invoice']::text[]
), 'reset includes one supplier-owned rejected invoice authorized for replacement');

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
declare v_preview jsonb; v_approval jsonb;
begin
  if p_action = 'respond_to_invoice_exception' then
    select jsonb_build_object(
      'action', p_action, 'invoiceNumber', p_payload->'invoiceNumber',
      'exceptionCode', p_payload->'exceptionCode', 'message', p_payload->'message',
      'attachments', coalesce(jsonb_agg(jsonb_build_object(
        'documentKind', item.value->'documentKind', 'fileName', item.value->'fileName',
        'mediaType', item.value->'mediaType', 'sha256', item.value->'sha256'
      ) order by item.ordinality) filter (where item.value is not null), '[]'::jsonb)
    ) into v_preview
    from jsonb_array_elements(coalesce(p_payload->'attachments', '[]'::jsonb)) with ordinality as item(value, ordinality);
  else
    v_preview := jsonb_build_object('action', p_action, 'invoice', jsonb_build_object(
      'invoiceNumber', p_payload->'invoiceNumber', 'invoiceDate', p_payload->'invoiceDate',
      'amountMinor', p_payload->'amountMinor', 'currency', p_payload->'currency',
      'purchaseOrderNumber', p_payload->'purchaseOrderNumber',
      'document', jsonb_build_object('fileName', p_payload->'document'->'fileName', 'mediaType', p_payload->'document'->'mediaType', 'sha256', p_payload->'document'->'sha256')
    ));
  end if;
  v_approval := public.request_document_submission_approval(p_action, p_key, repeat('0', 64), v_preview, 'human');
  perform public.decide_document_submission_approval((v_approval->>'approvalId')::uuid, 'approved');
  return (v_approval->>'approvalId')::uuid;
end;
$$;

select lives_ok(
  $$
    select public.create_invoice_inquiry(
      'security-inquiry-fingerprint-0001',
      repeat('a', 64),
      '{"invoiceNumber":"INV-10463","inquiryType":"invoice_inquiry","subject":"Missing receipt follow-up","message":"Please ask Acme receiving to post the missing goods receipt."}'::jsonb
    )
  $$,
  'a direct authenticated inquiry call accepts its first canonical payload'
);
select throws_ok(
  $$
    select public.create_invoice_inquiry(
      'security-inquiry-fingerprint-0001',
      repeat('a', 64),
      '{"invoiceNumber":"INV-10463","inquiryType":"invoice_inquiry","subject":"Changed request","message":"A changed payload must not inherit the first result."}'::jsonb
    )
  $$,
  '23505',
  'Idempotency key reused with different payload',
  'a forged repeated caller fingerprint cannot hide a changed inquiry payload'
);

select is(
  (public.respond_to_invoice_exception(
    'verified-evidence-test-0001', repeat('c', 64),
    jsonb_build_object(
      'invoiceNumber', 'INV-10417',
      'exceptionCode', 'missing_delivery_proof',
      'message', 'Attached is the verified proof of delivery requested by Acme.',
      'attachments', jsonb_build_array(jsonb_build_object(
        'documentKind', 'proof_of_delivery',
        'fileName', 'INV-10417-proof.pdf',
        'mediaType', 'application/pdf',
        'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
        'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
      ))
    ),
    pg_temp.approve_action('respond_to_invoice_exception', 'verified-evidence-test-0001', jsonb_build_object(
      'invoiceNumber', 'INV-10417', 'exceptionCode', 'missing_delivery_proof',
      'message', 'Attached is the verified proof of delivery requested by Acme.',
      'attachments', jsonb_build_array(jsonb_build_object(
        'documentKind', 'proof_of_delivery', 'fileName', 'INV-10417-proof.pdf',
        'mediaType', 'application/pdf', 'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
        'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
      ))
    ))
  )->>'exceptionStatus'),
  'resolved',
  'verified required supplier evidence resolves the exception'
);
select is(
  (public.respond_to_invoice_exception(
    'verified-evidence-test-0001', repeat('d', 64),
    jsonb_build_object(
      'invoiceNumber', 'INV-10417',
      'exceptionCode', 'missing_delivery_proof',
      'message', 'Attached is the verified proof of delivery requested by Acme.',
      'attachments', jsonb_build_array(jsonb_build_object(
        'documentKind', 'proof_of_delivery',
        'fileName', 'INV-10417-proof.pdf',
        'mediaType', 'application/pdf',
        'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
        'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
      ))
    ),
    pg_temp.approve_action('respond_to_invoice_exception', 'verified-evidence-test-0001', jsonb_build_object(
      'invoiceNumber', 'INV-10417', 'exceptionCode', 'missing_delivery_proof',
      'message', 'Attached is the verified proof of delivery requested by Acme.',
      'attachments', jsonb_build_array(jsonb_build_object(
        'documentKind', 'proof_of_delivery', 'fileName', 'INV-10417-proof.pdf',
        'mediaType', 'application/pdf', 'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
        'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
      ))
    ))
  )->>'invoiceStatus'),
  'accepted',
  'an identical retry returns the original accepted invoice outcome'
);
select is(
  (select status from public.invoice_exceptions where id = '81000000-0000-4000-8000-000000000001'::uuid),
  'resolved',
  'the supplier-owned exception is persistently resolved'
);
select is(
  (select status from public.invoice_submissions where id = '80000000-0000-4000-8000-000000000001'::uuid),
  'accepted'::public.invoice_submission_status,
  'the invoice is persistently approved after its only blocker resolves'
);
select is(
  (select count(*)::text from public.invoice_status_events
   where invoice_submission_id = '80000000-0000-4000-8000-000000000001'::uuid
     and event_code = 'supplier_evidence_approved'),
  '1',
  'an identical retry cannot duplicate the approval timeline event'
);
select is(
  (select count(*)::text from public.audit_events
   where action = 'invoice_exception_resolved'
     and details->>'invoiceNumber' = 'INV-10417'),
  '1',
  'an identical retry cannot duplicate the resolution audit event'
);
select is(
  (select workflow.exception_status || '|' || workflow.invoice_status
   from public.get_invoice_workflow_items() as workflow
   where workflow.invoice_number = 'INV-10417'),
  'resolved|accepted',
  'the workflow read model exposes the approved supplier-owned outcome'
);
select is(
  (select status from public.invoice_exceptions where id = '81000000-0000-4000-8000-000000000002'::uuid),
  'open',
  'opening a buyer case does not falsely resolve the buyer-owned exception'
);
select is(
  (select status from public.invoice_submissions where id = '80000000-0000-4000-8000-000000000002'::uuid),
  'disputed'::public.invoice_submission_status,
  'opening a buyer case leaves the blocked invoice on hold'
);
select is(
  (select workflow.case_status
   from public.get_invoice_workflow_items() as workflow
   where workflow.invoice_number = 'INV-10463'),
  'open',
  'the workflow read model exposes the tracked open buyer case'
);
select is(
  (select invoice_number || '|' || owner || '|' || status
   from public.get_open_buyer_cases()
   where case_reference like 'CASE-%'),
  'INV-10463|buyer_receiving|open',
  'the UI buyer-case read model exposes the exact durable case and authority owner'
);

select lives_ok(
  $$
    select public.replace_rejected_invoice(
      'replacement-fixture-test-0001',
      repeat('b', 64),
      jsonb_build_object(
        'invoiceNumber', 'INV-10479',
        'invoiceDate', '2026-08-30',
        'amountMinor', 410000,
        'currency', 'USD',
        'purchaseOrderNumber', 'PO-8955',
        'document', jsonb_build_object(
          'fileName', 'INV-10479-corrected.pdf',
          'mediaType', 'application/pdf',
          'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
          'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
        )
      ),
      pg_temp.approve_action('replace_rejected_invoice', 'replacement-fixture-test-0001', jsonb_build_object(
        'invoiceNumber', 'INV-10479', 'invoiceDate', '2026-08-30', 'amountMinor', 410000,
        'currency', 'USD', 'purchaseOrderNumber', 'PO-8955',
        'document', jsonb_build_object(
          'fileName', 'INV-10479-corrected.pdf', 'mediaType', 'application/pdf',
          'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
          'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
        )
      ))
    )
  $$,
  'authorized supplier can replace the seeded rejected invoice'
);
select is(
  (select revision::text from public.invoice_submissions where invoice_number = 'INV-10479' and is_current),
  '2',
  'replacement creates current revision two'
);
select is(
  (select status from public.invoice_submissions where id = '80000000-0000-4000-8000-000000000003'::uuid),
  'voided'::public.invoice_submission_status,
  'replacement voids the superseded rejected revision'
);
select is(
  (select exception.status from public.invoice_exceptions as exception where exception.id = '81000000-0000-4000-8000-000000000003'::uuid),
  'resolved',
  'replacement resolves the authorizing exception'
);

select * from finish();
rollback;
