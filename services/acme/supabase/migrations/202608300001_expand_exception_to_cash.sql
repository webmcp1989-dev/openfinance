alter type public.invoice_submission_status add value if not exists 'disputed';
alter type public.invoice_submission_status add value if not exists 'voided';

begin;

alter table public.purchase_orders
  add column order_date date not null default '2026-08-01',
  add column payment_terms text not null default 'Net 30'
    check (char_length(payment_terms) between 1 and 80),
  add column receipt_required boolean not null default true,
  add column received_amount_minor bigint not null default 0
    check (received_amount_minor >= 0 and received_amount_minor <= authorized_amount_minor),
  add column service_entry_required boolean not null default false,
  add column service_entry_status text not null default 'not_required'
    check (service_entry_status in ('not_required', 'missing', 'pending', 'accepted', 'rejected')),
  add column price_tolerance_basis_points integer not null default 0
    check (price_tolerance_basis_points between 0 and 10000),
  add column amount_tolerance_minor bigint not null default 0
    check (amount_tolerance_minor >= 0),
  add column required_attachment_kinds text[] not null default '{}'::text[];

update public.purchase_orders
set received_amount_minor = case purchase_order_number
  when 'PO-8821' then authorized_amount_minor
  when 'PO-8844' then authorized_amount_minor
  else 600000
end,
service_entry_required = purchase_order_number = 'PO-8890',
service_entry_status = case when purchase_order_number = 'PO-8890' then 'pending' else 'not_required' end,
price_tolerance_basis_points = 200,
amount_tolerance_minor = 5000,
required_attachment_kinds = case
  when purchase_order_number = 'PO-8890' then array['service_acceptance']::text[]
  else '{}'::text[]
end;

create table public.purchase_order_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  description text not null check (char_length(description) between 1 and 300),
  unit_of_measure text not null check (unit_of_measure ~ '^[A-Z0-9]{1,12}$'),
  ordered_quantity numeric(18, 4) not null check (ordered_quantity > 0),
  received_quantity numeric(18, 4) not null default 0
    check (received_quantity >= 0 and received_quantity <= ordered_quantity),
  unit_price_minor bigint not null check (unit_price_minor > 0),
  line_amount_minor bigint not null check (line_amount_minor > 0),
  invoiced_amount_minor bigint not null default 0
    check (invoiced_amount_minor >= 0 and invoiced_amount_minor <= line_amount_minor),
  unique (purchase_order_id, line_number)
);

alter table public.invoice_submissions
  add column revision integer not null default 1 check (revision > 0),
  add column supersedes_submission_id uuid references public.invoice_submissions(id) on delete restrict,
  add column is_current boolean not null default true;

alter table public.invoice_submissions
  drop constraint invoice_submissions_supplier_id_invoice_number_key;

create unique index invoice_submissions_current_number_key
  on public.invoice_submissions (supplier_id, invoice_number)
  where is_current;

create index invoice_submissions_revision_idx
  on public.invoice_submissions (supplier_id, invoice_number, revision desc);

alter table public.payment_settlements
  add column amount_minor bigint,
  add column currency text,
  add column payment_method text not null default 'ach'
    check (payment_method in ('ach', 'wire', 'check', 'card', 'other'));

update public.payment_settlements as settlement
set amount_minor = submission.amount_minor,
    currency = submission.currency
from public.invoice_submissions as submission
where submission.id = settlement.invoice_submission_id;

alter table public.payment_settlements
  alter column amount_minor set not null,
  alter column currency set not null,
  add constraint payment_settlements_amount_positive check (amount_minor > 0),
  add constraint payment_settlements_currency_format check (currency ~ '^[A-Z]{3}$');

