begin;

create extension if not exists pgcrypto with schema extensions;

create type public.purchase_order_status as enum ('open', 'closed');
create type public.invoice_submission_status as enum ('received', 'under_review', 'accepted', 'rejected');

create table public.buyers (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now()
);

create table public.suppliers (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_code text not null check (supplier_code ~ '^[A-Z0-9-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (buyer_id, supplier_code)
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  full_name text not null check (char_length(full_name) between 1 and 160),
  role text not null check (role in ('admin', 'submitter', 'viewer')),
  created_at timestamptz not null default now()
);

create index profiles_supplier_id_idx on public.profiles (supplier_id);

create table public.purchase_orders (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_order_number text not null check (purchase_order_number ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  description text not null check (char_length(description) between 1 and 300),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  authorized_amount_minor bigint not null check (authorized_amount_minor > 0),
  remaining_amount_minor bigint not null check (
    remaining_amount_minor >= 0 and remaining_amount_minor <= authorized_amount_minor
  ),
  status public.purchase_order_status not null default 'open',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id, purchase_order_number)
);

create index purchase_orders_supplier_status_idx
  on public.purchase_orders (supplier_id, status, purchase_order_number);

create table public.submission_requirements (
  buyer_id uuid primary key references public.buyers(id) on delete cascade,
  accepted_media_types text[] not null,
  max_document_bytes integer not null check (max_document_bytes between 1024 and 10485760),
  require_open_purchase_order boolean not null default true,
  enforce_remaining_balance boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.submission_batches (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  response jsonb,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (supplier_id, idempotency_key)
);

create table public.invoice_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  batch_id uuid not null references public.submission_batches(id) on delete restrict,
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  portal_reference text not null unique check (portal_reference ~ '^ACME-[0-9]{8}-[A-F0-9]{8}$'),
  invoice_number text not null check (invoice_number ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  invoice_date date not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  document_name text not null check (document_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  document_media_type text not null check (document_media_type = 'application/pdf'),
  document_sha256 text not null check (document_sha256 ~ '^[a-f0-9]{64}$'),
  document_size_bytes integer not null check (document_size_bytes > 0),
  status public.invoice_submission_status not null default 'received',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, invoice_number)
);

create index invoice_submissions_supplier_created_idx
  on public.invoice_submissions (supplier_id, created_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null check (char_length(action) between 1 and 80),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id text not null check (char_length(entity_id) between 1 and 160),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_supplier_created_idx
  on public.audit_events (supplier_id, created_at desc);

alter table public.buyers enable row level security;
alter table public.suppliers enable row level security;
alter table public.profiles enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.submission_requirements enable row level security;
alter table public.submission_batches enable row level security;
alter table public.invoice_submissions enable row level security;
alter table public.audit_events enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on public.buyers, public.suppliers, public.profiles, public.purchase_orders,
  public.submission_requirements, public.submission_batches,
  public.invoice_submissions, public.audit_events from authenticated;

grant select on public.buyers, public.suppliers, public.profiles,
  public.purchase_orders, public.submission_requirements,
  public.submission_batches, public.invoice_submissions, public.audit_events to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.current_supplier_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.supplier_id
  from public.profiles as p
  where p.user_id = (select auth.uid())
$$;

revoke execute on function private.current_supplier_id() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_supplier_id() to authenticated;

create policy suppliers_select_self
  on public.suppliers for select to authenticated
  using (id = (select private.current_supplier_id()));

create policy profiles_select_self_supplier
  on public.profiles for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy buyers_select_for_supplier
  on public.buyers for select to authenticated
  using (
    exists (
      select 1 from public.suppliers as s
      where s.id = (select private.current_supplier_id()) and s.buyer_id = buyers.id
    )
  );

create policy purchase_orders_select_supplier
  on public.purchase_orders for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy requirements_select_supplier_buyer
  on public.submission_requirements for select to authenticated
  using (
    exists (
      select 1 from public.suppliers as s
      where s.id = (select private.current_supplier_id()) and s.buyer_id = submission_requirements.buyer_id
    )
  );

create policy batches_select_supplier
  on public.submission_batches for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy submissions_select_supplier
  on public.invoice_submissions for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy audit_select_supplier
  on public.audit_events for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create function private.submit_invoice_batch(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoices jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_supplier_id uuid;
  v_buyer_id uuid;
  v_batch public.submission_batches%rowtype;
  v_requirements public.submission_requirements%rowtype;
  v_invoice jsonb;
  v_po public.purchase_orders%rowtype;
  v_invoice_number text;
  v_amount_minor bigint;
  v_document_bytes bytea;
  v_document_sha256 text;
  v_reference text;
  v_results jsonb := '[]'::jsonb;
  v_response jsonb;
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

  if jsonb_typeof(p_invoices) <> 'array' or jsonb_array_length(p_invoices) not between 1 and 10 then
    raise exception using errcode = '22023', message = 'invoices must contain between 1 and 10 entries';
  end if;

  select p.supplier_id, s.buyer_id
  into v_supplier_id, v_buyer_id
  from public.profiles as p
  join public.suppliers as s on s.id = p.supplier_id
  where p.user_id = v_user_id and p.role in ('admin', 'submitter');

  if v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Submitter access required';
  end if;

  select b.* into v_batch
  from public.submission_batches as b
  where b.supplier_id = v_supplier_id and b.idempotency_key = p_idempotency_key;

  if found then
    if v_batch.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key reused with different payload';
    end if;
    if v_batch.response is null then
      raise exception using errcode = '40001', message = 'Submission is still being processed';
    end if;
    return v_batch.response;
  end if;

  select r.* into strict v_requirements
  from public.submission_requirements as r
  where r.buyer_id = v_buyer_id;

  insert into public.submission_batches (
    buyer_id, supplier_id, idempotency_key, request_fingerprint, actor_user_id
  ) values (
    v_buyer_id, v_supplier_id, p_idempotency_key, p_request_fingerprint, v_user_id
  ) returning * into v_batch;

  for v_invoice in select value from jsonb_array_elements(p_invoices)
  loop
    v_invoice_number := v_invoice->>'invoiceNumber';
    v_amount_minor := (v_invoice->>'amountMinor')::bigint;

    if v_invoice_number !~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
       or v_amount_minor <= 0
       or (v_invoice->>'currency') !~ '^[A-Z]{3}$'
       or (v_invoice->>'invoiceDate')::date is null then
      raise exception using errcode = '22023', message = 'Invalid invoice fields';
    end if;

    if v_invoice->'document'->>'mediaType' <> all(v_requirements.accepted_media_types) then
      raise exception using errcode = '22023', message = 'Unsupported document media type';
    end if;

    if octet_length(v_invoice->'document'->>'contentBase64') > 1400000 then
      raise exception using errcode = '22023', message = 'Encoded document exceeds limit';
    end if;

    begin
      v_document_bytes := decode(v_invoice->'document'->>'contentBase64', 'base64');
    exception when others then
      raise exception using errcode = '22023', message = 'Document is not valid base64';
    end;

    if octet_length(v_document_bytes) > v_requirements.max_document_bytes
       or octet_length(v_document_bytes) < 5
       or substring(v_document_bytes from 1 for 5) <> convert_to('%PDF-', 'UTF8') then
      raise exception using errcode = '22023', message = 'Document is not a valid permitted PDF';
    end if;

    v_document_sha256 := encode(extensions.digest(v_document_bytes, 'sha256'), 'hex');
    if v_document_sha256 <> v_invoice->'document'->>'sha256' then
      raise exception using errcode = '22023', message = 'Document checksum mismatch';
    end if;

    select po.* into v_po
    from public.purchase_orders as po
    where po.supplier_id = v_supplier_id
      and po.purchase_order_number = v_invoice->>'purchaseOrderNumber'
    for update;

    if not found or v_po.status <> 'open' then
      raise exception using errcode = '23514', message = 'Purchase order is not open for this supplier';
    end if;

    if v_po.currency <> v_invoice->>'currency' then
      raise exception using errcode = '23514', message = 'Currency does not match purchase order';
    end if;

    if v_po.remaining_amount_minor < v_amount_minor then
      raise exception using errcode = '23514', message = 'Invoice exceeds purchase order balance';
    end if;

    if exists (
      select 1 from public.invoice_submissions as existing
      where existing.supplier_id = v_supplier_id and existing.invoice_number = v_invoice_number
    ) then
      raise exception using errcode = '23505', message = 'Invoice number already submitted';
    end if;

    v_reference := 'ACME-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));

    insert into public.invoice_submissions (
      batch_id, buyer_id, supplier_id, purchase_order_id, portal_reference,
      invoice_number, invoice_date, amount_minor, currency, document_name,
      document_media_type, document_sha256, document_size_bytes
    ) values (
      v_batch.id, v_buyer_id, v_supplier_id, v_po.id, v_reference,
      v_invoice_number, (v_invoice->>'invoiceDate')::date, v_amount_minor,
      v_invoice->>'currency', v_invoice->'document'->>'fileName',
      v_invoice->'document'->>'mediaType', v_document_sha256, octet_length(v_document_bytes)
    );

    update public.purchase_orders
    set remaining_amount_minor = remaining_amount_minor - v_amount_minor,
        version = version + 1,
        updated_at = now()
    where id = v_po.id;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'invoiceNumber', v_invoice_number,
      'portalReference', v_reference,
      'portalStatus', 'received',
      'purchaseOrderNumber', v_po.purchase_order_number,
      'remainingAmountMinor', v_po.remaining_amount_minor - v_amount_minor,
      'currency', v_po.currency
    ));
  end loop;

  v_response := jsonb_build_object(
    'batchId', v_batch.id,
    'items', v_results,
    'submittedAt', now()
  );

  update public.submission_batches set response = v_response where id = v_batch.id;

  insert into public.audit_events (
    buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_buyer_id, v_supplier_id, v_user_id, 'invoice_batch_submitted',
    'submission_batch', v_batch.id::text,
    jsonb_build_object('itemCount', jsonb_array_length(p_invoices))
  );

  return v_response;
end;
$$;

revoke execute on function private.submit_invoice_batch(text, text, jsonb) from public, anon;
grant execute on function private.submit_invoice_batch(text, text, jsonb) to authenticated;

create function public.submit_invoice_batch(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_invoices jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.submit_invoice_batch($1, $2, $3)
$$;

revoke execute on function public.submit_invoice_batch(text, text, jsonb) from public, anon;
grant execute on function public.submit_invoice_batch(text, text, jsonb) to authenticated;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier_id constant uuid := '50000000-0000-4000-8000-000000000001';
begin
  if lower(new.email) = 'supplier@acme.demo' then
    insert into public.profiles (user_id, supplier_id, full_name, role)
    values (new.id, v_supplier_id, 'Sarah Cohen', 'submitter')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

insert into public.buyers (id, name) values
  ('40000000-0000-4000-8000-000000000001', 'Acme Manufacturing');

insert into public.suppliers (id, buyer_id, supplier_code, name) values
  (
    '50000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'SUP-8821',
    'Example Supplier Ltd'
  );

insert into public.submission_requirements (
  buyer_id, accepted_media_types, max_document_bytes,
  require_open_purchase_order, enforce_remaining_balance
) values (
  '40000000-0000-4000-8000-000000000001',
  array['application/pdf'],
  1048576,
  true,
  true
);

insert into public.purchase_orders (
  id, buyer_id, supplier_id, purchase_order_number, description,
  currency, authorized_amount_minor, remaining_amount_minor
) values
  (
    '60000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'PO-8821', 'Product implementation', 'USD', 2400000, 2400000
  ),
  (
    '60000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'PO-8844', 'Platform subscription', 'USD', 725000, 725000
  ),
  (
    '60000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'PO-8890', 'Advisory services', 'USD', 1000000, 1000000
  );

commit;
