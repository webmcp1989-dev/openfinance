begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from auth.users where lower(email) = 'supplier@acme.demo'),
  true
);
select plan(21);

set local role authenticated;
select public.reset_demo_state();
reset role;

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

create function pg_temp.invoice(p_invoice_number text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'invoiceNumber', p_invoice_number,
    'invoiceDate', '2026-09-01',
    'amountMinor', 10000,
    'currency', 'USD',
    'purchaseOrderNumber', 'PO-8821',
    'document', jsonb_build_object(
      'fileName', p_invoice_number || '.pdf',
      'mediaType', 'application/pdf',
      'contentBase64', replace(encode(pg_temp.structural_pdf(), 'base64'), chr(10), ''),
      'sha256', encode(extensions.digest(pg_temp.structural_pdf(), 'sha256'), 'hex')
    )
  )
$$;

create function pg_temp.batch_manifest(p_invoice jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'action', 'submit_invoice_batch',
    'invoices', jsonb_build_array(jsonb_build_object(
      'invoiceNumber', p_invoice->'invoiceNumber',
      'invoiceDate', p_invoice->'invoiceDate',
      'amountMinor', p_invoice->'amountMinor',
      'currency', p_invoice->'currency',
      'purchaseOrderNumber', p_invoice->'purchaseOrderNumber',
      'document', jsonb_build_object(
        'fileName', p_invoice->'document'->'fileName',
        'mediaType', p_invoice->'document'->'mediaType',
        'sha256', p_invoice->'document'->'sha256'
      )
    ))
  )
$$;

create temporary table approval_test_ids (name text primary key, id uuid not null);
grant select, insert, update, delete on approval_test_ids to authenticated;

select has_table('public', 'document_submission_approvals', 'approval ledger exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.document_submission_approvals'::regclass),
  true,
  'approval ledger has row-level security enabled'
);
select ok(
  not has_table_privilege('authenticated', 'public.document_submission_approvals', 'INSERT,UPDATE,DELETE'),
  'authenticated clients cannot directly create or alter approval state'
);
select ok(
  not has_function_privilege('authenticated', 'public.submit_invoice_batch(text,text,jsonb)', 'EXECUTE'),
  'the legacy unapproved batch wrapper is not executable'
);
select ok(
  not has_function_privilege('authenticated', 'private.submit_invoice_batch(text,text,jsonb)', 'EXECUTE'),
  'the private batch mutation cannot bypass approval'
);
select ok(
  not has_function_privilege('authenticated', 'public.respond_to_invoice_exception(text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.replace_rejected_invoice(text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.respond_to_invoice_exception(text,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.replace_rejected_invoice(text,text,jsonb)', 'EXECUTE'),
  'exception evidence and replacement legacy functions cannot bypass approval'
);
select ok(
  has_function_privilege('authenticated', 'public.submit_invoice_batch(text,text,jsonb,uuid)', 'EXECUTE'),
  'authenticated submitters can use only the approval-aware batch wrapper'
);

set local role authenticated;
select throws_ok(
  $$ select public.submit_invoice_batch(
    'missing-approval-20260901', repeat('a', 64),
    jsonb_build_array(pg_temp.invoice('INV-APPROVAL-00')),
    '90000000-0000-4000-8000-000000000099'::uuid
  ) $$,
  'P0001',
  'Document approval is required',
  'a fabricated approval id cannot submit documents'
);

insert into approval_test_ids
select 'denied', (result->>'approvalId')::uuid
from (
  select public.request_document_submission_approval(
    'submit_invoice_batch', 'denied-approval-20260901', repeat('b', 64),
    pg_temp.batch_manifest(pg_temp.invoice('INV-APPROVAL-01')),
    'agent'
  ) as result
) as prepared;
select is(
  (public.decide_document_submission_approval((select id from approval_test_ids where name = 'denied'), 'denied')->>'status'),
  'denied',
  'the signed-in human can explicitly deny the pending action'
);
select throws_ok(
  $$ select public.submit_invoice_batch(
    'denied-approval-20260901', repeat('b', 64),
    jsonb_build_array(pg_temp.invoice('INV-APPROVAL-01')),
    (select id from approval_test_ids where name = 'denied')
  ) $$,
  'P0001',
  'Document approval is not active',
  'a denied approval cannot mutate AP state'
);

