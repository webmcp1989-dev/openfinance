begin;

alter table public.invoice_supporting_documents
  add constraint invoice_supporting_documents_pdf_structure_check
  check (
    substring(decode(content_base64, 'base64') from 1 for 5) = convert_to('%PDF-', 'UTF8')
    and position(
      convert_to('%%EOF', 'UTF8')
      in substring(
        decode(content_base64, 'base64')
        from greatest(1, octet_length(decode(content_base64, 'base64')) - 1023)
      )
    ) > 0
  );

commit;
