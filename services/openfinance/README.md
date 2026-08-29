# OpenFinance Supabase boundary

This directory belongs only to the OpenFinance AR Supabase project.

- `supabase/migrations/202608290001_initial.sql` creates tenant-scoped AR data, seeds the challenge queue, enables RLS, and installs idempotent delivery-result recording.
- `supabase/migrations/202608290002_reject_duplicate_delivery_items.sql` serializes retries for an organization-scoped idempotency key and rejects duplicate invoice numbers inside one delivery event.
- `supabase/migrations/202608290003_enforce_delivery_event_contract.sql` enforces exact event fields, allowed portal statuses, field bounds, purchase-order presence, and legal invoice state transitions at the database boundary.
- `supabase/migrations/202608290004_bound_json_money.sql` prevents invoice amounts from exceeding JSON's exact-integer range.
- `supabase/migrations/202608290005_canonicalize_delivery_requests.sql` makes PostgreSQL derive delivery-event request identity and compare exact stored retry content instead of trusting a caller-supplied fingerprint.
- `supabase/migrations/202608290006_simulate_erp_invoice_sync.sql` adds a tenant-configured, idempotent demo ERP pull. Distinct calls deterministically alternate between importing two synthetic invoices and importing none; state changes and audit events are transactional.
- `supabase/migrations/202608290007_repair_renderable_invoice_pdfs.sql` replaces header/footer-shaped placeholders with complete one-page PDFs, repairs existing challenge documents, and guarantees future ERP imports receive valid cross-reference tables and trailers.
- `supabase/migrations/202608290011_add_authorized_demo_reset.sql` adds the explicitly confirmed, operator-scoped human reset used to make the synthetic challenge repeatable; it is audited and intentionally absent from WebMCP.
- `supabase/migrations/202608290012_secure_mcp_oauth_activity.sql` distinguishes OAuth MCP mutations in the audit trail and prevents OAuth clients from reaching the human-only reset at either public or private database boundaries.
- `supabase/migrations/202608300001_bind_oauth_tokens_to_mcp.sql` installs the Supabase Custom Access Token hook that assigns the exact MCP audience only to OAuth tokens and preserves normal portal-token claims.
- `supabase/migrations/202608300002_expand_exception_to_cash.sql` adds due/follow-up state, tenant-scoped supporting documents, and idempotent full or partial payment-remittance reconciliation.
- `supabase/migrations/202608300003_align_exception_to_cash_reset.sql` keeps the synthetic reset complete after remittance expansion.
- `supabase/migrations/202608300004_track_portal_checks.sql` records when verified portal results were last observed without trusting the UI.
- `supabase/migrations/202608300005_validate_supporting_document_pdfs.sql` enforces PDF signature and terminal-marker integrity for supporting evidence at the database boundary.
- `supabase/migrations/202608300006_serialize_remittance_idempotency.sql` serializes organization-scoped remittance retries so concurrent identical calls replay one result and conflicting reuse fails closed.
- `supabase/tests/rls.test.sql` asserts grants, policy and privileged-function hardening, then creates a foreign organization and proves its invoices cannot be read or mutated.
- `supabase/tests/delivery-events.test.sql` exercises duplicate rejection, direct-RPC field validation, legal state transitions, database-derived idempotency identity, identical retry replay, single state mutation, and changed-payload rejection using the same caller fingerprint.
- `supabase/tests/erp-sync.test.sql` proves the `2 → 0 → 2` sequence, idempotent replay, internal-state isolation, wrapper privilege boundaries, and audit creation.
- `supabase/tests/renderable-pdfs.test.sql` verifies renderer isolation, document repair, ERP trigger installation, PDF object markers, and exact `startxref` byte offsets.
- `supabase/tests/mcp-oauth.test.sql` proves OAuth audit attribution, private reset isolation, OAuth reset denial, and preserved human reset behavior.
- `supabase/tests/mcp-token-audience.test.sql` proves hook privileges and separate OAuth/portal audience behavior.
- `supabase/tests/exception-to-cash.test.sql` verifies RLS, privilege boundaries, serialized remittance idempotency, and PDF evidence integrity.
- `supabase/demo/reset.sql` is the reviewed administrative fallback for only the fixed synthetic challenge organization.

Do not point these migrations at the Acme project. Runtime access uses only the OpenFinance publishable key and the authenticated OpenFinance user session.
