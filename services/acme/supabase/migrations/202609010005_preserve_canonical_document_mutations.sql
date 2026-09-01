begin;

-- Reuse the established public business wrappers inside the approval-aware
-- security-definer functions. Those wrappers derive canonical request identity
-- in PostgreSQL before delegating to the private mutation implementations.
create or replace function public.respond_to_invoice_exception(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb,
  p_approval_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.assert_document_submission_approval(
    p_approval_id, 'respond_to_invoice_exception', p_idempotency_key, p_request_fingerprint,
    private.document_submission_manifest('respond_to_invoice_exception', p_payload)
  );
  v_result := public.respond_to_invoice_exception(p_idempotency_key, p_request_fingerprint, p_payload);
  perform private.consume_document_submission_approval(p_approval_id);
  return v_result;
end;
$$;

create or replace function public.replace_rejected_invoice(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoice jsonb,
  p_approval_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  perform private.assert_document_submission_approval(
    p_approval_id, 'replace_rejected_invoice', p_idempotency_key, p_request_fingerprint,
    private.document_submission_manifest('replace_rejected_invoice', p_invoice)
  );
  v_result := public.replace_rejected_invoice(p_idempotency_key, p_request_fingerprint, p_invoice);
  perform private.consume_document_submission_approval(p_approval_id);
  return v_result;
end;
$$;

revoke execute on function public.respond_to_invoice_exception(text, text, jsonb, uuid),
  public.replace_rejected_invoice(text, text, jsonb, uuid)
  from public, anon;
grant execute on function public.respond_to_invoice_exception(text, text, jsonb, uuid),
  public.replace_rejected_invoice(text, text, jsonb, uuid)
  to authenticated;

commit;
