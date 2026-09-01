# OpenFinance agent guide

This is the vendor-neutral source of truth for AI coding agents. Read it before changing the repository, then consult only the linked documentation relevant to the task.

## Product and non-negotiable boundary

OpenFinance demonstrates agent-native B2B invoice interoperability:

```text
OpenFinance AR <-> WebMCP <-> browser agent + human <-> WebMCP <-> Acme AP
```

The two applications are independently authenticated, deployed, and persisted. The browser agent is the only runtime bridge. Never add a shared database, shared credentials, server-to-server integration, queue, webhook, or hidden orchestration path between them. Use only synthetic data.

The opening challenge prompt is **"Submit all Acme invoices that can be paid."** The separate follow-up instruction covers exception ownership and cash reconciliation. Preserve the complete flow and its explicit human approvals described in [docs/NORTH_STAR.md](docs/NORTH_STAR.md).

## Stack and repository map

- Bun 1.3.14 workspaces; TypeScript 6; Next.js 16 App Router; React 19.
- Supabase Auth/Postgres with SSR clients, RLS, SQL migrations, and pgTAP tests.
- Vercel hosts two projects with separate Supabase projects and sessions.
- `apps/openfinance-ar`: seller AR app (port 3000).
- `apps/acme-ap`: buyer supplier portal (port 3001).
- In each app: `app/` owns pages and BFF route handlers, `components/` owns UI and WebMCP registration, `lib/domain/` owns validation/types, `lib/services/` owns use cases, and `lib/supabase/` owns provider access.
- `services/openfinance/supabase` and `services/acme/supabase`: independent migrations, seeds, reset scripts, and database tests.
- `docs/openapi.yaml`: both same-origin HTTP contracts. `tests/`: repository/production contracts.
- `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/WEBMCP.md`, `docs/SETUP.md`: detailed technical sources.
- `docs/AI_HANDOFF.md`: concise current state, limitations, and meaningful follow-up.

No nested agent file is currently needed. A future nested `AGENTS.md` should contain only rules unique to that subtree.

## Setup and verified commands

From the repository root:

```bash
bun install --frozen-lockfile
bun run dev:openfinance      # http://localhost:3000
bun run dev:acme             # http://localhost:3001
bun run typecheck
bun run lint
bun test
bun run build
bun audit
```

Run the two dev servers in separate terminals. Configure each app with credentials for its own Supabase project as documented in `docs/SETUP.md`.

## Architecture and responsibility rules

- Frontends present state, collect intent/approval, provide accessible feedback, and register page-scoped tools. They are never authoritative.
- Route handlers enforce method/content type/origin, authenticate before parsing untrusted bodies, validate with Zod, and return stable safe errors.
- Services implement application use cases and map database/provider records to domain objects.
- Postgres derives tenant/supplier identity, authorizes roles, locks concurrent state, validates invariants, and commits consequential changes atomically.
- Keep UI, HTTP, service, domain, data-access, and integration concerns separate. Do not leak Next.js, Supabase, Vercel, or browser details into domain modules.
- Reuse bounded helpers within one application. Do not create shared business schemas or code that secretly couples AR and AP.
- All 19 browser WebMCP capabilities have human UI paths backed by the same services. Preserve the seven AR and twelve AP tools as clear non-overlapping business capabilities; reset remains human-only.
- Preserve the authority asymmetry as a product and security claim: 19 browser tools, zero cross-writes. AR tools can write only AR, AP tools only AP, and only the human authorizes data crossing between them. Buyer-owned blockers must be named as outside supplier authority and routed through a tracked buyer case rather than falsely resolved.
- ERP invoice sync is available in the human UI and AR remote MCP, but remains outside the browser WebMCP inventory; see `docs/MCP.md`.
- The AR remote MCP is an own-system access surface only. Preserve exact Supabase OAuth resource/audience validation, RLS-bound bearer access, consent/revocation, OAuth audit attribution, and the technical prohibition on OAuth demo reset. Never let it call AP directly.
- Preserve the Custom Access Token hook: hosted Supabase currently does not map RFC 8707 `resource` into `aud`, so the hook binds OAuth tokens to the exact MCP URL while leaving portal sessions unchanged.
- Synthetic invoice files must remain genuinely renderable, credible invoices, not signature/EOF placeholders. Preserve the private database renderer, authoritative supplier/customer/invoice/date/PO/amount fields, deterministic Net-30 due date, explicit synthetic-data label, exact cross-reference offsets, parser/render tests, and authenticated download validation.
- AP's challenge payment signal is deterministic backend simulation: every second committed supplier invoice settles after 10 seconds. Preserve its serialized, idempotent, read-only-discovery design; do not replace it with client timers that author state, random behavior, or hidden AR/AP integration.
- The canonical portfolio contains 24 AR invoices, exactly three narrated Acme candidates (`INV-10482`, `INV-10491`, and blocked `INV-10507`), nine AP purchase orders, and three historical AP exception submissions. Exact requested delivery evidence resolves the supplier-owned exception and accepts its disputed invoice only when no other blocker remains; the verified AP acceptance is then recorded in AR with the same portal reference. The buyer-receiving exception is case-only and must remain blocked after inquiry creation; the agent records the exact returned case in AR without claiming resolution. Keep the primary story ending at exact AP remittance discovery and approved AR reconciliation, not at submission.

