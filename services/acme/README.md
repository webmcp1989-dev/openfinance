# Acme Supabase boundary

This directory belongs only to the independent Acme AP Supabase project.

- `supabase/migrations/202608290001_initial.sql` creates supplier-scoped PO and submission data, seeds the challenge state, enables RLS, and installs the atomic idempotent submission transaction.
- `supabase/migrations/202608290002_harden_submission_wrapper.sql` serializes retries for a supplier-scoped idempotency key and rejects duplicate invoice numbers before submission processing.
- `supabase/tests/rls.test.sql` asserts grants, RLS, policy presence, and privileged-function hardening with pgTAP.
- `supabase/tests/submission-wrapper.test.sql` verifies wrapper execution mode, retry serialization, and duplicate rejection.

Do not point these migrations at the OpenFinance project. Runtime access uses only the Acme publishable key and the authenticated Acme supplier session.
