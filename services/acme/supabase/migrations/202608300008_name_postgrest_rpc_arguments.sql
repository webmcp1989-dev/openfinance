begin;

drop function public.respond_to_invoice_exception(text, text, jsonb);
create function public.respond_to_invoice_exception(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.respond_to_invoice_exception($1, $2, $3) $$;

drop function public.create_invoice_inquiry(text, text, jsonb);
create function public.create_invoice_inquiry(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_invoice_inquiry($1, $2, $3) $$;

drop function public.replace_rejected_invoice(text, text, jsonb);
create function public.replace_rejected_invoice(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoice jsonb
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.replace_rejected_invoice($1, $2, $3) $$;

revoke execute on function public.respond_to_invoice_exception(text, text, jsonb),
  public.create_invoice_inquiry(text, text, jsonb),
  public.replace_rejected_invoice(text, text, jsonb)
  from public, anon;
grant execute on function public.respond_to_invoice_exception(text, text, jsonb),
  public.create_invoice_inquiry(text, text, jsonb),
  public.replace_rejected_invoice(text, text, jsonb)
  to authenticated;

commit;
