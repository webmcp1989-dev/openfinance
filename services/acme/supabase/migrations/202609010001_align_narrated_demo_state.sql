begin;

-- Preserve the canonical reset implementation and add only the deterministic
-- simulator phase required by the narrated two-invoice demonstration. The
-- seeded historical exception submissions remain outside the live sequence.
alter function private.reset_demo_state()
  rename to reset_demo_state_before_narrated_alignment;
revoke execute on function private.reset_demo_state_before_narrated_alignment()
  from public, anon, authenticated;

create function private.reset_demo_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_supplier_id uuid;
begin
  v_result := private.reset_demo_state_before_narrated_alignment();
  select profile.supplier_id into v_supplier_id
  from public.profiles as profile
  where profile.user_id = auth.uid() and profile.role in ('admin', 'submitter');
  if v_supplier_id is null then
    raise exception using errcode = '42501', message = 'Submitter access required';
  end if;

  -- Sequence two is the first live slot. Therefore the first invoice in the
  -- exact approved pair receives the one deterministic payment signal.
  update private.payment_simulator_state
  set next_sequence = 2
  where supplier_id = v_supplier_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Demo payment state is incomplete';
  end if;

  return v_result || jsonb_build_object('nextPaymentSequence', 2);
end;
$$;

revoke execute on function private.reset_demo_state() from public, anon;
grant execute on function private.reset_demo_state() to authenticated;

-- Keep the existing every-second rule while making the canonical paid invoice
-- and remittance reference stable across resets and recordings.
create or replace function private.schedule_demo_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_sequence_number bigint;
  v_payment_reference text;
  v_scheduled_for timestamptz;
begin
  if v_actor_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  insert into private.payment_simulator_state (supplier_id, next_sequence)
  values (new.supplier_id, 2)
  on conflict (supplier_id) do update
    set next_sequence = private.payment_simulator_state.next_sequence + 1
  returning next_sequence - 1 into v_sequence_number;

  if mod(v_sequence_number, 2) = 0 then
    v_scheduled_for := statement_timestamp() + interval '10 seconds';
    v_payment_reference := case
      when new.invoice_number = 'INV-10482' then 'PAY-20260830-0DD9D23B'
      else 'PAY-' || to_char(current_date, 'YYYYMMDD') || '-' ||
        upper(substr(encode(extensions.digest(convert_to(new.id::text, 'UTF8'), 'sha256'), 'hex'), 1, 8))
    end;
    insert into public.payment_settlements (
      invoice_submission_id, buyer_id, supplier_id, sequence_number,
      scheduled_for, payment_reference, amount_minor, currency, payment_method
    ) values (
      new.id, new.buyer_id, new.supplier_id, v_sequence_number,
      v_scheduled_for, v_payment_reference, new.amount_minor, new.currency, 'ach'
    );
    insert into public.invoice_status_events (
      buyer_id, supplier_id, invoice_submission_id, status, event_code,
      message, actor_kind
    ) values (
      new.buyer_id, new.supplier_id, new.id, 'payment_scheduled',
      'synthetic_payment_scheduled',
      'Synthetic ACH payment is scheduled for ' || v_scheduled_for || '.', 'system'
    );
    insert into public.audit_events (
      buyer_id, supplier_id, actor_user_id, action, entity_type, entity_id, details
    ) values (
      new.buyer_id, new.supplier_id, v_actor_user_id, 'demo_payment_scheduled',
      'invoice_submission', new.id::text,
      jsonb_build_object(
        'invoiceNumber', new.invoice_number,
        'paymentReference', v_payment_reference,
        'scheduledFor', v_scheduled_for,
        'simulatorSequence', v_sequence_number
      )
    );
  end if;
  return new;
end;
$$;

revoke execute on function private.schedule_demo_payment()
  from public, anon, authenticated;

-- A UI-only read model lists durable buyer cases without changing any WebMCP
-- tool schema or response. Tenant identity is always derived from auth.uid().
create function private.get_open_buyer_cases()
returns table (
  case_reference text,
  invoice_number text,
  inquiry_type text,
  owner text,
  status text,
  subject text,
  opened_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    inquiry.case_reference,
    submission.invoice_number,
    inquiry.inquiry_type,
    coalesce(exception.owner, 'buyer_ap') as owner,
    inquiry.status,
    inquiry.subject,
    inquiry.created_at
  from public.invoice_inquiries as inquiry
  join public.invoice_submissions as submission
    on submission.id = inquiry.invoice_submission_id
  left join lateral (
    select candidate.owner
    from public.invoice_exceptions as candidate
    where candidate.invoice_submission_id = submission.id
      and candidate.owner in ('buyer_receiving', 'buyer_procurement', 'buyer_ap')
      and candidate.status in ('open', 'responded')
    order by candidate.updated_at desc, candidate.id desc
    limit 1
  ) as exception on true
  where inquiry.supplier_id = (select private.current_supplier_id())
    and inquiry.status in ('open', 'in_progress')
    and submission.is_current
  order by inquiry.created_at desc, inquiry.id desc
$$;

revoke execute on function private.get_open_buyer_cases()
  from public, anon;
grant execute on function private.get_open_buyer_cases()
  to authenticated;

create function public.get_open_buyer_cases()
returns table (
  case_reference text,
  invoice_number text,
  inquiry_type text,
  owner text,
  status text,
  subject text,
  opened_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_open_buyer_cases()
$$;

revoke execute on function public.get_open_buyer_cases()
  from public, anon;
grant execute on function public.get_open_buyer_cases()
  to authenticated;

commit;
