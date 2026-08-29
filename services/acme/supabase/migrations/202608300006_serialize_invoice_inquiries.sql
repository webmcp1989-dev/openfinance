begin;

create or replace function private.create_invoice_inquiry(
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

  perform pg_advisory_xact_lock(hashtextextended(
    v_supplier_id::text || ':invoice-inquiry:' || p_idempotency_key,
    0
  ));
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

commit;