create table public.invoice_status_events (
  id bigint generated always as identity primary key,
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  invoice_submission_id uuid not null references public.invoice_submissions(id) on delete cascade,
  status text not null check (status in (
    'received', 'under_review', 'accepted', 'disputed', 'rejected', 'voided',
    'payment_scheduled', 'paid', 'inquiry_opened', 'supplier_responded'
  )),
  event_code text not null check (event_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  message text not null check (char_length(message) between 1 and 500),
  actor_kind text not null check (actor_kind in ('supplier', 'buyer', 'system')),
  created_at timestamptz not null default now()
);

create index invoice_status_events_supplier_invoice_idx
  on public.invoice_status_events (supplier_id, invoice_submission_id, created_at, id);

create table public.invoice_exceptions (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  invoice_submission_id uuid not null references public.invoice_submissions(id) on delete cascade,
  exception_code text not null check (exception_code ~ '^[a-z][a-z0-9_]{1,63}$'),
  category text not null check (category in ('supplier_data', 'purchase_order', 'receiving', 'tax', 'document', 'duplicate', 'payment', 'other')),
  owner text not null check (owner in ('supplier_ar', 'buyer_ap', 'buyer_procurement', 'buyer_receiving', 'shared')),
  status text not null default 'open' check (status in ('open', 'responded', 'resolved', 'cancelled')),
  message text not null check (char_length(message) between 1 and 500),
  resolution_guidance text not null check (char_length(resolution_guidance) between 1 and 1000),
  allowed_actions text[] not null,
  required_document_kind text check (required_document_kind is null or required_document_kind in (
    'proof_of_delivery', 'service_acceptance', 'timesheet', 'tax_document', 'contract', 'other'
  )),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_submission_id, exception_code)
);

create index invoice_exceptions_supplier_status_idx
  on public.invoice_exceptions (supplier_id, status, created_at desc);

create table public.invoice_exception_responses (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  invoice_exception_id uuid not null references public.invoice_exceptions(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  message text not null check (char_length(message) between 1 and 1000),
  result jsonb not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (supplier_id, idempotency_key)
);

create table public.invoice_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  invoice_submission_id uuid not null references public.invoice_submissions(id) on delete cascade,
  exception_response_id uuid references public.invoice_exception_responses(id) on delete cascade,
  document_kind text not null check (document_kind in (
    'proof_of_delivery', 'service_acceptance', 'timesheet', 'tax_document', 'contract', 'other'
  )),
  file_name text not null check (file_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  media_type text not null check (media_type = 'application/pdf'),
  content_base64 text not null check (octet_length(content_base64) <= 1400000),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer not null check (size_bytes between 1 and 1048576),
  created_at timestamptz not null default now(),
  unique (invoice_submission_id, document_kind, sha256)
);

create table public.invoice_inquiries (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  invoice_submission_id uuid not null references public.invoice_submissions(id) on delete cascade,
  case_reference text not null unique check (case_reference ~ '^CASE-[0-9]{8}-[A-F0-9]{8}$'),
  inquiry_type text not null check (inquiry_type in (
    'payment_inquiry', 'invoice_inquiry', 'expedite_payment', 'payment_terms', 'invoice_entry_assistance'
  )),
  subject text not null check (char_length(subject) between 1 and 160),
  message text not null check (char_length(message) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, idempotency_key)
);

create table public.invoice_replacement_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  original_submission_id uuid not null references public.invoice_submissions(id) on delete restrict,
  replacement_submission_id uuid references public.invoice_submissions(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 16 and 128),
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  result jsonb,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (supplier_id, idempotency_key)
);

alter table public.purchase_order_lines enable row level security;
alter table public.invoice_status_events enable row level security;
alter table public.invoice_exceptions enable row level security;
alter table public.invoice_exception_responses enable row level security;
alter table public.invoice_attachments enable row level security;
alter table public.invoice_inquiries enable row level security;
alter table public.invoice_replacement_requests enable row level security;

revoke all on public.purchase_order_lines, public.invoice_status_events,
  public.invoice_exceptions, public.invoice_exception_responses,
  public.invoice_attachments, public.invoice_inquiries,
  public.invoice_replacement_requests, public.payment_settlements
  from public, anon, authenticated;

