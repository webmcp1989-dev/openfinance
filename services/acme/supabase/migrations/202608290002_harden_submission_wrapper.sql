begin;

create or replace function public.submit_invoice_batch(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoices jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_supplier_id uuid;
  v_item_count integer;
  v_distinct_invoice_count integer;
begin
  v_supplier_id := private.current_supplier_id();
  if v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Supplier access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_supplier_id::text || ':' || coalesce(p_idempotency_key, ''), 0)
  );

  if jsonb_typeof(p_invoices) <> 'array' then
    raise exception using errcode = '22023', message = 'invoices must be an array';
  end if;

  select count(*), count(distinct value->>'invoiceNumber')
  into v_item_count, v_distinct_invoice_count
  from jsonb_array_elements(p_invoices);

  if v_item_count <> v_distinct_invoice_count then
    raise exception using errcode = '22023', message = 'Invoice numbers must be unique';
  end if;

  return private.submit_invoice_batch(
    p_idempotency_key,
    p_request_fingerprint,
    p_invoices
  );
end;
$$;

revoke execute on function public.submit_invoice_batch(text, text, jsonb) from public, anon;
grant execute on function public.submit_invoice_batch(text, text, jsonb) to authenticated;

commit;
