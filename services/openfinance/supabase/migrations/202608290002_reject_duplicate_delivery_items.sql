begin;

create or replace function public.record_delivery_event(
  p_event_type public.delivery_event_type,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item_count integer;
  v_distinct_invoice_count integer;
begin
  if jsonb_typeof(p_payload->'items') <> 'array' then
    raise exception using errcode = '22023', message = 'items must be an array';
  end if;

  select count(*), count(distinct value->>'invoiceNumber')
  into v_item_count, v_distinct_invoice_count
  from jsonb_array_elements(p_payload->'items');

  if v_item_count <> v_distinct_invoice_count then
    raise exception using errcode = '22023', message = 'Invoice numbers must be unique';
  end if;

  return private.record_delivery_event(
    p_event_type,
    p_idempotency_key,
    p_request_fingerprint,
    p_payload
  );
end;
$$;

revoke execute on function public.record_delivery_event(public.delivery_event_type, text, text, jsonb)
  from public, anon;
grant execute on function public.record_delivery_event(public.delivery_event_type, text, text, jsonb)
  to authenticated;

commit;
