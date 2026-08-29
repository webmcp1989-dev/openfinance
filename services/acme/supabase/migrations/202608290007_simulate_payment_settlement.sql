begin;

create table public.payment_settlements (
  id uuid primary key default extensions.gen_random_uuid(),
  invoice_submission_id uuid not null unique
    references public.invoice_submissions(id) on delete cascade,
  buyer_id uuid not null references public.buyers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  sequence_number bigint not null check (sequence_number > 0),
  scheduled_for timestamptz not null,
  payment_reference text not null unique
    check (payment_reference ~ '^PAY-[0-9]{8}-[A-F0-9]{8}$'),
  created_at timestamptz not null default now(),
  unique (supplier_id, sequence_number)
);

create index payment_settlements_supplier_schedule_idx
  on public.payment_settlements (supplier_id, scheduled_for desc);

create table private.payment_simulator_state (
  supplier_id uuid primary key references public.suppliers(id) on delete cascade,
  next_sequence bigint not null check (next_sequence > 0)
);

insert into private.payment_simulator_state (supplier_id, next_sequence)
select supplier.id, count(submission.id) + 1
from public.suppliers as supplier
left join public.invoice_submissions as submission on submission.supplier_id = supplier.id
group by supplier.id;

alter table public.payment_settlements enable row level security;
alter table private.payment_simulator_state enable row level security;

revoke all on public.payment_settlements from public, anon, authenticated;

create function private.schedule_demo_payment()
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
    v_payment_reference := 'PAY-' || to_char(current_date, 'YYYYMMDD') || '-' ||
      upper(substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8));

    insert into public.payment_settlements (
      invoice_submission_id, buyer_id, supplier_id, sequence_number,
      scheduled_for, payment_reference
    ) values (
      new.id, new.buyer_id, new.supplier_id, v_sequence_number,
      v_scheduled_for, v_payment_reference
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

revoke execute on function private.schedule_demo_payment() from public, anon, authenticated;

create trigger schedule_demo_payment_after_submission
  after insert on public.invoice_submissions
  for each row execute function private.schedule_demo_payment();

create function private.get_invoice_submission_statuses(p_invoice_number text default null)
returns table (
  invoice_number text,
  portal_reference text,
  purchase_order_number text,
  amount_minor bigint,
  currency text,
  status text,
  created_at timestamptz,
  settlement_expected_at timestamptz,
  paid_at timestamptz,
  payment_reference text
)
language sql
stable
security definer
set search_path = ''
as $$
select
  submission.invoice_number,
  submission.portal_reference,
  purchase_order.purchase_order_number,
  submission.amount_minor,
  submission.currency,
  case
    when settlement.scheduled_for <= statement_timestamp() then 'paid'
    else submission.status::text
  end as status,
  submission.created_at,
  settlement.scheduled_for as settlement_expected_at,
  case
    when settlement.scheduled_for <= statement_timestamp() then settlement.scheduled_for
    else null
  end as paid_at,
  case
    when settlement.scheduled_for <= statement_timestamp() then settlement.payment_reference
    else null
  end as payment_reference
from public.invoice_submissions as submission
join public.purchase_orders as purchase_order on purchase_order.id = submission.purchase_order_id
left join public.payment_settlements as settlement
  on settlement.invoice_submission_id = submission.id
where submission.supplier_id = (select private.current_supplier_id())
  and (p_invoice_number is null or submission.invoice_number = p_invoice_number)
order by submission.created_at desc
$$;

revoke execute on function private.get_invoice_submission_statuses(text) from public, anon;
grant execute on function private.get_invoice_submission_statuses(text) to authenticated;

create function public.get_invoice_submission_statuses(p_invoice_number text default null)
returns table (
  invoice_number text,
  portal_reference text,
  purchase_order_number text,
  amount_minor bigint,
  currency text,
  status text,
  created_at timestamptz,
  settlement_expected_at timestamptz,
  paid_at timestamptz,
  payment_reference text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_invoice_submission_statuses($1)
$$;

revoke execute on function public.get_invoice_submission_statuses(text) from public, anon;
grant execute on function public.get_invoice_submission_statuses(text) to authenticated;

commit;
