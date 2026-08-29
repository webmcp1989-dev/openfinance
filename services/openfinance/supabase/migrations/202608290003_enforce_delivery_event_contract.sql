begin;

create or replace function private.record_delivery_event(
  p_event_type public.delivery_event_type,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_customer_id uuid;
  v_existing public.delivery_events%rowtype;
  v_item jsonb;
  v_invoice public.invoices%rowtype;
  v_invoice_number text;
  v_portal_reference text;
  v_portal_status text;
  v_exception_code text;
  v_exception_message text;
  v_item_count integer;
  v_distinct_invoice_count integer;
  v_result_items jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Invalid idempotency key';
  end if;

  if p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid request fingerprint';
  end if;

  if jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ? 'items')
     or exists (select 1 from jsonb_object_keys(p_payload) as key where key <> 'items')
     or jsonb_typeof(p_payload->'items') <> 'array'
     or jsonb_array_length(p_payload->'items') not between 1 and 10 then
    raise exception using errcode = '22023', message = 'Invalid delivery-event payload';
  end if;

  select count(*), count(distinct value->>'invoiceNumber')
  into v_item_count, v_distinct_invoice_count
  from jsonb_array_elements(p_payload->'items');

  if v_item_count <> v_distinct_invoice_count then
    raise exception using errcode = '22023', message = 'Invoice numbers must be unique';
  end if;

  select p.organization_id into v_organization_id
  from public.profiles as p
  where p.user_id = v_user_id and p.role in ('admin', 'operator');

  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Operator access required';
  end if;

  select e.* into v_existing
  from public.delivery_events as e
  where e.organization_id = v_organization_id
    and e.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key reused with different payload';
    end if;
    return v_existing.result;
  end if;

  for v_item in select value from jsonb_array_elements(p_payload->'items')
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'Each delivery-event item must be an object';
    end if;

    v_invoice_number := v_item->>'invoiceNumber';
    if v_invoice_number is null or v_invoice_number !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
      raise exception using errcode = '22023', message = 'Invalid invoice number';
    end if;

    if p_event_type = 'portal_result' then
      if not (v_item ?& array['invoiceNumber', 'portalReference', 'portalStatus'])
         or exists (
           select 1 from jsonb_object_keys(v_item) as key
           where key not in ('invoiceNumber', 'portalReference', 'portalStatus')
         ) then
        raise exception using errcode = '22023', message = 'Invalid portal result fields';
      end if;

      v_portal_reference := v_item->>'portalReference';
      v_portal_status := v_item->>'portalStatus';
      if v_portal_reference is null or char_length(v_portal_reference) not between 1 and 120
         or v_portal_status not in ('received', 'under_review', 'accepted') then
        raise exception using errcode = '22023', message = 'Invalid portal result fields';
      end if;
    else
      if not (v_item ?& array['invoiceNumber', 'exceptionCode', 'message'])
         or exists (
           select 1 from jsonb_object_keys(v_item) as key
           where key not in ('invoiceNumber', 'exceptionCode', 'message')
         ) then
        raise exception using errcode = '22023', message = 'Invalid portal exception fields';
      end if;

      v_exception_code := v_item->>'exceptionCode';
      v_exception_message := v_item->>'message';
      if v_exception_code is null or v_exception_code !~ '^[a-z][a-z0-9_]{1,63}$'
         or v_exception_message is null or char_length(v_exception_message) not between 1 and 500 then
        raise exception using errcode = '22023', message = 'Invalid portal exception fields';
      end if;
    end if;

    select i.* into v_invoice
    from public.invoices as i
    where i.organization_id = v_organization_id
      and i.invoice_number = v_invoice_number
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'Invoice not found';
    end if;

    if v_customer_id is null then
      v_customer_id := v_invoice.customer_id;
    elsif v_customer_id <> v_invoice.customer_id then
      raise exception using errcode = '22023', message = 'All items must belong to the same customer';
    end if;

    if p_event_type = 'portal_result' then
      if v_invoice.purchase_order_number is null then
        raise exception using errcode = '23514', message = 'A purchase order is required before recording a portal result';
      end if;

      if v_invoice.status not in ('ready', 'submitted') then
        raise exception using errcode = '23514', message = 'Invoice state does not allow a portal result';
      end if;

      if v_invoice.status = 'submitted' then
        if v_invoice.portal_reference is distinct from v_portal_reference then
          raise exception using errcode = '23514', message = 'Portal reference cannot change after submission';
        end if;
        if (case v_invoice.portal_status when 'received' then 1 when 'under_review' then 2 else 0 end)
           > (case v_portal_status when 'received' then 1 when 'under_review' then 2 when 'accepted' then 3 else 0 end) then
          raise exception using errcode = '23514', message = 'Portal status cannot move backwards';
        end if;
      end if;

      update public.invoices
      set status = case
            when v_portal_status = 'accepted' then 'accepted'::public.invoice_status
            else 'submitted'::public.invoice_status
          end,
          portal_reference = v_portal_reference,
          portal_status = v_portal_status,
          exception_code = null,
          exception_message = null,
          version = version + 1,
          updated_at = now()
      where id = v_invoice.id;
    else
      if v_invoice.status not in ('ready', 'needs_attention') then
        raise exception using errcode = '23514', message = 'Invoice state does not allow a portal exception';
      end if;

      update public.invoices
      set status = 'needs_attention',
          exception_code = v_exception_code,
          exception_message = v_exception_message,
          version = version + 1,
          updated_at = now()
      where id = v_invoice.id;
    end if;

    v_result_items := v_result_items || jsonb_build_array(jsonb_build_object(
      'invoiceNumber', v_invoice.invoice_number,
      'recorded', true
    ));
  end loop;

  v_result := jsonb_build_object(
    'eventType', p_event_type,
    'items', v_result_items,
    'recordedAt', now()
  );

  insert into public.delivery_events (
    organization_id, customer_id, event_type, idempotency_key,
    request_fingerprint, payload, result, actor_user_id
  ) values (
    v_organization_id, v_customer_id, p_event_type, p_idempotency_key,
    p_request_fingerprint, p_payload, v_result, v_user_id
  );

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_organization_id, v_user_id, 'delivery_event_recorded', 'customer',
    v_customer_id::text, jsonb_build_object('eventType', p_event_type, 'itemCount', jsonb_array_length(p_payload->'items'))
  );

  return v_result;
end;
$$;

revoke execute on function private.record_delivery_event(public.delivery_event_type, text, text, jsonb)
  from public, anon;
grant execute on function private.record_delivery_event(public.delivery_event_type, text, text, jsonb)
  to authenticated;

commit;
