begin;

-- Preserve the compatibility fingerprint argument while making canonical jsonb
-- content authoritative for retry identity at the database trust boundary.
create or replace function public.record_payment_remittance(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_payment_remittance(
    $1,
    pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to($3::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    $3
  )
$$;

revoke execute on function public.record_payment_remittance(text, text, jsonb)
  from public, anon;
grant execute on function public.record_payment_remittance(text, text, jsonb)
  to authenticated;

commit;
