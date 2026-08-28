begin;

create extension if not exists pgcrypto with schema extensions;

create type public.invoice_status as enum (
  'ready',
  'needs_attention',
  'submitted',
  'accepted',
  'rejected'
);

create type public.delivery_event_type as enum (
  'portal_result',
  'portal_exception'
);

create table public.organizations (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null check (char_length(full_name) between 1 and 160),
  role text not null check (role in ('admin', 'operator', 'viewer')),
  created_at timestamptz not null default now()
);

create index profiles_organization_id_idx on public.profiles (organization_id);

create table public.customers (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  portal_origin text not null check (portal_origin ~ '^https://'),
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index customers_organization_id_idx on public.customers (organization_id);

create table public.invoices (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  invoice_number text not null check (invoice_number ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  invoice_date date not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  purchase_order_number text check (
    purchase_order_number is null or purchase_order_number ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
  ),
  status public.invoice_status not null,
  document_name text not null check (document_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  document_media_type text not null check (document_media_type = 'application/pdf'),
  document_content_base64 text not null check (octet_length(document_content_base64) <= 1400000),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  portal_reference text,
  portal_status text,
  exception_code text,
  exception_message text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_number)
);

create index invoices_queue_idx
  on public.invoices (organization_id, customer_id, status, invoice_date, invoice_number);

create table public.delivery_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  event_type public.delivery_event_type not null,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  payload jsonb not null,
  result jsonb not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index delivery_events_customer_created_idx
  on public.delivery_events (organization_id, customer_id, created_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (char_length(action) between 1 and 80),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id text not null check (char_length(entity_id) between 1 and 160),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_org_created_idx
  on public.audit_events (organization_id, created_at desc);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.invoices enable row level security;
alter table public.delivery_events enable row level security;
alter table public.audit_events enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on public.organizations, public.profiles, public.customers,
  public.invoices, public.delivery_events, public.audit_events from authenticated;

grant select on public.organizations, public.profiles, public.customers,
  public.invoices, public.delivery_events, public.audit_events to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles as p
  where p.user_id = (select auth.uid())
$$;

revoke execute on function private.current_organization_id() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_organization_id() to authenticated;

create policy organizations_select_member
  on public.organizations for select to authenticated
  using (id = (select private.current_organization_id()));

create policy profiles_select_member
  on public.profiles for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy customers_select_member
  on public.customers for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy invoices_select_member
  on public.invoices for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy delivery_events_select_member
  on public.delivery_events for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy audit_events_select_member
  on public.audit_events for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create function private.record_delivery_event(
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
  v_result_items jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128 then
    raise exception using errcode = '22023', message = 'Invalid idempotency key';
  end if;

  if p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid request fingerprint';
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

  if jsonb_typeof(p_payload->'items') <> 'array'
     or jsonb_array_length(p_payload->'items') not between 1 and 10 then
    raise exception using errcode = '22023', message = 'items must contain between 1 and 10 entries';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload->'items')
  loop
    select i.* into v_invoice
    from public.invoices as i
    where i.organization_id = v_organization_id
      and i.invoice_number = v_item->>'invoiceNumber'
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
      if coalesce(v_item->>'portalReference', '') = '' then
        raise exception using errcode = '22023', message = 'portalReference is required';
      end if;

      update public.invoices
      set status = case
            when v_item->>'portalStatus' = 'accepted' then 'accepted'::public.invoice_status
            else 'submitted'::public.invoice_status
          end,
          portal_reference = v_item->>'portalReference',
          portal_status = v_item->>'portalStatus',
          exception_code = null,
          exception_message = null,
          version = version + 1,
          updated_at = now()
      where id = v_invoice.id;
    else
      if coalesce(v_item->>'exceptionCode', '') = ''
         or coalesce(v_item->>'message', '') = '' then
        raise exception using errcode = '22023', message = 'Exception code and message are required';
      end if;

      update public.invoices
      set status = 'needs_attention',
          exception_code = v_item->>'exceptionCode',
          exception_message = v_item->>'message',
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

create function public.record_delivery_event(
  p_event_type public.delivery_event_type,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_delivery_event($1, $2, $3, $4)
$$;

revoke execute on function public.record_delivery_event(public.delivery_event_type, text, text, jsonb)
  from public, anon;
grant execute on function public.record_delivery_event(public.delivery_event_type, text, text, jsonb)
  to authenticated;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id constant uuid := '10000000-0000-4000-8000-000000000001';
begin
  if lower(new.email) = 'demo@openfinance.dev' then
    insert into public.profiles (user_id, organization_id, full_name, role)
    values (new.id, v_organization_id, 'Sarah Cohen', 'operator')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Example Supplier Ltd');

insert into public.customers (id, organization_id, name, portal_origin) values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Acme Manufacturing',
    'https://openfinance-ap.vercel.app'
  );

with invoice_seed(invoice_id, invoice_number, invoice_date, amount_minor, purchase_order_number, status) as (
  values
    ('30000000-0000-4000-8000-000000000001'::uuid, 'INV-10482', '2026-08-12'::date, 1842000::bigint, 'PO-8821', 'ready'::public.invoice_status),
    ('30000000-0000-4000-8000-000000000002'::uuid, 'INV-10491', '2026-08-14'::date, 725000::bigint, 'PO-8844', 'ready'::public.invoice_status),
    ('30000000-0000-4000-8000-000000000003'::uuid, 'INV-10503', '2026-08-18'::date, 1290000::bigint, null, 'needs_attention'::public.invoice_status),
    ('30000000-0000-4000-8000-000000000004'::uuid, 'INV-10507', '2026-08-20'::date, 1290000::bigint, 'PO-8890', 'ready'::public.invoice_status)
), documents as (
  select *, convert_to(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% OpenFinance demo invoice ' || invoice_number || '\n%%EOF',
    'UTF8'
  ) as document_bytes
  from invoice_seed
)
insert into public.invoices (
  id, organization_id, customer_id, invoice_number, invoice_date,
  amount_minor, currency, purchase_order_number, status,
  document_name, document_media_type, document_content_base64, document_sha256,
  exception_code, exception_message
)
select
  invoice_id,
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  invoice_number,
  invoice_date,
  amount_minor,
  'USD',
  purchase_order_number,
  status,
  invoice_number || '.pdf',
  'application/pdf',
  encode(document_bytes, 'base64'),
  encode(extensions.digest(document_bytes, 'sha256'), 'hex'),
  case when purchase_order_number is null then 'missing_purchase_order' end,
  case when purchase_order_number is null then 'Add a valid purchase order before portal submission.' end
from documents;

commit;
