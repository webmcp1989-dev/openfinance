begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);
select has_table('public', 'invoice_supporting_documents', 'supporting documents exist');
select has_table('public', 'payment_remittance_events', 'remittance events exist');
select is((select relrowsecurity from pg_class where oid = 'public.invoice_supporting_documents'::regclass), true, 'supporting documents enforce RLS');
select is((select relrowsecurity from pg_class where oid = 'public.payment_remittance_events'::regclass), true, 'remittance events enforce RLS');
select ok(not has_table_privilege('anon', 'public.invoice_supporting_documents', 'select'), 'anonymous callers cannot read supporting documents');
select ok(not has_table_privilege('authenticated', 'public.payment_remittance_events', 'insert'), 'authenticated callers cannot forge remittance records');
select ok((select prosecdef from pg_proc where oid = 'private.record_payment_remittance(text,text,jsonb)'::regprocedure), 'private remittance mutation is security definer');
select ok(not (select prosecdef from pg_proc where oid = 'public.record_payment_remittance(text,text,jsonb)'::regprocedure), 'public remittance wrapper uses caller privileges');
select ok(not has_function_privilege('anon', 'public.record_payment_remittance(text,text,jsonb)', 'execute'), 'anonymous callers cannot record remittance');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('private.record_payment_remittance(text,text,jsonb)'::regprocedure)) > 0, 'concurrent remittance retries are serialized');
select ok(exists (
  select 1 from pg_constraint
  where conrelid = 'public.invoice_supporting_documents'::regclass
    and conname = 'invoice_supporting_documents_pdf_structure_check'
    and position('%%EOF' in pg_get_constraintdef(oid)) > 0
), 'supporting-document PDFs require a terminal marker');

select * from finish();
rollback;