insert into approval_test_ids
select 'approved', (result->>'approvalId')::uuid
from (
  select public.request_document_submission_approval(
    'submit_invoice_batch', 'approved-action-20260901', repeat('c', 64),
    pg_temp.batch_manifest(pg_temp.invoice('INV-APPROVAL-02')),
    'agent'
  ) as result
) as prepared;
select is(
  (public.decide_document_submission_approval((select id from approval_test_ids where name = 'approved'), 'approved')->>'status'),
  'approved',
  'the signed-in human can approve the exact pending action'
);
select is(
  (public.submit_invoice_batch(
    'approved-action-20260901', repeat('c', 64),
    jsonb_build_array(pg_temp.invoice('INV-APPROVAL-02')),
    (select id from approval_test_ids where name = 'approved')
  )->'items'->0->>'invoiceNumber'),
  'INV-APPROVAL-02',
  'an approved exact document payload commits successfully'
);
reset role;
select is(
  (select status from public.document_submission_approvals where id = (select id from approval_test_ids where name = 'approved')),
  'consumed',
  'the successful transaction consumes the approval exactly once'
);
set local role authenticated;
select is(
  (public.submit_invoice_batch(
    'approved-action-20260901', repeat('c', 64),
    jsonb_build_array(pg_temp.invoice('INV-APPROVAL-02')),
    (select id from approval_test_ids where name = 'approved')
  )->'items'->0->>'invoiceNumber'),
  'INV-APPROVAL-02',
  'an exact retry returns the original idempotent result without another side effect'
);
select throws_ok(
  $$ select public.decide_document_submission_approval(
    (select id from approval_test_ids where name = 'approved'),
    'denied'
  ) $$,
  'P0001',
  'Document approval is no longer pending',
  'a consumed approval cannot be changed to another decision'
);
select throws_ok(
  $$ select public.replace_rejected_invoice(
    'approved-action-20260901', repeat('c', 64),
    pg_temp.invoice('INV-APPROVAL-02'),
    (select id from approval_test_ids where name = 'approved')
  ) $$,
  'P0001',
  'Document approval does not match this request',
  'an approval cannot be reused for a different document action'
);

insert into approval_test_ids
select 'expired', (result->>'approvalId')::uuid
from (
  select public.request_document_submission_approval(
    'submit_invoice_batch', 'expired-approval-20260901', repeat('e', 64),
    pg_temp.batch_manifest(pg_temp.invoice('INV-APPROVAL-04')),
    'agent'
  ) as result
) as prepared;
select public.decide_document_submission_approval((select id from approval_test_ids where name = 'expired'), 'approved');
reset role;
update public.document_submission_approvals
set created_at = statement_timestamp() - interval '2 minutes',
    expires_at = statement_timestamp() - interval '1 minute'
where id = (select id from approval_test_ids where name = 'expired');
set local role authenticated;
select throws_ok(
  $$ select public.submit_invoice_batch(
    'expired-approval-20260901', repeat('e', 64),
    jsonb_build_array(pg_temp.invoice('INV-APPROVAL-04')),
    (select id from approval_test_ids where name = 'expired')
  ) $$,
  'P0001',
  'Document approval is not active',
  'an expired approval cannot mutate AP state'
);

insert into approval_test_ids
select 'tampered', (result->>'approvalId')::uuid
from (
  select public.request_document_submission_approval(
    'submit_invoice_batch', 'tamper-approval-20260901', repeat('d', 64),
    pg_temp.batch_manifest(pg_temp.invoice('INV-APPROVAL-03')),
    'agent'
  ) as result
) as prepared;
select public.decide_document_submission_approval((select id from approval_test_ids where name = 'tampered'), 'approved');
select throws_ok(
  $$ select public.submit_invoice_batch(
    'tamper-approval-20260901', repeat('d', 64),
    jsonb_build_array(jsonb_set(pg_temp.invoice('INV-APPROVAL-03'), '{amountMinor}', '10001'::jsonb)),
    (select id from approval_test_ids where name = 'tampered')
  ) $$,
  'P0001',
  'Document approval does not match this request',
  'changing an amount after approval invalidates consent'
);
select throws_ok(
  $$ select public.submit_invoice_batch(
    'different-idempotency-20260901', repeat('d', 64),
    jsonb_build_array(pg_temp.invoice('INV-APPROVAL-03')),
    (select id from approval_test_ids where name = 'tampered')
  ) $$,
  'P0001',
  'Document approval does not match this request',
  'changing the idempotency key after approval invalidates consent'
);
reset role;
select is(
  (select count(*)::integer from public.document_submission_approvals where preview::text like '%contentBase64%'),
  0,
  'approval records never retain PDF base64 content'
);

select lives_ok(
  $$ set local role authenticated; select public.reset_demo_state(); reset role $$,
  'canonical reset clears approval artifacts without breaking the demo state'
);

select * from finish();
rollback;
