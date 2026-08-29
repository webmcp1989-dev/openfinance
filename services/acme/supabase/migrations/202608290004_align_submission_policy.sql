begin;

alter table public.submission_requirements
  add constraint submission_requirements_web_contract check (
    accepted_media_types = array['application/pdf']::text[]
    and max_document_bytes = 1048576
    and require_open_purchase_order
    and enforce_remaining_balance
  );

commit;
