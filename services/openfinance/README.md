# OpenFinance Supabase boundary

This directory belongs only to the OpenFinance AR Supabase project.

- `supabase/migrations/202608290001_initial.sql` creates tenant-scoped AR data, seeds the challenge queue, enables RLS, and installs idempotent delivery-result recording.
- `supabase/migrations/202608290002_reject_duplicate_delivery_items.sql` adds database-authoritative rejection of duplicate invoice numbers inside one delivery event.
- `supabase/tests/rls.test.sql` asserts grants, RLS, policy presence, and privileged-function hardening with pgTAP.
- `supabase/tests/delivery-events.test.sql` proves the public RPC remains a security invoker and rejects duplicate invoice numbers.

Do not point this migration at the Acme project. Runtime access uses only the OpenFinance publishable key and the authenticated OpenFinance user session.
