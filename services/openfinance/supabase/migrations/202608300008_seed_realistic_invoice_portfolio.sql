begin;

-- Keep the challenge queue realistic without creating a runtime dependency on
-- the independent AP project. Matching PO and invoice identifiers are fixtures
-- only; each application owns and restores its own records.
with invoice_seed(
  invoice_id, invoice_number, invoice_date, amount_minor, purchase_order_number,
  status, portal_reference, portal_status, exception_code, exception_message,
  paid_amount_minor, last_payment_at, last_payment_reference
) as (
  values
    ('30000000-0000-4000-8000-000000000005'::uuid, 'INV-10522', '2026-08-21'::date,  468000::bigint, 'PO-8912', 'ready'::public.invoice_status, null, null, null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000006'::uuid, 'INV-10538', '2026-08-22'::date,  936000::bigint, 'PO-8930', 'ready'::public.invoice_status, null, null, null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000007'::uuid, 'INV-10544', '2026-08-23'::date,  315000::bigint, 'PO-8955', 'ready'::public.invoice_status, null, null, null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000008'::uuid, 'INV-10561', '2026-08-24'::date,  672500::bigint, 'PO-8971', 'ready'::public.invoice_status, null, null, null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000009'::uuid, 'INV-10311', '2026-07-02'::date,  430000::bigint, 'PO-8701', 'accepted'::public.invoice_status, 'ACME-20260702-A1031101', 'accepted', null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000010'::uuid, 'INV-10324', '2026-07-05'::date,  890000::bigint, 'PO-8710', 'accepted'::public.invoice_status, 'ACME-20260705-A1032401', 'accepted', null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000011'::uuid, 'INV-10338', '2026-07-10'::date,  265000::bigint, 'PO-8821', 'submitted'::public.invoice_status, 'ACME-20260710-A1033801', 'received', null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000012'::uuid, 'INV-10349', '2026-07-12'::date,  515000::bigint, 'PO-8844', 'rejected'::public.invoice_status, 'ACME-20260712-A1034901', 'rejected', 'duplicate_invoice', 'Acme found an earlier invoice with the same supplier invoice number.', 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000013'::uuid, 'INV-10275', '2026-06-18'::date, 1200000::bigint, 'PO-8821', 'accepted'::public.invoice_status, 'ACME-20260618-A1027501', 'paid', null, null, 1200000::bigint, '2026-07-18T14:30:00Z'::timestamptz, 'PAY-20260718-A1027501'),
    ('30000000-0000-4000-8000-000000000014'::uuid, 'INV-10291', '2026-06-24'::date,  355000::bigint, 'PO-8844', 'submitted'::public.invoice_status, 'ACME-20260624-A1029101', 'under_review', null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000015'::uuid, 'INV-10403', '2026-07-21'::date,  780000::bigint, 'PO-8821', 'needs_attention'::public.invoice_status, null, null, 'missing_tax_identifier', 'Add the customer tax identifier before portal submission.', 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000016'::uuid, 'INV-10417', '2026-07-24'::date,  640000::bigint, 'PO-8701', 'rejected'::public.invoice_status, 'ACME-20260820-A1041701', 'disputed', 'missing_delivery_proof', 'Acme requires proof of delivery. Supplier AR can attach the document and respond.', 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000017'::uuid, 'INV-10428', '2026-07-27'::date,  925000::bigint, 'PO-8930', 'accepted'::public.invoice_status, 'ACME-20260727-A1042801', 'accepted', null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000018'::uuid, 'INV-10435', '2026-07-29'::date,  188000::bigint, 'PO-8955', 'submitted'::public.invoice_status, 'ACME-20260729-A1043501', 'received', null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000019'::uuid, 'INV-10446', '2026-08-01'::date,  742000::bigint, 'PO-8971', 'accepted'::public.invoice_status, 'ACME-20260801-A1044601', 'accepted', null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000020'::uuid, 'INV-10457', '2026-08-04'::date,  299000::bigint, 'PO-8912', 'needs_attention'::public.invoice_status, null, null, 'missing_customer_reference', 'Add the customer billing reference before portal submission.', 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000021'::uuid, 'INV-10463', '2026-08-06'::date, 1100000::bigint, 'PO-8710', 'submitted'::public.invoice_status, 'ACME-20260820-A1046301', 'under_review', null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000022'::uuid, 'INV-10474', '2026-08-08'::date,  584000::bigint, 'PO-8930', 'accepted'::public.invoice_status, 'ACME-20260808-A1047401', 'accepted', null, null, 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000023'::uuid, 'INV-10479', '2026-08-10'::date,  410000::bigint, 'PO-8955', 'rejected'::public.invoice_status, 'ACME-20260810-A1047901', 'rejected', 'tax_total_mismatch', 'Correct the tax total and replace the rejected invoice.', 0::bigint, null::timestamptz, null),
    ('30000000-0000-4000-8000-000000000024'::uuid, 'INV-10514', '2026-08-19'::date,  845000::bigint, 'PO-8971', 'needs_attention'::public.invoice_status, null, null, 'missing_contract', 'Attach the signed contract before portal submission.', 0::bigint, null::timestamptz, null)
), rendered as (
  select seed.*, private.render_synthetic_invoice_pdf(
    seed.invoice_number, seed.invoice_date, seed.amount_minor, 'USD',
    seed.purchase_order_number, 'Example Supplier Ltd', 'Acme Manufacturing'
  ) as document_bytes
  from invoice_seed as seed
)
insert into public.invoices (
  id, organization_id, customer_id, invoice_number, invoice_date, due_date,
  amount_minor, currency, purchase_order_number, status,
  document_name, document_media_type, document_content_base64, document_sha256,
  portal_reference, portal_status, exception_code, exception_message,
  paid_amount_minor, last_payment_at, last_payment_reference
)
select
  invoice_id, '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', invoice_number, invoice_date,
  invoice_date + 30, amount_minor, 'USD', purchase_order_number, status,
  invoice_number || '.pdf', 'application/pdf', encode(document_bytes, 'base64'),
  encode(extensions.digest(document_bytes, 'sha256'), 'hex'), portal_reference,
  portal_status, exception_code, exception_message, paid_amount_minor,
  last_payment_at, last_payment_reference
from rendered
on conflict (organization_id, invoice_number) do nothing;

insert into public.invoice_supporting_documents (
  organization_id, invoice_id, document_kind, file_name, media_type,
  content_base64, sha256, size_bytes
)
select
  invoice.organization_id, invoice.id, 'proof_of_delivery',
  'INV-10417-proof-of-delivery.pdf', 'application/pdf',
  'JVBERi0xLjQKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSIC9GMiAzIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PAovQmFzZUZvbnQgL0hlbHZldGljYSAvRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZyAvTmFtZSAvRjEgL1N1YnR5cGUgL1R5cGUxIC9UeXBlIC9Gb250Cj4+CmVuZG9iagozIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhLUJvbGQgL0VuY29kaW5nIC9XaW5BbnNpRW5jb2RpbmcgL05hbWUgL0YyIC9TdWJ0eXBlIC9UeXBlMSAvVHlwZSAvRm9udAo+PgplbmRvYmoKNCAwIG9iago8PAovQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDYxMiA3OTIgXSAvUGFyZW50IDcgMCBSIC9SZXNvdXJjZXMgPDwKL0ZvbnQgMSAwIFIgL1Byb2NTZXQgWyAvUERGIC9UZXh0IC9JbWFnZUIgL0ltYWdlQyAvSW1hZ2VJIF0KPj4gL1JvdGF0ZSAwIC9UcmFucyA8PAoKPj4gCiAgL1R5cGUgL1BhZ2UKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1BhZ2VNb2RlIC9Vc2VOb25lIC9QYWdlcyA3IDAgUiAvVHlwZSAvQ2F0YWxvZwo+PgplbmRvYmoKNiAwIG9iago8PAovQXV0aG9yIChhbm9ueW1vdXMpIC9DcmVhdGlvbkRhdGUgKEQ6MjAyNjA4MzAwOTMxMjkrMDMnMDAnKSAvQ3JlYXRvciAoYW5vbnltb3VzKSAvS2V5d29yZHMgKCkgL01vZERhdGUgKEQ6MjAyNjA4MzAwOTMxMjkrMDMnMDAnKSAvUHJvZHVjZXIgKFJlcG9ydExhYiBQREYgTGlicmFyeSAtIFwob3BlbnNvdXJjZVwpKSAKICAvU3ViamVjdCAodW5zcGVjaWZpZWQpIC9UaXRsZSAodW50aXRsZWQpIC9UcmFwcGVkIC9GYWxzZQo+PgplbmRvYmoKNyAwIG9iago8PAovQ291bnQgMSAvS2lkcyBbIDQgMCBSIF0gL1R5cGUgL1BhZ2VzCj4+CmVuZG9iago4IDAgb2JqCjw8Ci9GaWx0ZXIgWyAvQVNDSUk4NURlY29kZSAvRmxhdGVEZWNvZGUgXSAvTGVuZ3RoIDEzODcKPj4Kc3RyZWFtCkdhdG07RDApSTEmSDl0WWZUNURvNjohNzFxTWhpJ1NTdCVWQFhOJWhORjlgJmEsOjJfQTI4M2peKzU6IjohVWpsTVhCJiErbW5eKGNZQmtuXzg8XDtJXSFAYmB1Jzk7WkdAayFoaDAwSSM0V1tiZkoibWNFUnRBWCZBYmw5XlJmImAlYilHbWAyMT1vRTJuUTYiPzE9Il9Zal1BZV9oQlpacTpYZDxbaSQ3VilXQC5xb2dkIyY1OEpASltnNTtfT1c2XVo4KmstcSgnRGA1bDxvJDp1NksiRXUobzxVUElQTS1gcyElO3FZdHVQR1BLSmx1bVkkQ1QpRV46N0E3NnBCL1tEaSZjODI+NDo6UjxaUm1KUS1pIzdMMCZudEJlWjAtJUFNVU4ra2paR1VgUWVPITBhKW9iTyNhSWFRc1pgMjlAakdnYmw0WmRUI0FeSzwxXCFpaTEuRiU4PVo0QE0tV25LTzNASlpjMTo1JE9PKTM2L2FUc1YxTltDRWJLRWwxbyInalRKLz9vK0BlLkZcM2lzNV8vU1RNbWRUcVRAcmMjTiwtZlkoZUJmQz4pWTc4SlZQPnU8PCYkaDcyVXFfdUMrITEuMmpmQDFVQHFATU88OmxETTcwSEdUc0w+K2wwKTxTNnAhUnRSMlQ5M1pkYz82Y2MkYktfakY4WiVjdFc9X246RFcmRlBxZll1JUtyVVo0RydKcSZFJlA9YCE3S0JZSk0tZj9JWSpxI15ERjNkO1AkdUpePmI7ZC1FVTNAaztrKkZPYTNMPGtoPSVeKXMoKSFkNm5vMTRzYyhXRypidCc2cilvaVZOYEBAPShwNlBmNWQ8JTMhZy43OTomUk4mY1o6PzNtW1dVcSlxQ1RxL00nKCdcUm8oJUgqPFBBLCg8anFvQEdmUjtQL0FLQ15IRW8+KFo9PUU8YUomaChDNChyMkQuXWVhPSpHUVIqJStwcSY3TypfNzJVQU4yWlZiYzIsMTswb3RURmtdclVAT3RldTZfUCVBO1FVQ2BUS08wMi9fMnBMYG5vbVI9XlA5aWUqZ04tLFg9MEc9TGhkPj5EYiJDI0teLS5LMmI9PHMuSChvVisuZiZWNlpYPDlZIkwwNT5WOSZSZ1AraSlGcEQ8M1wzUVU9aE5PTHBfdCMyI2gmITM3TXNzWkpDUGI0YWpWa0VvKDhHSyhJR0YvMzhNalg2Z1o/PytmVHJhanFCJTZmLUQmMmNCQkhkIzU7Tlk0WCpIZz48YDJfbDtiZWVBMVRCS0UzcFwvb084WnF1WHU6RSM1YHQvS2hjLUciJUYuNSglPXBiOW8nTz9kXVUmblJUXDMrPlxTTDomPyJsYTRoOEUoTlFyZEgyLkJ0OjYtSU1JYXAnTG0sOGMjUWoqY25tS2E/bDM7XSxKO2pnL15oNmhKcidkX1BYP2FIY1dOVmBXVkk6bDlXOTNrJyNBQDRmQj5SZDJOaCxqPVpkXDxvbEFAcXBQRCEsV1oqalwzc2FWISNuNUpJUCVRIlE5XEdDRmRkbSpAWWI3RmhAQidbTGwhPmo/WXRvM1VKTGp1Yl8jblJONSg2N0xYR0ksWEQ1Plo3NmYnbm1HXl5eUWR1I0JZSkMyJklANGAxNjBtaUVDQSQwcFgxYylQRiVCUGFHQm9aUEBJZ2o9UzBRS0wpcGJaMGtyLVkpPWAvMSM8cDtwMyVxNytAMWwzVCs9ciJaRmAiUlI2YyQmQyoiXm49Yz0qVi9UR1xPXzNaVkMiXGhyZElHcFxFbldeNFJNWUkpc2w6OFhNVj9ddUluP21LcGYpKDJtdEBtXSomRTc9cmg+OmEpbGwiXnE2OVFgRTNufj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA5CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMTAyIDAwMDAwIG4gCjAwMDAwMDAyMDkgMDAwMDAgbiAKMDAwMDAwMDMyMSAwMDAwMCBuIAowMDAwMDAwNTE0IDAwMDAwIG4gCjAwMDAwMDA1ODIgMDAwMDAgbiAKMDAwMDAwMDg0MyAwMDAwMCBuIAowMDAwMDAwOTAyIDAwMDAwIG4gCnRyYWlsZXIKPDwKL0lEIApbPDAyMTlmN2E3MGJiYzZmOGEwYTY3YzU3MzNlM2FjNjU1PjwwMjE5ZjdhNzBiYmM2ZjhhMGE2N2M1NzMzZTNhYzY1NT5dCiUgUmVwb3J0TGFiIGdlbmVyYXRlZCBQREYgZG9jdW1lbnQgLS0gZGlnZXN0IChvcGVuc291cmNlKQoKL0luZm8gNiAwIFIKL1Jvb3QgNSAwIFIKL1NpemUgOQo+PgpzdGFydHhyZWYKMjM4MAolJUVPRgo=',
  '1e560026c1e8992d77f19baf0cf0144d2ad399374b3f635f7193b4e73ea93071',
  2771
from public.invoices as invoice
where invoice.organization_id = '10000000-0000-4000-8000-000000000001'
  and invoice.invoice_number = 'INV-10417'
on conflict (invoice_id, document_kind, sha256) do nothing;

create or replace function private.reset_demo_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_deleted_delivery_events integer;
  v_deleted_remittance_events integer;
  v_deleted_erp_events integer;
  v_deleted_erp_invoices integer;
  v_updated_invoices integer;
  v_updated_sync_state integer;
  v_reset_at timestamptz := statement_timestamp();
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'Authentication required'; end if;
  select profile.organization_id into v_organization_id
  from public.profiles as profile
  where profile.user_id = v_user_id and profile.role in ('admin', 'operator');
  if v_organization_id is distinct from '10000000-0000-4000-8000-000000000001'::uuid then
    raise exception using errcode = '42501', message = 'Demo reset access required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_organization_id::text || ':demo-reset', 0));

  delete from public.audit_events where organization_id = v_organization_id;
  delete from public.payment_remittance_events where organization_id = v_organization_id;
  get diagnostics v_deleted_remittance_events = row_count;
  delete from public.delivery_events where organization_id = v_organization_id;
  get diagnostics v_deleted_delivery_events = row_count;
  delete from public.erp_sync_events where organization_id = v_organization_id;
  get diagnostics v_deleted_erp_events = row_count;
  delete from public.invoices where organization_id = v_organization_id and invoice_number like 'ERP-%';
  get diagnostics v_deleted_erp_invoices = row_count;

  update public.erp_sync_state
  set next_invoice_sequence = 1, next_sync_has_invoices = true, updated_at = v_reset_at
  where organization_id = v_organization_id;
  get diagnostics v_updated_sync_state = row_count;
  if v_updated_sync_state <> 1 then raise exception using errcode = 'P0002', message = 'Demo ERP state is incomplete'; end if;

  update public.invoices as invoice
  set status = seed.status,
      portal_reference = seed.portal_reference,
      portal_status = seed.portal_status,
      exception_code = seed.exception_code,
      exception_message = seed.exception_message,
      due_date = invoice.invoice_date + 30,
      last_portal_checked_at = null,
      paid_amount_minor = seed.paid_amount_minor,
      last_payment_at = seed.last_payment_at,
      last_payment_reference = seed.last_payment_reference,
      version = 1,
      updated_at = v_reset_at
  from (values
    ('INV-10482', 'ready'::public.invoice_status, null::text, null::text, null::text, null::text, 0::bigint, null::timestamptz, null::text),
    ('INV-10491', 'ready'::public.invoice_status, null, null, null, null, 0, null, null),
    ('INV-10503', 'needs_attention'::public.invoice_status, null, null, 'missing_purchase_order', 'Add a valid purchase order before portal submission.', 0, null, null),
    ('INV-10507', 'ready'::public.invoice_status, null, null, null, null, 0, null, null),
    ('INV-10522', 'ready'::public.invoice_status, null, null, null, null, 0, null, null),
    ('INV-10538', 'ready'::public.invoice_status, null, null, null, null, 0, null, null),
    ('INV-10544', 'ready'::public.invoice_status, null, null, null, null, 0, null, null),
    ('INV-10561', 'ready'::public.invoice_status, null, null, null, null, 0, null, null),
    ('INV-10311', 'accepted'::public.invoice_status, 'ACME-20260702-A1031101', 'accepted', null, null, 0, null, null),
    ('INV-10324', 'accepted'::public.invoice_status, 'ACME-20260705-A1032401', 'accepted', null, null, 0, null, null),
    ('INV-10338', 'submitted'::public.invoice_status, 'ACME-20260710-A1033801', 'received', null, null, 0, null, null),
    ('INV-10349', 'rejected'::public.invoice_status, 'ACME-20260712-A1034901', 'rejected', 'duplicate_invoice', 'Acme found an earlier invoice with the same supplier invoice number.', 0, null, null),
    ('INV-10275', 'accepted'::public.invoice_status, 'ACME-20260618-A1027501', 'paid', null, null, 1200000, '2026-07-18T14:30:00Z'::timestamptz, 'PAY-20260718-A1027501'),
    ('INV-10291', 'submitted'::public.invoice_status, 'ACME-20260624-A1029101', 'under_review', null, null, 0, null, null),
    ('INV-10403', 'needs_attention'::public.invoice_status, null, null, 'missing_tax_identifier', 'Add the customer tax identifier before portal submission.', 0, null, null),
    ('INV-10417', 'rejected'::public.invoice_status, 'ACME-20260820-A1041701', 'disputed', 'missing_delivery_proof', 'Acme requires proof of delivery. Supplier AR can attach the document and respond.', 0, null, null),
    ('INV-10428', 'accepted'::public.invoice_status, 'ACME-20260727-A1042801', 'accepted', null, null, 0, null, null),
    ('INV-10435', 'submitted'::public.invoice_status, 'ACME-20260729-A1043501', 'received', null, null, 0, null, null),
    ('INV-10446', 'accepted'::public.invoice_status, 'ACME-20260801-A1044601', 'accepted', null, null, 0, null, null),
    ('INV-10457', 'needs_attention'::public.invoice_status, null, null, 'missing_customer_reference', 'Add the customer billing reference before portal submission.', 0, null, null),
    ('INV-10463', 'submitted'::public.invoice_status, 'ACME-20260820-A1046301', 'under_review', null, null, 0, null, null),
    ('INV-10474', 'accepted'::public.invoice_status, 'ACME-20260808-A1047401', 'accepted', null, null, 0, null, null),
    ('INV-10479', 'rejected'::public.invoice_status, 'ACME-20260810-A1047901', 'rejected', 'tax_total_mismatch', 'Correct the tax total and replace the rejected invoice.', 0, null, null),
    ('INV-10514', 'needs_attention'::public.invoice_status, null, null, 'missing_contract', 'Attach the signed contract before portal submission.', 0, null, null)
  ) as seed(invoice_number, status, portal_reference, portal_status, exception_code,
    exception_message, paid_amount_minor, last_payment_at, last_payment_reference)
  where invoice.organization_id = v_organization_id
    and invoice.invoice_number = seed.invoice_number;
  get diagnostics v_updated_invoices = row_count;
  if v_updated_invoices <> 24 then raise exception using errcode = 'P0002', message = 'Demo invoice baseline is incomplete'; end if;

  insert into public.audit_events (
    organization_id, actor_user_id, action, entity_type, entity_id, details, created_at
  ) values (
    v_organization_id, v_user_id, 'demo_state_reset', 'organization', v_organization_id::text,
    jsonb_build_object(
      'restoredInvoiceCount', v_updated_invoices,
      'readyInvoiceCount', 7,
      'deletedDeliveryEventCount', v_deleted_delivery_events,
      'deletedRemittanceEventCount', v_deleted_remittance_events,
      'deletedErpEventCount', v_deleted_erp_events,
      'deletedErpInvoiceCount', v_deleted_erp_invoices
    ), v_reset_at
  );
  return jsonb_build_object(
    'restoredInvoiceCount', v_updated_invoices,
    'readyInvoiceCount', 7,
    'deletedDeliveryEventCount', v_deleted_delivery_events,
    'deletedRemittanceEventCount', v_deleted_remittance_events,
    'deletedErpEventCount', v_deleted_erp_events,
    'deletedErpInvoiceCount', v_deleted_erp_invoices,
    'resetAt', v_reset_at
  );
end;
$$;

revoke execute on function private.reset_demo_state() from public, anon, authenticated;

commit;
