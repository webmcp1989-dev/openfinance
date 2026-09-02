# OpenFinance AR database boundary

This directory belongs only to the independent synthetic AR reference system. It is not part of the submitted Acme AP product. Never apply its SQL to the Acme project.

## Contents

- `supabase/migrations`: forward-only AR schema, RLS, grants, private transaction functions, deterministic invoice and evidence fixtures, portal-result recording, remittance reconciliation, optional own-system OAuth MCP support, and human-only reset support. Apply every migration in filename order.
- `supabase/tests`: rollback-only pgTAP coverage for tenant isolation, privileges, delivery events, PDF rendering and integrity, ERP simulation, OAuth audience and reset isolation, exception follow-up, and remittance idempotency.
- `supabase/demo/reset.sql`: reviewed administrative fallback for the fixed synthetic AR organization. Prefer the authenticated **Restore demo start** UI.

## Runtime boundary

The application uses only AR's Supabase URL, publishable key, and authenticated organization session. Tenant identity comes from verified claims and RLS, not request data. Its browser tools and optional OAuth MCP can read or write only AR state; neither can access Acme AP.

Matching invoice and PO identifiers are deterministic demo fixtures. They are not evidence of a shared database or hidden synchronization path.

See [SETUP](../../docs/SETUP.md), [SECURITY](../../docs/SECURITY.md), and [ARCHITECTURE](../../docs/ARCHITECTURE.md).
