# Acme AP database boundary

This directory belongs only to the submitted Acme AP product. Never apply its SQL to the OpenFinance AR project.

## Contents

- `supabase/migrations`: forward-only Acme schema, RLS, grants, private transaction functions, deterministic synthetic data, payment simulation, and human-only reset support. Apply every migration in filename order.
- `supabase/tests`: rollback-only pgTAP coverage for tenant isolation, privileges, invoice submission, document integrity, idempotency, concurrency, exception ownership, buyer cases, corrected revisions, payment settlement, and approval enforcement.
- `supabase/demo/reset.sql`: reviewed administrative fallback for the fixed synthetic Acme supplier. Prefer the authenticated **Restore demo start** UI.

## Runtime boundary

The application uses only Acme's Supabase URL, publishable key, and authenticated supplier session. Tenant and supplier identity come from verified claims and RLS, not request data. Consequential changes run through narrow public wrappers backed by private, atomic database functions.

The deterministic payment signal settles every second committed synthetic invoice after ten seconds. It is an AP-owned backend behavior, not a timer-authoritative UI or an integration with AR.

See [SETUP](../../docs/SETUP.md), [SECURITY](../../docs/SECURITY.md), and [ARCHITECTURE](../../docs/ARCHITECTURE.md).
