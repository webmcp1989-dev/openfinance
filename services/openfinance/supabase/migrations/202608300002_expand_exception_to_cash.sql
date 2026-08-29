begin;

alter table public.invoices
  add column due_date date,
  add column last_portal_checked_at timestamptz,
  add column paid_amount_minor bigint not null default 0
    check (paid_amount_minor >= 0 and paid_amount_minor <= amount_minor),
  add column last_payment_at timestamptz,
  add column last_payment_reference text;

update public.invoices
set due_date = invoice_date + 30
where due_date is null;

alter table public.invoices alter column due_date set not null;

create table public.invoice_supporting_documents (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  document_kind text not null check (document_kind in (
    'proof_of_delivery', 'service_acceptance', 'timesheet', 'tax_document', 'contract', 'other'
  )),
  file_name text not null check (file_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  media_type text not null check (media_type = 'application/pdf'),
  content_base64 text not null check (octet_length(content_base64) <= 1400000),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer not null check (size_bytes between 1 and 1048576),
  created_at timestamptz not null default now(),
  unique (invoice_id, document_kind, sha256)
);

create index invoice_supporting_documents_org_invoice_idx
  on public.invoice_supporting_documents (organization_id, invoice_id, created_at);

create table public.payment_remittance_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  payment_reference text not null check (char_length(payment_reference) between 1 and 120),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_method text not null check (payment_method in ('ach', 'wire', 'check', 'card', 'other')),
  paid_at timestamptz not null,
  payload jsonb not null,
  result jsonb not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (organization_id, payment_reference, invoice_id)
);

create index payment_remittance_events_org_invoice_idx
  on public.payment_remittance_events (organization_id, invoice_id, paid_at desc);

alter table public.invoice_supporting_documents enable row level security;
alter table public.payment_remittance_events enable row level security;

revoke all on public.invoice_supporting_documents, public.payment_remittance_events
  from public, anon, authenticated;
grant select on public.invoice_supporting_documents, public.payment_remittance_events
  to authenticated;

create policy supporting_documents_select_member
  on public.invoice_supporting_documents for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy remittance_events_select_member
  on public.payment_remittance_events for select to authenticated
  using (organization_id = (select private.current_organization_id()));

create function private.record_payment_remittance(
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
  v_invoice public.invoices%rowtype;
  v_existing public.payment_remittance_events%rowtype;
  v_amount_minor bigint;
  v_paid_at timestamptz;
  v_total_paid bigint;
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

  select profile.organization_id into v_organization_id
  from public.profiles as profile
  where profile.user_id = v_user_id and profile.role in ('admin', 'operator');
  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'Operator access required';
  end if;

  select event.* into v_existing
  from public.payment_remittance_events as event
  where event.organization_id = v_organization_id
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key reused with different payload';
    end if;
    return v_existing.result;
  end if;

  begin
    v_amount_minor := (p_payload->>'amountMinor')::bigint;
    v_paid_at := (p_payload->>'paidAt')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'Invalid payment values';
  end;

  if coalesce(p_payload->>'invoiceNumber', '') !~ '^[A-Z0-9][A-Z0-9-]{1,39}$'
     or coalesce(p_payload->>'paymentReference', '') = ''
     or char_length(p_payload->>'paymentReference') > 120
     or (p_payload->>'currency') !~ '^[A-Z]{3}$'
     or (p_payload->>'paymentMethod') not in ('ach', 'wire', 'check', 'card', 'other')
     or v_amount_minor <= 0 then
    raise exception using errcode = '22023', message = 'Invalid remittance fields';
  end if;

  select invoice.* into v_invoice
  from public.invoices as invoice
  where invoice.organization_id = v_organization_id
    and invoice.invoice_number = p_payload->>'invoiceNumber'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Invoice not found';
  end if;
  if v_invoice.portal_reference is null then
    raise exception using errcode = '23514', message = 'Invoice has no verified portal receipt';
  end if;
  if v_invoice.currency <> p_payload->>'currency' then
    raise exception using errcode = '23514', message = 'Payment currency does not match invoice';
  end if;

  select coalesce(sum(event.amount_minor), 0) + v_amount_minor into v_total_paid
  from public.payment_remittance_events as event
  where event.invoice_id = v_invoice.id;
  if v_total_paid > v_invoice.amount_minor then
    raise exception using errcode = '23514', message = 'Payment exceeds invoice amount';
  end if;

  v_result := jsonb_build_object(
    'invoiceNumber', v_invoice.invoice_number,
    'paymentReference', p_payload->>'paymentReference',
    'amountMinor', v_amount_minor,
    'currency', v_invoice.currency,
    'paymentMethod', p_payload->>'paymentMethod',
    'paidAt', v_paid_at,
    'totalPaidMinor', v_total_paid,
    'remainingDueMinor', v_invoice.amount_minor - v_total_paid,
    'paymentStatus', case when v_total_paid = v_invoice.amount_minor then 'paid' else 'partially_paid' end,
    'recordedAt', statement_timestamp()
  );

  insert into public.payment_remittance_events (
    organization_id, customer_id, invoice_id, idempotency_key, request_fingerprint,
    payment_reference, amount_minor, currency, payment_method, paid_at,
    payload, result, actor_user_id
  ) values (
    v_organization_id, v_invoice.customer_id, v_invoice.id, p_idempotency_key,
    p_request_fingerprint, p_payload->>'paymentReference', v_amount_minor,
    v_invoice.currency, p_payload->>'paymentMethod', v_paid_at,
    p_payload, v_result, v_user_id
  );

  update public.invoices
  set paid_amount_minor = v_total_paid,
      last_payment_at = v_paid_at,
      last_payment_reference = p_payload->>'paymentReference',
      portal_status = case when v_total_paid = amount_minor then 'paid' else 'partially_paid' end,
      last_portal_checked_at = statement_timestamp(),
      version = version + 1,
      updated_at = statement_timestamp()
  where id = v_invoice.id;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_organization_id, v_user_id, 'payment_remittance_recorded', 'invoice',
    v_invoice.id::text,
    jsonb_build_object(
      'invoiceNumber', v_invoice.invoice_number,
      'paymentReference', p_payload->>'paymentReference',
      'amountMinor', v_amount_minor,
      'totalPaidMinor', v_total_paid
    )
  );

  return v_result;
end;
$$;

revoke execute on function private.record_payment_remittance(text, text, jsonb)
  from public, anon;
grant execute on function private.record_payment_remittance(text, text, jsonb)
  to authenticated;

create function public.record_payment_remittance(
  p_idempotency_key text,
  p_request_fingerprint text,
  p_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_payment_remittance($1, $2, $3)
$$;

revoke execute on function public.record_payment_remittance(text, text, jsonb)
  from public, anon;
grant execute on function public.record_payment_remittance(text, text, jsonb)
  to authenticated;

insert into public.invoice_supporting_documents (
  organization_id, invoice_id, document_kind, file_name, media_type,
  content_base64, sha256, size_bytes
)
select
  invoice.organization_id,
  invoice.id,
  'proof_of_delivery',
  invoice.invoice_number || '-proof-of-delivery.pdf',
  invoice.document_media_type,
  invoice.document_content_base64,
  invoice.document_sha256,
  octet_length(decode(replace(replace(replace(replace(invoice.document_content_base64, E'\n', ''), E'\r', ''), E'\t', ''), ' ', ''), 'base64'))
from public.invoices as invoice
where invoice.invoice_number = 'INV-10482'
on conflict do nothing;

commit;
