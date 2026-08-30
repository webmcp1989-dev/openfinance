begin;

-- A replacement receipt may supersede either a submitted revision or a
-- rejected revision. The exact current AP reference remains the concurrency
-- token, so a stale or unrelated result still fails closed.
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
  v_item_count integer;
  v_distinct_invoice_count integer;
  v_replacement_count integer;
  v_invoice_number text;
  v_portal_reference text;
  v_portal_status text;
  v_supersedes_portal_reference text;
  v_result_items jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if p_event_type <> 'portal_result'
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ? 'items')
     or jsonb_typeof(p_payload->'items') <> 'array' then
    return private.record_delivery_event_without_replacements(
      p_event_type, p_idempotency_key, p_request_fingerprint, p_payload
    );
  end if;

  select count(*), count(*) filter (where value ? 'supersedesPortalReference')
  into v_item_count, v_replacement_count
  from jsonb_array_elements(p_payload->'items');

  if v_replacement_count = 0 then
    return private.record_delivery_event_without_replacements(
      p_event_type, p_idempotency_key, p_request_fingerprint, p_payload
    );
  end if;

  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128
     or p_request_fingerprint is null or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid idempotency contract';
  end if;
  if exists (select 1 from jsonb_object_keys(p_payload) as key where key <> 'items')
     or v_item_count not between 1 and 10
     or v_replacement_count <> v_item_count then
    raise exception using errcode = '22023', message = 'Invalid portal replacement payload';
  end if;

  select count(distinct value->>'invoiceNumber')
  into v_distinct_invoice_count
  from jsonb_array_elements(p_payload->'items');
  if v_distinct_invoice_count <> v_item_count then
    raise exception using errcode = '22023', message = 'Invoice numbers must be unique';
  end if;

  select profile.organization_id into v_organization_id
  from public.profiles as profile
  where profile.user_id = v_user_id and profile.role in ('admin', 'operator');
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Operator access required';
  end if;

  select event.* into v_existing
  from public.delivery_events as event
  where event.organization_id = v_organization_id
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key reused with different payload';
    end if;
    return v_existing.result;
  end if;

  for v_item in select value from jsonb_array_elements(p_payload->'items')
  loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array[
         'invoiceNumber', 'portalReference', 'portalStatus',
         'supersedesPortalReference'
       ])
       or exists (
         select 1 from jsonb_object_keys(v_item) as key
         where key not in (
           'invoiceNumber', 'portalReference', 'portalStatus',
           'supersedesPortalReference'
         )
       ) then
      raise exception using errcode = '22023', message = 'Invalid portal replacement fields';
    end if;

    v_invoice_number := v_item->>'invoiceNumber';
    v_portal_reference := v_item->>'portalReference';
    v_portal_status := v_item->>'portalStatus';
    v_supersedes_portal_reference := v_item->>'supersedesPortalReference';
    if v_invoice_number is null
       or v_invoice_number !~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
       or v_portal_reference is null
       or char_length(v_portal_reference) not between 1 and 120
       or v_supersedes_portal_reference is null
       or char_length(v_supersedes_portal_reference) not between 1 and 120
       or v_portal_reference = v_supersedes_portal_reference
       or v_portal_status is null
       or v_portal_status not in ('received', 'under_review', 'accepted') then
      raise exception using errcode = '22023', message = 'Invalid portal replacement fields';
    end if;

    select invoice.* into v_invoice
    from public.invoices as invoice
    where invoice.organization_id = v_organization_id
      and invoice.invoice_number = v_invoice_number
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Invoice not found';
    end if;
    if v_customer_id is null then
      v_customer_id := v_invoice.customer_id;
    elsif v_customer_id <> v_invoice.customer_id then
      raise exception using errcode = '22023', message = 'All items must belong to the same customer';
    end if;
    if v_invoice.status not in ('submitted', 'rejected')
       or v_invoice.portal_reference is distinct from v_supersedes_portal_reference then
      raise exception using errcode = '23514',
        message = 'Superseded portal reference does not match current AR state';
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
    v_customer_id::text,
    jsonb_build_object(
      'eventType', p_event_type,
      'itemCount', v_item_count,
      'replacementResult', true
    )
  );
  return v_result;
end;
$$;

revoke execute on function private.record_delivery_event(
  public.delivery_event_type, text, text, jsonb
) from public, anon;
grant execute on function private.record_delivery_event(
  public.delivery_event_type, text, text, jsonb
) to authenticated;

commit;