grant select on public.purchase_order_lines, public.invoice_status_events,
  public.invoice_exceptions, public.invoice_exception_responses,
  public.invoice_attachments, public.invoice_inquiries,
  public.invoice_replacement_requests, public.payment_settlements
  to authenticated;

create policy purchase_order_lines_select_supplier
  on public.purchase_order_lines for select to authenticated
  using (exists (
    select 1 from public.purchase_orders as purchase_order
    where purchase_order.id = purchase_order_lines.purchase_order_id
      and purchase_order.supplier_id = (select private.current_supplier_id())
  ));

create policy status_events_select_supplier
  on public.invoice_status_events for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy invoice_exceptions_select_supplier
  on public.invoice_exceptions for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy exception_responses_select_supplier
  on public.invoice_exception_responses for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy invoice_attachments_select_supplier
  on public.invoice_attachments for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy invoice_inquiries_select_supplier
  on public.invoice_inquiries for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy replacement_requests_select_supplier
  on public.invoice_replacement_requests for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

create policy payment_settlements_select_supplier
  on public.payment_settlements for select to authenticated
  using (supplier_id = (select private.current_supplier_id()));

insert into public.purchase_order_lines (
  purchase_order_id, line_number, description, unit_of_measure,
  ordered_quantity, received_quantity, unit_price_minor, line_amount_minor
)
select id, 1, description, 'EA', 1, case when purchase_order_number = 'PO-8890' then 0.6 else 1 end,
  authorized_amount_minor, authorized_amount_minor
from public.purchase_orders
on conflict do nothing;

insert into public.invoice_status_events (
  buyer_id, supplier_id, invoice_submission_id, status, event_code, message, actor_kind, created_at
)
select buyer_id, supplier_id, id, 'received', 'invoice_received',
  'Invoice was received by Acme AP.', 'system', created_at
from public.invoice_submissions;

create function private.add_submission_received_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.invoice_status_events (
    buyer_id, supplier_id, invoice_submission_id, status, event_code, message, actor_kind
  ) values (
    new.buyer_id, new.supplier_id, new.id, 'received', 'invoice_received',
    'Invoice was received by Acme AP.', 'system'
  );
  return new;
end;
$$;

revoke execute on function private.add_submission_received_event() from public, anon, authenticated;

create trigger add_submission_received_event_after_insert
  after insert on public.invoice_submissions
  for each row execute function private.add_submission_received_event();

