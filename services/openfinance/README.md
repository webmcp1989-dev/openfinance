# OpenFinance Supabase boundary

This directory belongs only to the OpenFinance AR Supabase project.

- `supabase/migrations/202608290001_initial.sql` creates tenant-scoped AR data, seeds the challenge queue, enables RLS, and installs idempotent delivery-result recording.
- `supabase/migrations/202608290002_reject_duplicate_delivery_items.sql` serializes retries for an organization-scoped idempotency key and rejects duplicate invoice numbers inside one delivery event.
- `supabase/migrations/202608290003_enforce_delivery_event_contract.sql` enforces exact event fields, allowed portal statuses, field bounds, purchase-order presence, and legal invoice state transitions at the database boundary.
- `supabase/migrations/202608290004_bound_json_money.sql` prevents invoice amounts from exceeding JSON's exact-integer range.
- `supabase/migrations/202608290005_canonicalize_delivery_requests.sql` makes PostgreSQL derive delivery-event request identity and compare exact stored retry content instead of trusting a caller-supplied fingerprint.
- `supabase/migrations/202608290006_simulate_erp_invoice_sync.sql` adds a tenant-configured, idempotent demo ERP pull. Distinct calls deterministically alternate between importing two synthetic invoices and importing none; state changes and audit events are transactional.
- `supabase/tests/rls.test.sql` asserts grants, policy and privileged-function hardening, then creates a foreign organization and proves its invoices cannot be read or mutated.
- `supabase/tests/delivery-events.test.sql` exercises duplicate rejection, direct-RPC field validation, legal state transitions, database-derived idempotency identity, identical retry replay, single state mutation, and changed-payload rejection using the same caller fingerprint.
- `supabase/tests/erp-sync.test.sql` proves the `2 → 0 → 2` sequence, idempotent replay, internal-state isolation, wrapper privilege boundaries, and audit creation.
- `supabase/demo/reset.sql` is a reviewed administrative reset for only the fixed synthetic challenge organization; it is never called by either application.

Do not point these migrations at the Acme project. Runtime access uses only the OpenFinance publishable key and the authenticated OpenFinance user session.
