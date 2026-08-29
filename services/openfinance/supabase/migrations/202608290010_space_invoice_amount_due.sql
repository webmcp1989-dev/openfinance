begin;

create or replace function private.render_synthetic_invoice_pdf(
  p_invoice_number text,
  p_invoice_date date,
  p_amount_minor bigint,
  p_currency text,
  p_purchase_order_number text,
  p_supplier_name text,
  p_customer_name text
)
returns bytea
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_lf constant text := chr(10);
  v_issue_date text;
  v_due_date text;
  v_amount text;
  v_po text;
  v_description text;
  v_stream text;
  v_pdf text;
  v_offsets integer[] := array[]::integer[];
  v_xref_offset integer;
begin
  if p_invoice_number is null or p_invoice_number !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
    raise exception using errcode = '22023', message = 'Invalid invoice number for synthetic PDF';
  end if;
  if p_invoice_date is null then
    raise exception using errcode = '22023', message = 'Invoice date is required for synthetic PDF';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception using errcode = '22023', message = 'Invoice amount must be positive for synthetic PDF';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception using errcode = '22023', message = 'Invalid currency for synthetic PDF';
  end if;
  if p_purchase_order_number is not null
     and p_purchase_order_number !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
    raise exception using errcode = '22023', message = 'Invalid purchase order for synthetic PDF';
  end if;
  if p_supplier_name is null or char_length(p_supplier_name) not between 1 and 160
     or p_customer_name is null or char_length(p_customer_name) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'Supplier and customer names are required for synthetic PDF';
  end if;

  v_issue_date := to_char(p_invoice_date, 'YYYY-MM-DD');
  v_due_date := to_char(p_invoice_date + 30, 'YYYY-MM-DD');
  v_amount := p_currency || ' ' || (p_amount_minor / 100)::text || '.' ||
    lpad((p_amount_minor % 100)::text, 2, '0');
  v_po := coalesce(p_purchase_order_number, 'Not provided');
  v_description := 'Professional services' ||
    case when p_purchase_order_number is null then '' else ' for ' || p_purchase_order_number end;

  v_stream :=
    '0.09 0.22 0.35 rg 54 725 7 28 re f' || v_lf ||
    private.pdf_text_line(72, 731, 24, 'F2', p_supplier_name) ||
    private.pdf_text_line(438, 729, 28, 'F2', 'INVOICE') ||
    private.pdf_text_line(54, 700, 9, 'F1', '155 Market Street') ||
    private.pdf_text_line(54, 686, 9, 'F1', 'San Francisco, CA 94105') ||
    private.pdf_text_line(54, 672, 9, 'F1', 'billing@example-supplier.test') ||
    private.pdf_text_line(54, 658, 9, 'F1', 'Tax ID: 94-0001989') ||
    '0.82 0.85 0.88 RG 320 648 m 558 648 l S' || v_lf ||
    private.pdf_text_line(330, 628, 9, 'F2', 'Invoice number') ||
    private.pdf_text_line(452, 628, 9, 'F1', p_invoice_number) ||
    private.pdf_text_line(330, 612, 9, 'F2', 'Issue date') ||
    private.pdf_text_line(452, 612, 9, 'F1', v_issue_date) ||
    private.pdf_text_line(330, 596, 9, 'F2', 'Due date') ||
    private.pdf_text_line(452, 596, 9, 'F1', v_due_date) ||
    private.pdf_text_line(330, 580, 9, 'F2', 'Payment terms') ||
    private.pdf_text_line(452, 580, 9, 'F1', 'Net 30') ||
    private.pdf_text_line(330, 564, 9, 'F2', 'Purchase order') ||
    private.pdf_text_line(452, 564, 9, 'F1', v_po) ||
    private.pdf_text_line(54, 610, 10, 'F2', 'BILL TO') ||
    private.pdf_text_line(54, 588, 12, 'F2', p_customer_name) ||
    private.pdf_text_line(54, 570, 9, 'F1', '800 Industrial Way') ||
    private.pdf_text_line(54, 556, 9, 'F1', 'Austin, TX 78701') ||
    private.pdf_text_line(54, 542, 9, 'F1', 'accounts-payable@acme.example') ||
    '0.09 0.22 0.35 rg 54 486 504 28 re f' || v_lf ||
    private.pdf_text_line(66, 496, 9, 'F2', 'DESCRIPTION', '1 1 1') ||
    private.pdf_text_line(357, 496, 9, 'F2', 'QTY', '1 1 1') ||
    private.pdf_text_line(407, 496, 9, 'F2', 'RATE', '1 1 1') ||
    private.pdf_text_line(497, 496, 9, 'F2', 'AMOUNT', '1 1 1') ||
    private.pdf_text_line(66, 454, 10, 'F1', v_description) ||
    private.pdf_text_line(365, 454, 10, 'F1', '1') ||
    private.pdf_text_line(407, 454, 10, 'F1', v_amount) ||
    private.pdf_text_line(497, 454, 10, 'F1', v_amount) ||
    '0.82 0.85 0.88 RG 54 432 m 558 432 l S' || v_lf ||
    private.pdf_text_line(390, 394, 10, 'F1', 'Subtotal') ||
    private.pdf_text_line(497, 394, 10, 'F1', v_amount) ||
    private.pdf_text_line(390, 374, 10, 'F1', 'Tax') ||
    private.pdf_text_line(497, 374, 10, 'F1', p_currency || ' 0.00') ||
    '0.09 0.22 0.35 rg 378 330 180 30 re f' || v_lf ||
    private.pdf_text_line(390, 341, 11, 'F2', 'AMOUNT DUE', '1 1 1') ||
    private.pdf_text_line(475, 341, 10, 'F2', v_amount, '1 1 1') ||
    private.pdf_text_line(54, 338, 10, 'F2', 'PAYMENT DETAILS') ||
    private.pdf_text_line(54, 318, 9, 'F1', 'Bank: OpenFinance Demo Bank') ||
    private.pdf_text_line(54, 304, 9, 'F1', 'Account ending: 1989') ||
    private.pdf_text_line(54, 290, 9, 'F1', 'Payment reference: ' || p_invoice_number) ||
    private.pdf_text_line(54, 244, 10, 'F2', 'NOTES') ||
    private.pdf_text_line(54, 224, 9, 'F1', 'Thank you for your business. Include the invoice number with payment.') ||
    '0.82 0.85 0.88 RG 54 112 m 558 112 l S' || v_lf ||
    private.pdf_text_line(54, 92, 8, 'F1', 'Synthetic challenge data - not a request for real payment.', '0.35 0.39 0.44') ||
    private.pdf_text_line(405, 92, 8, 'F1', 'Generated by OpenFinance', '0.35 0.39 0.44');

  v_pdf := '%PDF-1.4' || v_lf;
  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '1 0 obj' || v_lf || '<< /Type /Catalog /Pages 2 0 R >>' || v_lf || 'endobj' || v_lf;
  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '2 0 obj' || v_lf || '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' || v_lf || 'endobj' || v_lf;
  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '3 0 obj' || v_lf ||
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>' ||
    v_lf || 'endobj' || v_lf;
  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '4 0 obj' || v_lf ||
    '<< /Length ' || octet_length(convert_to(v_stream, 'UTF8')) || ' >>' || v_lf ||
    'stream' || v_lf || v_stream || 'endstream' || v_lf || 'endobj' || v_lf;
  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '5 0 obj' || v_lf || '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' || v_lf || 'endobj' || v_lf;
  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '6 0 obj' || v_lf || '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>' || v_lf || 'endobj' || v_lf;

  v_xref_offset := octet_length(convert_to(v_pdf, 'UTF8'));
  v_pdf := v_pdf || 'xref' || v_lf || '0 7' || v_lf || '0000000000 65535 f ' || v_lf ||
    lpad(v_offsets[1]::text, 10, '0') || ' 00000 n ' || v_lf ||
    lpad(v_offsets[2]::text, 10, '0') || ' 00000 n ' || v_lf ||
    lpad(v_offsets[3]::text, 10, '0') || ' 00000 n ' || v_lf ||
    lpad(v_offsets[4]::text, 10, '0') || ' 00000 n ' || v_lf ||
    lpad(v_offsets[5]::text, 10, '0') || ' 00000 n ' || v_lf ||
    lpad(v_offsets[6]::text, 10, '0') || ' 00000 n ' || v_lf ||
    'trailer' || v_lf || '<< /Size 7 /Root 1 0 R >>' || v_lf ||
    'startxref' || v_lf || v_xref_offset || v_lf || '%%EOF' || v_lf;
  return convert_to(v_pdf, 'UTF8');
end;
$$;


revoke execute on function private.render_synthetic_invoice_pdf(text, date, bigint, text, text, text, text)
  from public, anon, authenticated;

with repaired as (
  select invoice.id, private.render_synthetic_invoice_pdf(
    invoice.invoice_number, invoice.invoice_date, invoice.amount_minor, invoice.currency,
    invoice.purchase_order_number, organization.name, customer.name
  ) as document_bytes
  from public.invoices as invoice
  join public.organizations as organization on organization.id = invoice.organization_id
  join public.customers as customer
    on customer.id = invoice.customer_id and customer.organization_id = invoice.organization_id
  where invoice.organization_id = '10000000-0000-4000-8000-000000000001'
    and (invoice.invoice_number in ('INV-10482', 'INV-10491', 'INV-10503', 'INV-10507')
      or invoice.invoice_number like 'ERP-%')
)
update public.invoices as invoice
set document_content_base64 = encode(repaired.document_bytes, 'base64'),
    document_sha256 = encode(extensions.digest(repaired.document_bytes, 'sha256'), 'hex')
from repaired
where invoice.id = repaired.id;


commit;