## Authentication, isolation, and security

- Use Supabase `auth.getClaims()` for protected pages/routes. Never trust caller-supplied tenant, organization, buyer, supplier, or role identifiers.
- Every exposed table requires RLS. Default deny, revoke anonymous access, and grant only the minimum authenticated privileges.
- Browser code may receive only the Supabase URL and publishable key. Never expose or commit service-role keys, database passwords, access tokens, real customer data, or judge credentials.
- Mutations require exact same-origin JSON requests. Validate every process boundary and return public error codes without raw database details.
- Consequential/retryable writes must be tenant-scoped, idempotent, concurrency-safe, auditable, and transactionally correct.
- Cross-site document transfer and AP submission require separate, informed human approvals. Preview destination, invoice numbers, POs, amounts, total, and exclusions.
- AP's three document-writing capabilities (`submit_invoice_batch`, `respond_to_invoice_exception`, and `replace_rejected_invoice`) require a short-lived, single-use approval that is bound in PostgreSQL to the signed-in user, tenant, action, idempotency key, and exact metadata/hash manifest. Never add an agent-callable approval tool, restore an unapproved RPC signature, store PDF base64 in approval records, or move this authoritative gate to the frontend.
- Exception responses, corrected invoice replacement, buyer inquiries, and AR remittance writeback also require an exact human preview and approval immediately before the consequential write.
- Treat tool inputs/outputs and uploaded documents as untrusted. Preserve the bounded classic-PDF structure (catalog, page, byte-accurate `startxref`/`xref`), SHA-256, canonical base64, exact-integer money, and three-item batch controls. Keep the AP server and database checks authoritative; client-side file checks are UX only.
- Keep security headers, no-cache authenticated state, optional-audit degradation, and visible post-write refresh behavior.

## Database and migrations

- Never edit an applied migration. Add a timestamped, forward-only SQL file in the owning service.
- Keep AR and AP schemas, fixtures, and migrations independent. Synthetic demo constants belong in seeds/migrations, not reusable domain logic.
- Use constraints and transactions to preserve invariants. Privileged implementations belong in `private`, use `security definer`, set `search_path = ''`, schema-qualify names, and expose a minimal public security-invoker wrapper.
- Update the owning service README, `docs/SETUP.md`, reset script, pgTAP coverage, and handoff for meaningful schema changes.
- Database tests are rollback-only SQL scripts run in the corresponding Supabase SQL editor; exact order is documented in `docs/SETUP.md`.

## Environment, hosting, and deployment

- `.env`, `.env.*`, `.vercel`, and `.supabase` are ignored. Only `.env.example` is tracked, with empty placeholders.
- Required variables per deployment: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, each scoped to that app's own project.
- Never put secrets in `NEXT_PUBLIC_*`; do not add machine-specific paths to tracked files.
- Continue using the existing Vercel and Supabase projects. Each Vercel project uses its app directory as the root. Do not introduce new infrastructure without a demonstrated requirement.
- Apply and verify database migrations before deploying application code that depends on them. Confirm both public deployments and exact in-app-browser flow after release.

## Change, validation, and collaboration workflow

1. Inspect code, tests, migrations, and relevant docs; document current behavior, not aspirations.
2. Preserve unrelated user changes. Keep the implementation lean and provider-agnostic without weakening correctness or isolation.
3. Add proportionate unit, route/service, contract, authorization-negative, database, and browser-flow coverage.
4. Update `docs/openapi.yaml` and affected architecture/security/setup/WebMCP docs in the same change. Update this file only when repository-wide guidance changes.
5. Record only meaningful continuation context in `docs/AI_HANDOFF.md`; omit trivial copy or visual edits.
6. Run type-check, lint, tests, build, audit, secret/env tracking checks, and relevant live database/browser validation.
7. Save every code/config/migration/doc change in Git. Commit and push a completed, verified change when permissions allow; GitHub is the shared source of truth.
8. Leave a concise handoff: files, migrations, environment changes, commands/tests, deployment impact, verified limitations, and remaining work.

Correctness, security, reliability, tenant isolation, and informed human control outrank speed, convenience, optimization, token reduction, or implementation simplicity. Documentation that disagrees with code is an incomplete change.
