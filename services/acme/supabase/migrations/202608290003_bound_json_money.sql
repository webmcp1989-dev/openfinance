begin;

alter table public.purchase_orders
  add constraint purchase_orders_authorized_amount_json_safe
  check (authorized_amount_minor <= 9007199254740991);

alter table public.invoice_submissions
  add constraint invoice_submissions_amount_json_safe
  check (amount_minor <= 9007199254740991);

commit;
