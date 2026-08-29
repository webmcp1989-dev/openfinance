begin;

alter table public.invoices
  add constraint invoices_amount_minor_json_safe
  check (amount_minor <= 9007199254740991);

commit;
