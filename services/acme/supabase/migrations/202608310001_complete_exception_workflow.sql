begin;

-- A supplier response is not automatically an approval in the general case.
-- The portal may resolve the exception only when it requested a specific
-- evidence kind and the existing authoritative mutation has validated and
-- persisted a structurally valid document of exactly that kind. If no other
-- actionable exception remains, the disputed invoice can then be accepted.
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
  v_exception public.invoice_exceptions%rowtype;
  v_submission public.invoice_submissions%rowtype;
  v_result jsonb;
  v_resolved_at timestamptz;
  v_invoice_status text;
  v_invoice_accepted boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  select profile.supplier_id into v_supplier_id
  from public.profiles as profile
  where profile.user_id = v_user_id and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Submitter access required';
  end if;

  select exception.* into v_exception
  from public.invoice_exceptions as exception
  join public.invoice_submissions as submission
    on submission.id = exception.invoice_submission_id
  where exception.supplier_id = v_supplier_id
    and submission.invoice_number = p_payload->>'invoiceNumber'
    and submission.is_current
    and exception.exception_code = p_payload->>'exceptionCode'
  for update of exception;
  if not found then
    raise exception using errcode = 'P0002', message = 'Open invoice exception not found';
  end if;

  if v_exception.owner not in ('supplier_ar', 'shared')
     or not ('respond_to_exception' = any(v_exception.allowed_actions)) then
    raise exception using errcode = 'P0001',
      message = 'This isn''t mine to fix. The buyer owns this blocker; open a tracked AP inquiry instead.';
  end if;
  if v_exception.required_document_kind is not null and not exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'attachments', '[]'::jsonb)) as attachment(value)
    where attachment.value->>'documentKind' = v_exception.required_document_kind
  ) then
    raise exception using errcode = '23514',
      message = 'The required supporting document is missing from this exception response.';
  end if;

  -- This mutation performs idempotency locking, message and attachment
  -- validation, checksum/structure enforcement, persistence, and audit.
  v_result := private.respond_to_invoice_exception_unchecked(
    p_idempotency_key, p_request_fingerprint, p_payload
  );

  -- Identical retries return the final stored outcome without duplicating the
  -- acceptance timeline or audit event.
  if v_result->>'exceptionStatus' = 'resolved' then
    return v_result;
  end if;

  select submission.* into strict v_submission
  from public.invoice_submissions as submission
  where submission.id = v_exception.invoice_submission_id;

  if v_exception.required_document_kind is not null then
    v_resolved_at := statement_timestamp();
    update public.invoice_exceptions
    set status = 'resolved', resolved_at = v_resolved_at, updated_at = v_resolved_at
    where id = v_exception.id and status = 'responded';

    if not exists (
      select 1
      from public.invoice_exceptions as other_exception
      where other_exception.invoice_submission_id = v_submission.id
        and other_exception.id <> v_exception.id
        and other_exception.status in ('open', 'responded')
    ) and v_submission.status = 'disputed' then
      update public.invoice_submissions
      set status = 'accepted', updated_at = v_resolved_at
      where id = v_submission.id and status = 'disputed';
      v_invoice_accepted := found;
    end if;

    select submission.status::text into strict v_invoice_status
    from public.invoice_submissions as submission
    where submission.id = v_submission.id;

    if v_invoice_accepted then
      insert into public.invoice_status_events (
        buyer_id, supplier_id, invoice_submission_id, status, event_code,
        message, actor_kind, created_at
      ) values (
        v_submission.buyer_id, v_submission.supplier_id, v_submission.id,
        'accepted', 'supplier_evidence_approved',
        'Acme verified the required supplier evidence, resolved the exception, and approved the invoice.',
        'system', v_resolved_at
      );
    end if;

    insert into public.audit_events (
      buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id,
      details, created_at
    ) values (
      v_submission.buyer_id, v_submission.supplier_id, v_user_id,
      'invoice_exception_resolved', 'invoice_exception', v_exception.id::text,
      jsonb_build_object(
        'invoiceNumber', v_submission.invoice_number,
        'exceptionCode', v_exception.exception_code,
        'invoiceStatus', v_invoice_status,
        'resolution', 'required_evidence_verified'
      ),
      v_resolved_at
    );

    v_result := v_result || jsonb_build_object(
      'exceptionStatus', 'resolved',
      'invoiceStatus', v_invoice_status,
      'resolvedAt', v_resolved_at,
      'resolution', 'required_evidence_verified'
    );
    update public.invoice_exception_responses
    set result = v_result
    where supplier_id = v_supplier_id and idempotency_key = p_idempotency_key;
  else
    v_result := v_result || jsonb_build_object(
      'invoiceStatus', v_submission.status::text,
      'resolution', 'buyer_review_required'
    );
    update public.invoice_exception_responses
    set result = v_result
    where supplier_id = v_supplier_id and idempotency_key = p_idempotency_key;
  end if;

  return v_result;
