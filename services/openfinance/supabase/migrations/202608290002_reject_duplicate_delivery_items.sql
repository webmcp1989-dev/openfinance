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
  v_organization_id uuid;
  v_item_count integer;
  v_distinct_invoice_count integer;
begin
  v_organization_id := private.current_organization_id();
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Organization access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_organization_id::text || ':' || coalesce(p_idempotency_key, ''), 0)
  );

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
