# OpenFinance Supabase boundary

This directory belongs only to the OpenFinance AR Supabase project.

- `supabase/migrations/202608290001_initial.sql` creates tenant-scoped AR data, seeds the challenge queue, enables RLS, and installs idempotent delivery-result recording.
- `supabase/tests/rls.test.sql` asserts grants, RLS, policy presence, and privileged-function hardening with pgTAP.

Do not point this migration at the Acme project. Runtime access uses only the OpenFinance publishable key and the authenticated OpenFinance user session.