end;
$$;

revoke execute on function private.respond_to_invoice_exception(text, text, jsonb)
  from public, anon;
grant execute on function private.respond_to_invoice_exception(text, text, jsonb)
  to authenticated;

-- One tenant-scoped read model gives the interface the current exception,
-- invoice, and latest case state without client-side joins or per-row queries.
create or replace function private.get_invoice_workflow_items()
returns table (
  invoice_number text,
  portal_reference text,
  amount_minor bigint,
  currency text,
  invoice_status text,
  exception_code text,
  exception_category text,
  exception_owner text,
  exception_status text,
  exception_message text,
  resolution_guidance text,
  allowed_actions text[],
  required_document_kind text,
  exception_created_at timestamptz,
  exception_updated_at timestamptz,
  case_reference text,
  case_status text,
  case_subject text,
  case_created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    submission.invoice_number,
    submission.portal_reference,
    submission.amount_minor,
    submission.currency,
    submission.status::text,
    exception.exception_code,
    exception.category,
    exception.owner,
    exception.status,
    exception.message,
    exception.resolution_guidance,
    exception.allowed_actions,
    exception.required_document_kind,
    exception.created_at,
    exception.updated_at,
    latest_inquiry.case_reference,
    latest_inquiry.status,
    latest_inquiry.subject,
    latest_inquiry.created_at
  from public.invoice_exceptions as exception
  join public.invoice_submissions as submission
    on submission.id = exception.invoice_submission_id
  left join lateral (
    select inquiry.case_reference, inquiry.status, inquiry.subject, inquiry.created_at
    from public.invoice_inquiries as inquiry
    where inquiry.invoice_submission_id = submission.id
    order by inquiry.created_at desc, inquiry.id desc
    limit 1
  ) as latest_inquiry on true
  where exception.supplier_id = (select private.current_supplier_id())
    and submission.is_current
  order by
    case exception.status when 'open' then 0 when 'responded' then 1 else 2 end,
    exception.updated_at desc,
    submission.invoice_number
$$;

revoke execute on function private.get_invoice_workflow_items()
  from public, anon;
grant execute on function private.get_invoice_workflow_items()
  to authenticated;

create or replace function public.get_invoice_workflow_items()
returns table (
  invoice_number text,
  portal_reference text,
  amount_minor bigint,
  currency text,
  invoice_status text,
  exception_code text,
  exception_category text,
  exception_owner text,
  exception_status text,
  exception_message text,
  resolution_guidance text,
  allowed_actions text[],
  required_document_kind text,
  exception_created_at timestamptz,
  exception_updated_at timestamptz,
  case_reference text,
  case_status text,
  case_subject text,
  case_created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_invoice_workflow_items()
$$;

revoke execute on function public.get_invoice_workflow_items()
  from public, anon;
grant execute on function public.get_invoice_workflow_items()
  to authenticated;

commit;
