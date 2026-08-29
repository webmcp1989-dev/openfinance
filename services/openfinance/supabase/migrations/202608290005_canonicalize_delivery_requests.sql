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
  v_existing_event_type public.delivery_event_type;
  v_existing_payload jsonb;
  v_existing_fingerprint text;
  v_request_fingerprint text;
begin
  v_organization_id := private.current_organization_id();
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Organization access required';
  end if;

  if p_idempotency_key is null
     or pg_catalog.char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Invalid idempotency key';
  end if;

  -- Retain the deployed signature during migration, but never trust this caller value.
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid request fingerprint';
  end if;

  if p_event_type is null then
    raise exception using errcode = '22023', message = 'Invalid delivery event type';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_organization_id::text || ':' || p_idempotency_key, 0)
  );

  if p_payload is null
     or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ? 'items')
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(p_payload) as key
       where key <> 'items'
     ) then
    raise exception using errcode = '22023', message = 'Invalid delivery-event payload';
  end if;

  if pg_catalog.jsonb_typeof(p_payload->'items') <> 'array'
     or pg_catalog.jsonb_array_length(p_payload->'items') not between 1 and 10 then
    raise exception using errcode = '22023', message = 'Invalid delivery-event payload';
  end if;

  select count(*), count(distinct value->>'invoiceNumber')
  into v_item_count, v_distinct_invoice_count
  from pg_catalog.jsonb_array_elements(p_payload->'items');

  if v_item_count <> v_distinct_invoice_count then
    raise exception using errcode = '22023', message = 'Invoice numbers must be unique';
  end if;

  select e.event_type, e.payload, e.request_fingerprint
  into v_existing_event_type, v_existing_payload, v_existing_fingerprint
  from public.delivery_events as e
  where e.organization_id = v_organization_id
    and e.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_event_type is distinct from p_event_type
       or v_existing_payload is distinct from p_payload then
      raise exception using errcode = '23505', message = 'Idempotency key reused with different payload';
    end if;

    return private.record_delivery_event(
      p_event_type,
      p_idempotency_key,
      v_existing_fingerprint,
      p_payload
    );
  end if;

  v_request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_object(
          'eventType', p_event_type::text,
          'payload', p_payload
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  return private.record_delivery_event(
    p_event_type,
    p_idempotency_key,
    v_request_fingerprint,
    p_payload
  );
end;
$$;

revoke execute on function public.record_delivery_event(public.delivery_event_type, text, text, jsonb)
  from public, anon;
grant execute on function public.record_delivery_event(public.delivery_event_type, text, text, jsonb)
  to authenticated;

commit;
