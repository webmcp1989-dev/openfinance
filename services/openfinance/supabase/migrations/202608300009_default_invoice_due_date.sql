begin;

-- ERP and future integration adapters may omit a due date when the upstream
-- source supplies only an invoice date. Preserve the canonical Net 30 demo
-- rule at the authoritative database boundary instead of relying on a UI or
-- on every individual adapter to duplicate it.
create function private.apply_default_invoice_due_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.due_date is null then
    new.due_date := new.invoice_date + 30;
  end if;
  return new;
end;
$$;

revoke execute on function private.apply_default_invoice_due_date()
  from public, anon, authenticated;

create trigger apply_default_invoice_due_date_before_write
before insert or update of invoice_date, due_date on public.invoices
for each row execute function private.apply_default_invoice_due_date();

commit;
