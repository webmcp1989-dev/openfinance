begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

select has_function(
  'private', 'render_synthetic_invoice_pdf',
  array['text', 'date', 'bigint', 'text', 'text', 'text', 'text'],
  'detailed synthetic PDF renderer exists'
);
select hasnt_function(
  'private', 'render_synthetic_invoice_pdf', array['text'],
  'obsolete invoice-number-only renderer was removed'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.render_synthetic_invoice_pdf(text,date,bigint,text,text,text,text)',
    'execute'
  ),
  'application callers cannot execute the private PDF renderer'
);
select ok(
  not has_function_privilege('authenticated', 'private.ensure_renderable_erp_invoice_pdf()', 'execute'),
  'application callers cannot execute the ERP document trigger'
);

create temporary table rendered_pdf_check as
select private.render_synthetic_invoice_pdf(
  'INV-PDFTEST-01', '2026-08-12'::date, 1842000, 'USD', 'PO-8821',
  'Example Supplier Ltd', 'Acme (North) Manufacturing'
) as bytes;

select is(
  convert_from(substring(bytes from 1 for 8), 'UTF8'), '%PDF-1.4',
  'rendered bytes begin with a PDF version header'
) from rendered_pdf_check;

select ok(
  position(convert_to('/Type /Catalog', 'UTF8') in bytes) > 0
  and position(convert_to('/Type /Page', 'UTF8') in bytes) > 0,
  'rendered PDF has a catalog and page tree'
) from rendered_pdf_check;

select ok(
  position(convert_to('xref', 'UTF8') in bytes) > 0
  and position(convert_to('trailer', 'UTF8') in bytes) > 0
  and position(convert_to('startxref', 'UTF8') in bytes) > 0,
  'rendered PDF has a cross-reference table and trailer'
) from rendered_pdf_check;

select ok(
  convert_from(bytes, 'UTF8') ~ E'startxref\\n[0-9]+\\n%%EOF\\n$',
  'rendered PDF terminates with a numeric startxref and EOF marker'
) from rendered_pdf_check;

select is(
  (regexp_match(convert_from(bytes, 'UTF8'), E'startxref\\n([0-9]+)\\n%%EOF'))[1]::integer,
  position(convert_to('xref', 'UTF8') in bytes) - 1,
  'startxref points to the exact byte offset of the xref table'
) from rendered_pdf_check;

select ok(
  position(convert_to('INV-PDFTEST-01', 'UTF8') in bytes) > 0
  and position(convert_to('2026-08-12', 'UTF8') in bytes) > 0
  and position(convert_to('2026-09-11', 'UTF8') in bytes) > 0
  and position(convert_to('PO-8821', 'UTF8') in bytes) > 0
  and position(convert_to('USD 18420.00', 'UTF8') in bytes) > 0,
  'identity, issue date, Net-30 due date, PO, and amount are rendered'
) from rendered_pdf_check;

select ok(
  position(convert_to('Example Supplier Ltd', 'UTF8') in bytes) > 0
  and position(convert_to(E'Acme \\(North\\) Manufacturing', 'UTF8') in bytes) > 0
  and position(convert_to('AMOUNT DUE', 'UTF8') in bytes) > 0
  and position(convert_to('Synthetic challenge data', 'UTF8') in bytes) > 0,
  'supplier, safely escaped customer, total, and synthetic label are rendered'
) from rendered_pdf_check;

select is(
  (select count(*)::integer
   from public.invoices as invoice
   join public.organizations as organization on organization.id = invoice.organization_id
   join public.customers as customer on customer.id = invoice.customer_id
   where invoice.organization_id = '10000000-0000-4000-8000-000000000001'
     and invoice.invoice_number in ('INV-10482', 'INV-10491', 'INV-10503', 'INV-10507')
     and decode(replace(invoice.document_content_base64, E'\n', ''), 'base64') =
       private.render_synthetic_invoice_pdf(
         invoice.invoice_number, invoice.invoice_date, invoice.amount_minor, invoice.currency,
         invoice.purchase_order_number, organization.name, customer.name
       )),
  4,
  'all four core demo invoices contain the exact detailed document'
);

select is(
  (select count(*)::integer
   from public.invoices as invoice
   join public.organizations as organization on organization.id = invoice.organization_id
   join public.customers as customer on customer.id = invoice.customer_id
   where invoice.organization_id = '10000000-0000-4000-8000-000000000001'
     and invoice.invoice_number like 'ERP-%'
     and decode(replace(invoice.document_content_base64, E'\n', ''), 'base64') =
       private.render_synthetic_invoice_pdf(
         invoice.invoice_number, invoice.invoice_date, invoice.amount_minor, invoice.currency,
         invoice.purchase_order_number, organization.name, customer.name
       )),
  (select count(*)::integer from public.invoices
   where organization_id = '10000000-0000-4000-8000-000000000001'
     and invoice_number like 'ERP-%'),
  'all existing ERP invoices contain the exact detailed document'
);

select throws_ok(
  $$ select private.render_synthetic_invoice_pdf(
    'invalid invoice', '2026-08-12', 100, 'USD', 'PO-1', 'Supplier', 'Customer'
  ) $$,
  '22023', 'Invalid invoice number for synthetic PDF',
  'renderer rejects an unsafe invoice label'
);

select throws_ok(
  $$ select private.render_synthetic_invoice_pdf(
    'INV-1', '2026-08-12', 0, 'USD', 'PO-1', 'Supplier', 'Customer'
  ) $$,
  '22023', 'Invoice amount must be positive for synthetic PDF',
  'renderer rejects a non-positive amount'
);

select is(
  (select count(*)::integer from pg_trigger
   where tgrelid = 'public.invoices'::regclass
     and tgname = 'ensure_renderable_erp_invoice_pdf_before_insert'
     and not tgisinternal),
  1,
  'one ERP PDF repair trigger is installed'
);

select * from finish();
rollback;
