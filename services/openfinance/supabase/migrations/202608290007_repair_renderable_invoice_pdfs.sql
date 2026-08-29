begin;

create function private.render_synthetic_invoice_pdf(p_invoice_number text)
returns bytea
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_lf constant text := chr(10);
  v_invoice_label text := replace(replace(replace(p_invoice_number, E'\\', E'\\\\'), '(', E'\\('), ')', E'\\)');
  v_stream text;
  v_pdf text;
  v_offsets integer[] := array[]::integer[];
  v_xref_offset integer;
begin
  if p_invoice_number !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
    raise exception using errcode = '22023', message = 'Invalid invoice number for synthetic PDF';
  end if;

  v_stream := 'BT' || v_lf ||
    '/F1 22 Tf' || v_lf ||
    '72 720 Td' || v_lf ||
    '(OpenFinance) Tj' || v_lf ||
    '/F1 12 Tf' || v_lf ||
    '0 -36 Td' || v_lf ||
    '(Synthetic invoice: ' || v_invoice_label || ') Tj' || v_lf ||
    '0 -24 Td' || v_lf ||
    '(Prepared for the WebMCP challenge demo) Tj' || v_lf ||
    'ET' || v_lf;

  v_pdf := '%PDF-1.4' || v_lf;

  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '1 0 obj' || v_lf ||
    '<< /Type /Catalog /Pages 2 0 R >>' || v_lf ||
    'endobj' || v_lf;

  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '2 0 obj' || v_lf ||
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' || v_lf ||
    'endobj' || v_lf;

  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '3 0 obj' || v_lf ||
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' ||
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>' || v_lf ||
    'endobj' || v_lf;

  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '4 0 obj' || v_lf ||
    '<< /Length ' || octet_length(convert_to(v_stream, 'UTF8')) || ' >>' || v_lf ||
    'stream' || v_lf || v_stream || 'endstream' || v_lf ||
    'endobj' || v_lf;

  v_offsets := array_append(v_offsets, octet_length(convert_to(v_pdf, 'UTF8')));
  v_pdf := v_pdf || '5 0 obj' || v_lf ||
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' || v_lf ||
    'endobj' || v_lf;

  v_xref_offset := octet_length(convert_to(v_pdf, 'UTF8'));
  v_pdf := v_pdf || 'xref' || v_lf || '0 6' || v_lf ||
    '0000000000 65535 f ' || v_lf ||
    lpad(v_offsets[1]::text, 10, '0') || ' 00000 n ' || v_lf ||
    lpad(v_offsets[2]::text, 10, '0') || ' 00000 n ' || v_lf ||
    lpad(v_offsets[3]::text, 10, '0') || ' 00000 n ' || v_lf ||
    lpad(v_offsets[4]::text, 10, '0') || ' 00000 n ' || v_lf ||
    lpad(v_offsets[5]::text, 10, '0') || ' 00000 n ' || v_lf ||
    'trailer' || v_lf ||
    '<< /Size 6 /Root 1 0 R >>' || v_lf ||
    'startxref' || v_lf || v_xref_offset || v_lf ||
    '%%EOF' || v_lf;

  return convert_to(v_pdf, 'UTF8');
end;
$$;

revoke execute on function private.render_synthetic_invoice_pdf(text) from public, anon, authenticated;

create function private.ensure_renderable_erp_invoice_pdf()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document_bytes bytea;
begin
  if new.invoice_number like 'ERP-%' then
    v_document_bytes := private.render_synthetic_invoice_pdf(new.invoice_number);
    new.document_name := new.invoice_number || '.pdf';
    new.document_media_type := 'application/pdf';
    new.document_content_base64 := encode(v_document_bytes, 'base64');
    new.document_sha256 := encode(extensions.digest(v_document_bytes, 'sha256'), 'hex');
  end if;
  return new;
end;
$$;

revoke execute on function private.ensure_renderable_erp_invoice_pdf() from public, anon, authenticated;

create trigger ensure_renderable_erp_invoice_pdf_before_insert
  before insert on public.invoices
  for each row execute function private.ensure_renderable_erp_invoice_pdf();

with repaired as (
  select
    invoice.id,
    private.render_synthetic_invoice_pdf(invoice.invoice_number) as document_bytes
  from public.invoices as invoice
  where invoice.organization_id = '10000000-0000-4000-8000-000000000001'
    and (
      invoice.invoice_number in ('INV-10482', 'INV-10491', 'INV-10503', 'INV-10507')
      or invoice.invoice_number like 'ERP-%'
    )
)
update public.invoices as invoice
set document_content_base64 = encode(repaired.document_bytes, 'base64'),
    document_sha256 = encode(extensions.digest(repaired.document_bytes, 'sha256'), 'hex')
from repaired
where invoice.id = repaired.id;

commit;
