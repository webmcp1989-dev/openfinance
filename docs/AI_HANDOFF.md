# AI handoff

This file records only non-obvious continuation context. Repository-wide rules are in [`AGENTS.md`](../AGENTS.md); setup and exact database order are in [`SETUP.md`](SETUP.md).

## Current source of truth

- GitHub: `https://github.com/webmcp1989-dev/openfinance` (`main`).
- AR: `https://openfinance-ar.vercel.app`; AP: `https://openfinance-ap.vercel.app`.
- The apps use separate Vercel projects, Supabase projects, authentication sessions, databases, and migration histories. WebMCP through the human-directed browser remains the only cross-application runtime bridge. AR remote MCP is an additional own-system interface and has no AP access.
- The fixed challenge surface is four AR tools and five AP tools. Every capability also has a human UI path through the same authenticated backend contract.

## Meaningful implementation decisions

- AR **Sync invoices now** is available through UI and the separately OAuth-authenticated AR remote MCP, but is not a tenth browser WebMCP challenge tool.
- The remote MCP uses the official TypeScript SDK and Streamable HTTP at `/mcp`, RFC 9728 metadata, Supabase OAuth authorization-code + PKCE/DCR, a custom `/oauth/consent` page, grant revocation at `/connections`, strict ES256 issuer/audience/client validation, and an unprivileged bearer Supabase client so existing RLS remains authoritative. Its eight tools are documented in `docs/MCP.md`; reset is excluded.
- Supabase authorization request IDs are opaque URL-safe values, not UUIDs. `authorizationIdSchema` bounds their length and character set; do not narrow this protocol identifier to a database UUID.
- Both workspaces now provide a separately confirmed **Restore demo start** control so stateful judging is repeatable. AR migration `202608290011_add_authorized_demo_reset.sql` and AP migration `202608290008_add_authorized_demo_reset.sql` keep authorization and data restoration inside each independent database, permit only the fixed synthetic operator/submitter, serialize and assert the mutation, leave one visible reset audit event, and are deliberately not exposed through WebMCP.
- Migration `services/openfinance/supabase/migrations/202608290006_simulate_erp_invoice_sync.sql` owns the alternating `2 -> 0 -> 2 -> 0` behavior. It derives tenant/operator identity from the session, uses the tenant's configured synthetic customer, serializes retries, row-locks sync state, inserts valid synthetic invoice documents, and records idempotent results plus an audit event atomically.
- `services/openfinance/supabase/demo/reset.sql` removes synthetic `ERP-*` imports and resets the next sync to two invoices.
- AP's human workspace exposes requirements, PO/status lookup, PDF validation, explicit batch review, and confirmed atomic submission. AR exposes scoped queue filtering, package review, result/exception recording, and ERP sync.
- Selecting a ready AR invoice immediately exposes its human PDF download beside the queue selection count; multiple selections expose one explicit link per invoice. Package review retains the same download action. Both paths use the authenticated no-store route that revalidates the stored PDF and checksum before release. The AP human workflow accepts that file and applies the same backend preflight and atomic submission rules as WebMCP.
- AR migration `202608290007_repair_renderable_invoice_pdfs.sql` established complete PDF structure. Migrations `202608290008_render_detailed_invoice_pdfs.sql` through `202608290010_space_invoice_amount_due.sql` replace the minimal content with a visually verified invoice derived from authoritative supplier/customer/invoice/date/PO/amount fields, deterministic Net-30 terms, synthetic remittance details, and a non-payment footer. The private trigger gives future `ERP-*` imports the same document. Do not reintroduce header/EOF-only or identity-only placeholders.
- AP migration `202608290007_simulate_payment_settlement.sql` adds a serialized per-supplier sequence and schedules every second committed invoice for a synthetic payment signal after 10 seconds. A public invoker/private scoped-read function provides the same effective status to UI and `get_invoice_status`; base settlement data has no direct application grant, reads do not mutate state, and a single scheduled browser refresh replaces polling.
- Human UI controls are convenience and presentation only. The same route, service, RLS, public wrapper, and private transaction boundaries remain authoritative.
- Both login pages let an authenticated user without the required tenant/supplier profile sign out locally and switch accounts. Preserve this recovery path: profile membership remains mandatory, the message remains generic, and the action must never create or infer membership.
- Both Next.js configs set `agentRules: false` so `next dev` does not generate duplicate app-level `AGENTS.md`/`CLAUDE.md` files; the reviewed root `AGENTS.md` remains authoritative.

## Migration and environment status

- AR migration `202608290006_simulate_erp_invoice_sync.sql` was applied to the live AR project and its 17-assertion rollback-only suite passed. Any new environment must apply it before deploying code that calls `/api/agent/erp-sync`.
- AR migrations through `202608290010_space_invoice_amount_due.sql` are applied to the live AR project. The expanded 16-assertion rollback-only suite passed; an exact human-UI download passed strict `pypdf`, `pdfplumber`, SHA-256 verification, Poppler rendering, text-field checks, and full-page visual review with no clipping or overlap.
- AP migration `202608290007_simulate_payment_settlement.sql` is applied to the live AP project and its 15-assertion rollback-only pgTAP suite passed. Any new environment must apply it before deploying the payment-aware AP code.
- AR migration `202608290011_add_authorized_demo_reset.sql` and AP migration `202608290008_add_authorized_demo_reset.sql` are applied to their independent live projects. Each 14-assertion rollback-only reset suite passed. Commit `693100a` is green in CI and Ready in both Vercel production projects; both live two-step controls restored their own canonical state and left exactly one reset audit event.
- Two independent live human-workspace runs transferred four repaired ERP PDFs through AP preflight and confirmed submission. In each pair, only the even-sequence invoice became `paid` after 10 seconds; UI and authenticated WebMCP status reads returned the same payment reference without additional audit writes.
- AR adds `@modelcontextprotocol/server`, `jose`, and direct declarations for Supabase's runtime `tslib`/`iceberg-js` dependencies. Production AR also requires `OPENFINANCE_MCP_URL=https://openfinance-ar.vercel.app/mcp`; AP remains unchanged.
- AR migration `202608290012_secure_mcp_oauth_activity.sql` labels audit writes as `human` or `oauth_mcp` with the OAuth client ID and prevents OAuth JWTs from invoking the human-only reset. Apply it before enabling the remote MCP.
- Never store demo/judge passwords, database credentials, Vercel tokens, or Supabase service-role keys in Git.

## Verified limitations and follow-up

- ERP sync is deterministic synthetic challenge behavior, not a real ERP connector or scheduler. Commercial connectors and learned-browser compatibility remain future product work.
- Database suites currently run manually in each Supabase SQL editor inside rollback transactions; ephemeral database CI is future hardening.
- After any stateful live test, restore both applications separately with their human controls (or the reviewed SQL fallbacks) and confirm the public judge state before submission.
- Challenge publication still requires entrant-controlled Devpost declarations, private judge credential entry, and public video publication; these values must remain outside the repository.