create function private.respond_to_invoice_exception(
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
  v_supplier_id uuid;
  v_buyer_id uuid;
  v_exception public.invoice_exceptions%rowtype;
  v_submission public.invoice_submissions%rowtype;
  v_existing public.invoice_exception_responses%rowtype;
  v_response public.invoice_exception_responses%rowtype;
  v_document jsonb;
  v_bytes bytea;
  v_hash text;
  v_attachment_count integer := 0;
  v_result jsonb;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'Authentication required'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128
     or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid idempotency contract';
  end if;

  select profile.supplier_id, supplier.buyer_id into v_supplier_id, v_buyer_id
  from public.profiles as profile join public.suppliers as supplier on supplier.id = profile.supplier_id
  where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then raise exception using errcode = '42501', message = 'Submitter access required'; end if;

  select response.* into v_existing from public.invoice_exception_responses as response
  where response.supplier_id = v_supplier_id and response.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key reused with different payload';
    end if;
    return v_existing.result;
  end if;

  select exception.* into v_exception
  from public.invoice_exceptions as exception
  join public.invoice_submissions as submission on submission.id = exception.invoice_submission_id
  where exception.supplier_id = v_supplier_id
    and submission.invoice_number = p_payload->>'invoiceNumber'
    and submission.is_current
    and exception.exception_code = p_payload->>'exceptionCode'
  for update of exception;
  if not found then raise exception using errcode = 'P0002', message = 'Open invoice exception not found'; end if;
  if v_exception.status not in ('open', 'responded') then
    raise exception using errcode = '23514', message = 'Invoice exception is not actionable';
  end if;
  if coalesce(p_payload->>'message', '') = '' or char_length(p_payload->>'message') > 1000 then
    raise exception using errcode = '22023', message = 'Response message is invalid';
  end if;
  if jsonb_typeof(coalesce(p_payload->'attachments', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payload->'attachments', '[]'::jsonb)) > 3 then
    raise exception using errcode = '22023', message = 'At most three attachments are allowed';
  end if;

  select submission.* into strict v_submission
  from public.invoice_submissions as submission where submission.id = v_exception.invoice_submission_id;

  v_result := jsonb_build_object(
    'invoiceNumber', v_submission.invoice_number,
    'exceptionCode', v_exception.exception_code,
    'exceptionStatus', 'responded',
    'respondedAt', statement_timestamp()
  );
  insert into public.invoice_exception_responses (
    buyer_id, supplier_id, invoice_exception_id, idempotency_key,
    request_fingerprint, message, result, actor_user_id
  ) values (
    v_buyer_id, v_supplier_id, v_exception.id, p_idempotency_key,
    p_request_fingerprint, p_payload->>'message', v_result, v_user_id
  ) returning * into v_response;

  for v_document in select value from jsonb_array_elements(coalesce(p_payload->'attachments', '[]'::jsonb))
  loop
    if (v_document->>'documentKind') not in ('proof_of_delivery', 'service_acceptance', 'timesheet', 'tax_document', 'contract', 'other')
       or (v_document->>'fileName') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'
       or v_document->>'mediaType' <> 'application/pdf'
       or (v_document->>'sha256') !~ '^[a-f0-9]{64}$'
       or octet_length(v_document->>'contentBase64') > 1400000 then
      raise exception using errcode = '22023', message = 'Attachment metadata is invalid';
    end if;
    begin v_bytes := decode(v_document->>'contentBase64', 'base64');
    exception when others then raise exception using errcode = '22023', message = 'Attachment is not valid base64'; end;
    v_hash := encode(extensions.digest(v_bytes, 'sha256'), 'hex');
    if octet_length(v_bytes) > 1048576 or octet_length(v_bytes) < 5
       or substring(v_bytes from 1 for 5) <> convert_to('%PDF-', 'UTF8')
       or v_hash <> v_document->>'sha256' then
      raise exception using errcode = '22023', message = 'Attachment is not a valid permitted PDF';
    end if;
    insert into public.invoice_attachments (
      buyer_id, supplier_id, invoice_submission_id, exception_response_id,
      document_kind, file_name, media_type, content_base64, sha256, size_bytes
    ) values (
      v_buyer_id, v_supplier_id, v_submission.id, v_response.id,
      v_document->>'documentKind', v_document->>'fileName', v_document->>'mediaType',
      v_document->>'contentBase64', v_hash, octet_length(v_bytes)
    );
    v_attachment_count := v_attachment_count + 1;
  end loop;

  update public.invoice_exceptions set status = 'responded', updated_at = statement_timestamp()
  where id = v_exception.id;
  insert into public.invoice_status_events (
    buyer_id, supplier_id, invoice_submission_id, status, event_code, message, actor_kind
  ) values (
    v_buyer_id, v_supplier_id, v_submission.id, 'supplier_responded',
    'supplier_exception_response', 'Supplier responded to ' || v_exception.exception_code ||
      ' with ' || v_attachment_count || ' attachment(s).', 'supplier'
  );
  insert into public.audit_events (
    buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_buyer_id, v_supplier_id, v_user_id, 'invoice_exception_responded',
    'invoice_exception', v_exception.id::text,
    jsonb_build_object('invoiceNumber', v_submission.invoice_number, 'exceptionCode', v_exception.exception_code, 'attachmentCount', v_attachment_count)
  );

  v_result := v_result || jsonb_build_object('attachmentCount', v_attachment_count);
  update public.invoice_exception_responses set result = v_result where id = v_response.id;
  return v_result;
end;
$$;

create function private.create_invoice_inquiry(
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
  v_supplier_id uuid;
  v_buyer_id uuid;
  v_submission public.invoice_submissions%rowtype;
  v_existing public.invoice_inquiries%rowtype;
  v_case_reference text;
  v_result jsonb;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'Authentication required'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 128
     or p_request_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid idempotency contract';
  end if;
  select profile.supplier_id, supplier.buyer_id into v_supplier_id, v_buyer_id
  from public.profiles as profile join public.suppliers as supplier on supplier.id = profile.supplier_id
  where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then raise exception using errcode = '42501', message = 'Submitter access required'; end if;

  select inquiry.* into v_existing from public.invoice_inquiries as inquiry
  where inquiry.supplier_id = v_supplier_id and inquiry.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception using errcode = '23505', message = 'Idempotency key reused with different payload';
    end if;
    return v_existing.result;
  end if;
  if (p_payload->>'inquiryType') not in ('payment_inquiry', 'invoice_inquiry', 'expedite_payment', 'payment_terms', 'invoice_entry_assistance')
     or coalesce(p_payload->>'subject', '') = '' or char_length(p_payload->>'subject') > 160
     or coalesce(p_payload->>'message', '') = '' or char_length(p_payload->>'message') > 1000 then
    raise exception using errcode = '22023', message = 'Inquiry fields are invalid';
  end if;
  select submission.* into v_submission from public.invoice_submissions as submission
  where submission.supplier_id = v_supplier_id and submission.invoice_number = p_payload->>'invoiceNumber'
    and submission.is_current;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice submission not found'; end if;

  v_case_reference := 'CASE-' || to_char(current_date, 'YYYYMMDD') || '-' || upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));
  v_result := jsonb_build_object(
    'invoiceNumber', v_submission.invoice_number, 'caseReference', v_case_reference,
    'inquiryType', p_payload->>'inquiryType', 'status', 'open', 'createdAt', statement_timestamp()
  );
  insert into public.invoice_inquiries (
    buyer_id, supplier_id, invoice_submission_id, case_reference, inquiry_type,
    subject, message, idempotency_key, request_fingerprint, result, actor_user_id
  ) values (
    v_buyer_id, v_supplier_id, v_submission.id, v_case_reference, p_payload->>'inquiryType',
    p_payload->>'subject', p_payload->>'message', p_idempotency_key,
    p_request_fingerprint, v_result, v_user_id
  );
  insert into public.invoice_status_events (
    buyer_id, supplier_id, invoice_submission_id, status, event_code, message, actor_kind
  ) values (
    v_buyer_id, v_supplier_id, v_submission.id, 'inquiry_opened',
    'supplier_inquiry_opened', 'Supplier opened ' || (p_payload->>'inquiryType') || ' case ' || v_case_reference || '.', 'supplier'
  );
  insert into public.audit_events (
    buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id, details
  ) values (
    v_buyer_id, v_supplier_id, v_user_id, 'invoice_inquiry_created', 'invoice_inquiry',
    v_case_reference, jsonb_build_object('invoiceNumber', v_submission.invoice_number, 'inquiryType', p_payload->>'inquiryType')
  );
  return v_result;
end;
$$;

revoke execute on function private.respond_to_invoice_exception(text, text, jsonb),
  private.create_invoice_inquiry(text, text, jsonb) from public, anon;
grant execute on function private.respond_to_invoice_exception(text, text, jsonb),
  private.create_invoice_inquiry(text, text, jsonb) to authenticated;

create function public.respond_to_invoice_exception(text, text, jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.respond_to_invoice_exception($1, $2, $3) $$;

create function public.create_invoice_inquiry(text, text, jsonb)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.create_invoice_inquiry($1, $2, $3) $$;

revoke execute on function public.respond_to_invoice_exception(text, text, jsonb),
  public.create_invoice_inquiry(text, text, jsonb) from public, anon;
grant execute on function public.respond_to_invoice_exception(text, text, jsonb),
  public.create_invoice_inquiry(text, text, jsonb) to authenticated;

commit;
