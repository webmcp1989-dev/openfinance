# OpenFinance Supabase boundary

This directory belongs only to the OpenFinance AR Supabase project.

- `supabase/migrations/202608290001_initial.sql` creates tenant-scoped AR data, seeds the challenge queue, enables RLS, and installs idempotent delivery-result recording.
- `supabase/migrations/202608290002_reject_duplicate_delivery_items.sql` serializes retries for an organization-scoped idempotency key and rejects duplicate invoice numbers inside one delivery event.
- `supabase/migrations/202608290003_enforce_delivery_event_contract.sql` enforces exact event fields, allowed portal statuses, field bounds, purchase-order presence, and legal invoice state transitions at the database boundary.
- `supabase/tests/rls.test.sql` asserts grants, RLS, policy presence, and privileged-function hardening with pgTAP.
- `supabase/tests/delivery-events.test.sql` exercises duplicate rejection, direct-RPC field validation, and invoice state transitions.
- `supabase/demo/reset.sql` is a reviewed administrative reset for only the fixed synthetic challenge organization; it is never called by either application.

Do not point these migrations at the Acme project. Runtime access uses only the OpenFinance publishable key and the authenticated OpenFinance user session.
