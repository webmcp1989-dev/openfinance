begin;

-- Keep the compatibility fingerprint argument in the PostgREST contract, but do
-- not trust it. Canonical jsonb text is stable in PostgreSQL and therefore makes
-- the database, not a direct RPC caller, authoritative for retry identity.
create or replace function public.respond_to_invoice_exception(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.respond_to_invoice_exception(
    $1,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to($3::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    $3
  )
$$;

create or replace function public.create_invoice_inquiry(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_invoice_inquiry(
    $1,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to($3::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    $3
  )
$$;

create or replace function public.replace_rejected_invoice(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoice jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.replace_rejected_invoice(
    $1,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to($3::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    $3
  )
$$;

revoke execute on function public.respond_to_invoice_exception(text, text, jsonb),
  public.create_invoice_inquiry(text, text, jsonb),
  public.replace_rejected_invoice(text, text, jsonb)
  from public, anon;
grant execute on function public.respond_to_invoice_exception(text, text, jsonb),
  public.create_invoice_inquiry(text, text, jsonb),
  public.replace_rejected_invoice(text, text, jsonb)
  to authenticated;

commit;
