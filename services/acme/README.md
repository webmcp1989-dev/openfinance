# Acme Supabase boundary

This directory belongs only to the independent Acme AP Supabase project.

- `supabase/migrations/202608290001_initial.sql` creates supplier-scoped PO and submission data, seeds the challenge state, enables RLS, and installs the atomic idempotent submission transaction.
- `supabase/migrations/202608290002_harden_submission_wrapper.sql` serializes retries for a supplier-scoped idempotency key and rejects duplicate invoice numbers before submission processing.
- `supabase/migrations/202608290003_bound_json_money.sql` keeps purchase-order and submitted-invoice amounts inside JSON's exact-integer range.
- `supabase/migrations/202608290004_align_submission_policy.sql` prevents the stored AP policy from advertising document or PO behavior outside the deployed WebMCP and transaction contract.
- `supabase/migrations/202608290005_canonicalize_submission_requests.sql` makes the authenticated wrapper enforce the exact payload shape and canonical PDF encoding, cap transfer batches, and derive the idempotency fingerprint inside Postgres.
- `supabase/migrations/202608290006_validate_pdf_structure.sql` requires the PDF signature and an end-of-file marker near the document tail, rechecks the one-megabyte bound, and verifies SHA-256 before entering the submission transaction.
- `supabase/migrations/202608290007_simulate_payment_settlement.sql` assigns a serialized per-supplier invoice sequence, schedules every second committed invoice for synthetic settlement after 10 seconds, and exposes a session-scoped read function without direct settlement-table grants.
- `supabase/tests/rls.test.sql` asserts grants, policy and privileged-function hardening, then creates a foreign supplier and proves its purchase orders cannot be read or consumed.
- `supabase/tests/submission-wrapper.test.sql` verifies policy alignment, exact request enforcement, PDF structure, wrapper execution mode, retry serialization, identical-response replay, single balance decrement, changed-payload rejection, and duplicate rejection.
- `supabase/tests/payment-settlement.test.sql` verifies payment-state isolation, view security, deterministic pair behavior, paid-status maturity, references, and audit creation.
- `supabase/demo/reset.sql` is a reviewed administrative reset for only the fixed synthetic challenge supplier; it is never called by either application.

Do not point these migrations at the OpenFinance project. Runtime access uses only the Acme publishable key and the authenticated Acme supplier session.
