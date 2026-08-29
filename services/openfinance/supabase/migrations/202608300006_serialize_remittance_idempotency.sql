begin;

create or replace function private.record_payment_remittance(
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

  perform pg_advisory_xact_lock(hashtextextended(
    v_organization_id::text || ':payment-remittance:' || p_idempotency_key,
    0
  ));
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

commit;
