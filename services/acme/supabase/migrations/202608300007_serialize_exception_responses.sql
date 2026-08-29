begin;

create or replace function private.respond_to_invoice_exception(
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

  perform pg_advisory_xact_lock(hashtextextended(
    v_supplier_id::text || ':exception-response:' || p_idempotency_key,
    0
  ));
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
       or position(convert_to('%%EOF', 'UTF8') in substring(v_bytes from greatest(1, octet_length(v_bytes) - 1023))) = 0
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

commit;
