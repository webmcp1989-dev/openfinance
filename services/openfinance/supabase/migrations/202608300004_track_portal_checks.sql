begin;

create function private.track_delivery_event_portal_checks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  for v_item in select value from jsonb_array_elements(new.payload->'items')
  loop
    update public.invoices
    set last_portal_checked_at = new.created_at
    where organization_id = new.organization_id
      and invoice_number = v_item->>'invoiceNumber';
  end loop;
  return new;
end;
$$;

revoke execute on function private.track_delivery_event_portal_checks() from public, anon, authenticated;

create trigger track_delivery_event_portal_checks_after_insert
  after insert on public.delivery_events
  for each row execute function private.track_delivery_event_portal_checks();

commit;
