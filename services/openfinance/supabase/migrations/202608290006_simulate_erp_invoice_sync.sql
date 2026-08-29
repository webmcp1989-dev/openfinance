begin;

create table public.erp_sync_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  next_invoice_sequence bigint not null default 1 check (next_invoice_sequence > 0),
  next_sync_has_invoices boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_id)
);

create table public.erp_sync_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  result jsonb not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index erp_sync_events_org_created_idx
  on public.erp_sync_events (organization_id, created_at desc);

alter table public.erp_sync_state enable row level security;
alter table public.erp_sync_events enable row level security;

revoke all on public.erp_sync_state, public.erp_sync_events from public, anon, authenticated;

create function private.sync_invoices_from_erp(p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_state public.erp_sync_state%rowtype;
  v_existing public.erp_sync_events%rowtype;
  v_customer_name text;
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
  v_sequence bigint;
  v_offset integer;
  v_invoice_number text;
  v_purchase_order_number text;
  v_amount_minor bigint;
  v_document_bytes bytea;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Invalid idempotency key';
  end if;

  select p.organization_id into v_organization_id
  from public.profiles as p
  where p.user_id = v_user_id and p.role in ('admin', 'operator');

  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Operator access required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_organization_id::text || ':erp-sync:' || p_idempotency_key,
    0
  ));

  select e.* into v_existing
  from public.erp_sync_events as e
  where e.organization_id = v_organization_id
    and e.idempotency_key = p_idempotency_key;

  if found then
    return v_existing.result;
  end if;

  select s.* into v_state
  from public.erp_sync_state as s
  where s.organization_id = v_organization_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ERP sync is not configured';
  end if;

  select c.name into v_customer_name
  from public.customers as c
  where c.id = v_state.customer_id
    and c.organization_id = v_organization_id;

  if v_customer_name is null then
    raise exception using errcode = 'P0002', message = 'ERP sync customer is not configured';
  end if;

  if v_state.next_sync_has_invoices then
    for v_offset in 0..1 loop
      v_sequence := v_state.next_invoice_sequence + v_offset;
      v_invoice_number := 'ERP-' || lpad(v_sequence::text, 6, '0');
      v_purchase_order_number := case mod(v_sequence - 1, 3)
        when 0 then 'PO-8821'
        when 1 then 'PO-8844'
        else 'PO-8890'
      end;
      v_amount_minor := 125000 + mod(v_sequence - 1, 5) * 25000;
      v_document_bytes := convert_to(
        '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% Synthetic ERP invoice ' ||
        v_invoice_number || '\n%%EOF',
        'UTF8'
      );

      insert into public.invoices (
        organization_id, customer_id, invoice_number, invoice_date,
        amount_minor, currency, purchase_order_number, status,
        document_name, document_media_type, document_content_base64,
        document_sha256
      ) values (
        v_organization_id, v_state.customer_id, v_invoice_number, current_date,
        v_amount_minor, 'USD', v_purchase_order_number, 'ready',
        v_invoice_number || '.pdf', 'application/pdf',
        encode(v_document_bytes, 'base64'),
        encode(extensions.digest(v_document_bytes, 'sha256'), 'hex')
      );

      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'invoiceNumber', v_invoice_number,
        'customerName', v_customer_name,
        'amountMinor', v_amount_minor,
        'currency', 'USD',
        'purchaseOrderNumber', v_purchase_order_number
      ));
    end loop;
  end if;

  update public.erp_sync_state
  set next_invoice_sequence = case
        when v_state.next_sync_has_invoices then v_state.next_invoice_sequence + 2
        else v_state.next_invoice_sequence
      end,
      next_sync_has_invoices = not v_state.next_sync_has_invoices,
      updated_at = now()
  where organization_id = v_organization_id;

  v_result := jsonb_build_object(
    'importedCount', jsonb_array_length(v_items),
    'items', v_items,
    'syncedAt', now()
  );

  insert into public.erp_sync_events (
    organization_id, idempotency_key, result, actor_user_id
  ) values (
    v_organization_id, p_idempotency_key, v_result, v_user_id
  );

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_organization_id, v_user_id, 'erp_invoice_sync_completed', 'erp_connection',
    v_state.customer_id::text,
    jsonb_build_object('itemCount', jsonb_array_length(v_items))
  );

  return v_result;
end;
$$;

revoke execute on function private.sync_invoices_from_erp(text) from public, anon;
grant execute on function private.sync_invoices_from_erp(text) to authenticated;

create function public.sync_invoices_from_erp(p_idempotency_key text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.sync_invoices_from_erp($1)
$$;

revoke execute on function public.sync_invoices_from_erp(text) from public, anon;
grant execute on function public.sync_invoices_from_erp(text) to authenticated;

insert into public.erp_sync_state (
  organization_id, customer_id, next_invoice_sequence, next_sync_has_invoices
) values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  1,
  true
);

commit;
