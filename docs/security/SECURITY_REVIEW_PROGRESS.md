# Security review progress

## Review identity

- Review: fresh independent comprehensive security assessment
- Started: 2026-08-30
- Repository baseline: `fb0e5f6`
- Scope: both Next.js applications, both independent Supabase schemas and migrations,
  browser WebMCP, AR OAuth remote MCP, Vercel-facing configuration, synthetic data,
  and repository/dependency security.
- Rule: historical audits are context only and are not evidence for this review.

## Independently created review map

| Area | Subareas and trust boundaries | Status |
| --- | --- | --- |
| 1. Repository and deployment | tracked secrets, environment variables, dependencies, lockfile, Next/Vercel configuration, headers, public bundles | completed — no finding |
| 2. Authentication and sessions | AR/AP login and logout, cookie refresh proxies, protected pages, missing membership, safe redirects, OAuth consent session | completed — SEC-001 |
| 3. AR tenant authorization | organization membership, roles, RLS, grants, triggers, security-definer functions, reset, audit attribution | completed — SEC-002 |
| 4. AP supplier authorization | supplier membership, roles, RLS, grants, triggers, security-definer functions, reset, audit attribution | completed — SEC-002 also affects AP |
| 5. HTTP API boundary | authentication ordering, same-origin enforcement, media type and size limits, schemas, ID substitution, errors, caching | completed — no finding |
| 6. Browser WebMCP | 7 AR and 12 AP tools, page/session lifetime, schemas, untrusted data, confirmation boundary, zero cross-writes | completed — no finding |
| 7. AR OAuth remote MCP | discovery, DCR, PKCE, consent, redirect safety, JWT verification, exact audience, 11 tools, revocation, reset denial | completed — no finding; live token exchange limited by browser loopback policy |
| 8. Documents and sensitive data | PDF reads/uploads, byte and base64 bounds, structure, checksums, filenames, headers, logs and error redaction | completed — no finding |
| 9. Financial workflow integrity | validation, submissions, PO balances, exceptions, replacements, payments, idempotency, locks, replay and concurrency | completed — SEC-003 |
| 10. Live and independent verification | production negative tests, two-database isolation, OAuth/MCP E2E, full regression, dependency audit, baseline cleanup | completed — no regression or new finding |

The map is expandable if investigation discovers another subsystem or boundary.

## Major trust boundaries and enforcement

- Browser to application: Next.js server routes validate the Supabase session,
  request origin, media type, body size, and Zod contract.
- Application to database: an unprivileged publishable-key Supabase client carries
  the user JWT; RLS, grants, constraints, and transactional RPCs are authoritative.
- AR tenant boundary: `auth.uid()` maps to an AR profile and organization; database
  policies and RPC role checks scope every operation.
- AP supplier boundary: `auth.uid()` maps to an AP profile and supplier; database
  policies and RPC role checks scope every operation.
- Browser WebMCP: tools exist only in an authenticated top-level document and call
  the same same-origin routes as the human UI. Neither application can write to the other.
- Remote MCP: Supabase OAuth DCR/authorization-code/PKCE issues an exact-resource
  token; the MCP route verifies signature, issuer, audience, role, subject, client,
  active membership, host/origin, content type, and size before using bearer RLS.
- Financial/document boundary: invoice PDFs and financial state are synthetic but
  sensitive; reads remain tenant-scoped and mutations are transactional/idempotent.
- Deployment boundary: Vercel holds application environment values. Browser bundles
  may receive only the Supabase URL and publishable key; no service-role key is used.

## Cross-area flows to trace

1. Login -> refreshed cookie -> protected page/API -> service -> RLS query.
2. AR package read -> human-approved browser transfer -> AP validation/submission ->
   AP receipt -> AR result writeback.
3. AP exception/inquiry/replacement/payment -> AR follow-up/remittance writeback.
4. Human and remote-MCP ERP sync -> tenant-scoped transactional import and audit.
5. DCR -> PKCE authorization -> OpenFinance consent -> exact-audience token -> MCP
   tool -> bearer Supabase client -> RLS/RPC -> audit -> revocation.
6. Human-only reset -> exact confirmation -> role check -> canonical fixture restore;
   WebMCP and OAuth clients must not reach it.
7. Authenticated invoice/POD download and AP PDF upload validation from request bytes
   through persistence and later display.

## Scope facts established from the current repository

- Two separate applications and two separate Supabase migration histories.
- No shared application database, service-role client, storage bucket integration,
  webhook, queue, worker, real payment provider, real email provider, or real ERP API.
- Payment settlement and ERP sync are deterministic database-backed simulators.
- Current public interfaces: 10 AR same-origin API routes plus remote MCP/OAuth pages;
  13 AP same-origin API routes; 19 browser WebMCP tools; 11 remote AR MCP tools.

## Current findings

### SEC-001 — Unnecessary public user registration is enabled

- Severity: Low
- Status: fixed and individually verified
- Components: Supabase Auth configuration for both AR and AP projects
- Boundary: public identity provisioning and authentication-resource abuse
- Evidence: the live **Sign In / Providers** settings show **Allow new users to
  sign up** enabled in both projects, while the applications provide only sign-in
  flows and have exactly one fixed synthetic operator per independent portal.
- Reachability: the public Supabase Auth signup surface remains available to anyone
  with the intentionally public project URL/publishable key. Confirmation is enabled,
  so attempts can consume Auth/email quota even though RLS and profile triggers deny
  application data to arbitrary new users.
- Root cause: default public-signup configuration was not disabled for the private
  fixed-user challenge deployments.
- Impact: account/email/quota abuse and avoidable identity-surface expansion; no
  demonstrated tenant-data access because only the pre-existing exact demo email is
  mapped to a profile and email uniqueness prevents claiming it.
- Safe verification: dashboard configuration inspection only; no signup request or
  real email was sent.
- Remediation: disabled **Allow new users to sign up** in both hosted Supabase Auth
  projects while preserving email/password authentication, the existing fixed users,
  the AR OAuth server, and dynamic client registration.
- Verification: both independent dashboard controls now report `aria-checked=false`.
  Fresh navigation loaded the authenticated AR and AP workspaces with their existing
  sessions, and the authenticated AR agent-connections page remained available with
  no residual OAuth grants. Setup/security documentation now records the fixed-user
  provisioning rule.

### SEC-002 — Platform RLS event-trigger helper retains public execute privilege

- Severity: Low
- Status: fixed and individually verified
- Components: hosted AR and AP database function `public.rls_auto_enable()`; no
  repository migration currently governs its privilege
- Boundary: anonymous/authenticated database RPC privilege surface
- Evidence: the live catalog reports a `postgres`-owned `SECURITY DEFINER`
  event-trigger function with `search_path=pg_catalog` and `EXECUTE` granted to both
  `anon` and `authenticated`; the Supabase Security Advisor reports both grants.
- Reachability and impact: the exposed role can resolve the function and holds execute
  privilege. PostgreSQL prevents useful direct invocation because it returns
  `event_trigger`, and the body only enables RLS for newly created public tables;
  unprivileged roles also cannot create those tables. No read, write, or tenant bypass
  was demonstrated. The grant is nevertheless unnecessary privileged surface and is
  not represented in Git migrations.
- Safe verification: read-only catalog/function-definition inspection; no DDL or
  direct invocation was performed.
- Remediation: added and applied equivalent transactional migrations in both
  applications that preserve the owner-managed event trigger while revoking direct
  `EXECUTE` from `PUBLIC`, `anon`, and `authenticated` when the helper exists.
- Verification: the updated rollback-only AR RLS suite passed all 16 assertions and
  the AP RLS suite passed all 18 assertions, including explicit negative grant checks
  for every application role. Both hosted migrations completed successfully.

### SEC-003 — Four financial RPC wrappers trust caller-provided request fingerprints

- Severity: Low
- Status: fixed and individually verified
- Components: AP `respond_to_invoice_exception`, `create_invoice_inquiry`, and
  `replace_rejected_invoice`; AR `record_payment_remittance`
- Boundary: authenticated direct RPC access, retry/replay identity, and financial
  workflow result integrity
- Evidence: each current public `SECURITY INVOKER` wrapper forwards the caller's
  `p_request_fingerprint` unchanged. The corresponding private transaction returns
  the stored response when both the scoped idempotency key and caller-controlled
  fingerprint match, before validating the new payload. Unlike AP submission and AR
  delivery writeback, these four wrappers do not derive a digest from canonical
  `jsonb` content in PostgreSQL.
- Reachability: an authenticated operator/submitter can call the exposed PostgREST
  RPC directly with a reused key, changed payload, and the same syntactically valid
  forged fingerprint. The database then returns the first response as though the
  changed retry were identical. RLS and the RPC's profile lookup keep the behavior
  within the caller's own organization or supplier, and the path does not duplicate
  a payment or other side effect.
- Root cause: authoritative digest derivation was added to the original delivery and
  submission RPCs but not to the later exception-to-cash mutation wrappers.
- Impact: a direct authenticated caller can make a changed retry receive a stale
  success result, weakening deterministic audit/writeback semantics. There is no
  demonstrated cross-tenant access, privilege escalation, overpayment, or duplicate
  financial mutation.
- Safe verification: exact current wrapper and private-function control flow was
  traced from the public PostgREST entry point through the early idempotency return.
- Remediation: preserved all public RPC signatures for compatibility but replaced
  the four wrappers so they ignore the untrusted digest and derive SHA-256 from
  canonical `jsonb` inside PostgreSQL before entering each private transaction.
- Verification: migrations were applied to both hosted databases. The AP exception-
  to-cash suite passed 21 assertions and the AR suite passed 16. Direct authenticated
  RPC tests reuse a key and forged caller fingerprint with changed inquiry/remittance
  payloads and receive the exact expected `23505` conflict. Focused application
  service tests also passed: 23 tests, 38 expectations.

## Test and review log

- Repository inventory, route inventory, dependency manifests, database migration
  inventory, and security-sensitive symbol scan completed.
- Focused AR remote MCP/config tests: 18 passed, 32 expectations.
- `bun run typecheck`: passed for both applications.
- `bun run lint`: passed for both applications with zero warnings.
- `bun audit`: no known dependency vulnerabilities.
- `bun run build`: both optimized production builds passed. Their browser-static
  output contained no service-role, private-key, database-URL, or server-only MCP
  configuration marker.
- Git currently tracks only `.env.example`; `.env`, `.env.*`, provider state,
  build output, reports, logs, and TypeScript build metadata are ignored. Current
  and historical tracked-filename scans found no credential/private-key file.
- Current-source secret patterns found no credential value. No machine-specific
  absolute path is tracked. The only loopback URLs are documented development and
  OAuth test values.
- Both production origins returned private/no-store redirects for unauthenticated
  workspaces plus CSP, frame denial, no-sniff, COOP/CORP, no-referrer, restricted
  permissions, and Vercel HSTS. The unauthenticated MCP response also returned a
  correct RFC 9728 Bearer challenge and `Vary: Authorization`.
- Area 2 traced both password-login server actions, logout, cookie-refresh proxies,
  protected pages, API authentication, profile/tenant membership lookups, AR return
  paths, connections, and OAuth consent actions. Authentication uses signed Supabase
  claims and RLS-visible profiles rather than client roles or tenant IDs.
- Unauthenticated and malformed-cookie requests redirected protected pages to login
  and returned generic `401` API errors. External and scheme-relative AR `returnTo`
  values were reduced to `/`; valid internal paths were preserved. Invalid consent
  IDs returned a non-sensitive restart page.
- Signup configuration was independently inspected in both live projects and produced
  SEC-001. No signup request or confirmation email was generated.
- Area 3 reconstructed all ten current AR public tables, policies, grants, triggers,
  public wrappers, private security-definer functions, OAuth audience hook, audit
  attribution, and reset boundary from migrations and the live catalog. Every public
  table has RLS enabled; anonymous reads are denied; authenticated direct writes are
  denied. The two internal ERP tables grant authenticated users no table access.
- All eight rollback-only AR database suites passed: delivery events 17 assertions,
  reset 15, ERP 19, exception/cash 13, MCP OAuth 10, token audience 6, PDFs 16, and
  RLS 13. A separate five-assertion two-tenant challenge created a disposable tenant
  and user inside a rollback transaction; Tenant B saw only its invoice and could not
  mutate or reset Tenant A.
- Supabase Security Advisor reported zero errors. Its reset warning is intentionally
  guarded by role, fixed organization, and OAuth-client checks and was verified by
  tests. Its platform `rls_auto_enable()` warning produced SEC-002. Leaked-password
  protection is disabled, but the only active portal users have unique rotated
  credentials; public registration is addressed separately by SEC-001.
- Production protected-resource metadata returned `200`; unauthenticated MCP returned
  `401`. Full remote OAuth testing is pending within area 7.
- Area 4 reconstructed all sixteen current AP public tables, supplier policies,
  grants, triggers, public wrappers, private security-definer functions, exception
  authority guard, canonical PDF checks, payment simulator, and reset boundary from
  migrations and the live catalog. Every public table has RLS enabled; anonymous
  reads are denied; authenticated users have read-only table grants; all direct
  table writes are denied.
- All five rollback-only AP database suites passed: reset 19 assertions,
  exception-to-cash 16, payment settlement 15, RLS 15, and submission wrapper 14.
  A separate seven-control two-supplier challenge created a disposable buyer,
  supplier, user, requirements record, and purchase order inside a rollback
  transaction. Supplier B resolved only from its signed user context, saw its own
  purchase order, could not read Supplier A purchase orders or submissions, could
  not write tables directly, could not reset Supplier A, and could not submit
  against Supplier A's purchase order.
- The AP Security Advisor reported zero errors. Its two `rls_auto_enable()` warnings
  extend SEC-002 to both databases. Its leaked-password warning is not independently
  reachable as an application vulnerability after the fixed-user signup surface in
  SEC-001 is removed; the existing demo credential remains subject to normal login
  rate limiting and is intentionally public for challenge judging.
- Area 5 traced all ten AR and thirteen AP same-origin endpoints through their Zod
  schemas, services, bearer-cookie Supabase clients, RLS reads, and transactional
  RPC writes. Every write-like POST requires exact same-origin JSON before parsing;
  authentication is checked before request-body parsing; every resource lookup is
  subsequently tenant/supplier scoped by RLS or an RPC; and database errors are
  mapped to bounded application messages. Document downloads validate stored bytes
  and use attachment, length, type, checksum, and private/no-store headers.
- Safe production probes confirmed valid-origin POSTs without a session return
  generic `401`, cross-origin POSTs return `403`, wrong media types return `415`,
  malformed query filters return bounded `400` or generic `401`, and no response
  exposed database detail. Vercel marks error responses `public, max-age=0,
  must-revalidate`; because the bodies contain no protected data and require
  revalidation, this is not a confirmed disclosure. Successful protected responses
  explicitly use `private, no-store`.
- Area 6 traced both tool registries, browser API clients, schemas, annotations,
  registration cleanup, authenticated page mounts, state-refresh events, and every
  tool-to-route mapping. Live authenticated workspaces exposed exactly seven AR and
  twelve AP tools; both login documents exposed zero. Read-only tools were invoked
  across every functional family: AR ready invoices, package PDFs, follow-ups, and
  supporting evidence; AP requirements, all nine POs, detailed PO context, supplier
  invoices, status/timeline, exception ownership, validation, and remittance.
- A malformed synthetic PDF was rejected by AP WebMCP preflight without mutation.
  The browser security layer correctly refused a consequential live submission that
  lacked exact per-payload approval; the attempted payload was invalid and no AP
  state changed. Write-path security remains covered by the 79 AP database assertions
  and will receive one exact approved end-to-end workflow during final verification.
- Human UI parity was verified from the implementation: every tool-supported read or
  write has a visible equivalent through the same protected routes, with explicit
  checkboxes for submissions, exception responses, replacements, and inquiries.
  Neither registry contains a cross-origin endpoint or a direct write to the other
  application. React renders all portal-authored text as escaped text nodes.
- Area 7 traced protected-resource and authorization-server discovery, dynamic client
  registration, authorization-code plus S256 PKCE, the OpenFinance consent actions,
  redirect validation, grant listing/revocation, ES256/JWKS token verification, exact
  issuer and MCP-resource audience, required OAuth client identity, live profile and
  organization membership, the stateless JSON MCP transport, bearer Supabase/RLS
  propagation, all eleven tools, audit attribution, and the absence of any reset tool.
  No confirmed vulnerability was found.
- A disposable public DCR client reached the live consent screen as the signed-in AR
  operator. The screen accurately displayed the client name, loopback redirect,
  requested email scope, AR capabilities, tenant/RLS boundary, and revocation path;
  approval produced a one-time authorization-code redirect. The Codex browser then
  blocked the loopback callback URL, so the final live access-token exchange and
  bearer tool call could not be completed in this environment. This is an explicit
  verification limitation, not evidence of an application defect. The temporary
  OAuth client was deleted in Supabase, which removed its grant; the live OpenFinance
  connections page subsequently showed no connected agents.
- Live remote-boundary probes confirmed unauthenticated and malformed bearer requests
  return `401` plus the protected-resource challenge, a cross-origin request and
  disallowed preflight return `403`, an allowed-origin preflight returns `204`, and
  authenticated responses are configured private/no-store. Focused configuration,
  OAuth, verifier, MCP inventory, validation, and documentation tests passed again:
  18 tests and 32 expectations.
- Area 8 traced invoice and supporting-document bytes from AR database rows through
  canonical-base64 decoding, one-megabyte bounds, classic-PDF structural validation,
  SHA-256 verification, safe filename validation, tenant-scoped reads, HTTP download
  headers, browser Blob downloads, AP client preflight, Zod payload bounds, server
  revalidation, and authoritative SQL constraints/RPC checks. AP persists bounded
  document metadata for submissions and protected bytes only for exception evidence;
  all access remains supplier-scoped. No URL fetch, filesystem path, HTML rendering,
  executable document processing, or sensitive request logging exists in these flows.
- Focused document tests passed: 23 tests and 48 expectations covering exact download
  bytes and private headers, authentication ordering, encoded-size bounds, strict
  schemas, canonical base64, checksum mismatch, truncated and pseudo-PDF rejection,
  startxref coherence, valid preflight, and transactional submission dispatch. The
  earlier rollback-only database suites also cover 16 AR PDF assertions and AP
  submission/attachment constraints.
- Live human-path verification selected `INV-10482`, exposed and activated its
  authenticated invoice download, loaded and activated the `INV-10417` proof-of-
  delivery download, transferred the exact checksum-valid `INV-10482.pdf` through
  the AP file chooser, and received a successful read-only preflight. A disposable
  header/EOF pseudo-PDF was rejected in the same human form with the explicit
  structural-validation error. The preflight batch and temporary files were removed;
  no invoice was submitted and no database state changed.
- Area 9 traced every financial mutation from same-origin API and WebMCP entry points
  through application schemas/services into the current effective PostgreSQL
  wrappers and transactions. AP submission validates canonical structural PDFs,
  derives request identity in PostgreSQL, serializes same-key retries and PO rows,
  atomically reserves remaining balance, rejects duplicate invoice numbers, and
  emits receipt/status/audit state. Exception responses enforce supplier versus
  buyer authority, required evidence, serialized idempotency, locked exception state,
  and atomic attachments/timeline/audit. Replacements lock current invoice and PO
  state, refund/re-reserve balances atomically, require an allowed correction, void
  the superseded revision, and cannot replace a settled invoice. Inquiries are
  supplier-scoped and atomic.
- AP payment simulation assigns every second accepted submission a unique settlement
  sequence and deterministic ten-second eligibility, while status reads settle due
  rows through an atomic upsert. AR delivery writebacks enforce state monotonicity,
  reference immutability, explicit replacement concurrency tokens, and database-
  derived request identity. AR remittance locks the invoice, requires a verified
  portal receipt and matching currency, sums prior payments under the row lock,
  prevents overpayment and duplicate references, and updates invoice/audit state in
  the same transaction. ERP sync row-locks its alternating state and the reset RPCs
  are fixed-tenant, role-gated, OAuth-client-denied, transactional fixture restores.
- Cross-PO replacement requests can deadlock only as a safe transaction abort; no
  reachable partial balance update was found. A concurrent reset and normal workflow
  serializes through row/table locks and commits atomically, though whichever valid
  transaction completes last determines the visible post-reset state as expected.
  The only confirmed financial-integrity gap is SEC-003.
- SEC-002 remediation added
  `services/openfinance/supabase/migrations/202608300011_restrict_rls_event_trigger_helper.sql`
  and `services/acme/supabase/migrations/202608300012_restrict_rls_event_trigger_helper.sql`,
  applied both migrations to their respective hosted projects, and extended the two
  RLS suites. AR passed 16 assertions and AP passed 18; the helper remains installed
  for owner-managed event-trigger execution but no application role has execute.
- SEC-003 remediation added
  `services/acme/supabase/migrations/202608300013_derive_financial_request_fingerprints.sql`
  and
  `services/openfinance/supabase/migrations/202608300012_derive_remittance_request_fingerprint.sql`.
  Both were applied live. AP passed 21 focused database assertions, AR passed 16,
  and 23 affected application-service tests passed with 38 expectations.
- SEC-001 remediation disabled public signup in both independent hosted projects.
  Both controls were re-read as disabled; the existing AR/AP sessions and AR OAuth
  connections workspace remained valid. No disposable user or email was created.

## External and cleanup state

- The temporary public DCR audit client and its grant were deleted. No audit token,
  verifier, authorization code, or client credential was persisted to the repository.
- The final live challenge exercised the exact two-invoice transfer, AP validation and
  submission, AR receipt writeback, buyer-owned inquiry, supplier-owned evidence
  response, deterministic payment, and AR remittance writeback. A same-payload
  remittance retry returned the original result and a changed-payload retry was
  rejected. The buyer-owned blocker rejected supplier resolution with the explicit
  authority-boundary message.
- Final unauthenticated production probes returned `401` for a same-origin API request
  without a session, `401` plus the RFC 9728 challenge for a malformed MCP bearer, and
  `403` for a cross-origin MCP request.
- Both applications were restored through their human reset controls. The final
  baseline exposes seven ready AR invoices, three historical AP submissions, no
  `INV-10482` AP submission, seven AR WebMCP tools, twelve AP WebMCP tools, one reset
  audit event per application, and no connected OAuth agent.

## Independent post-remediation verification

- Repository regression: `bun test` passed 121 tests with 502 expectations;
  `bun run typecheck`, `bun run lint`, both production builds, `bun audit`, and
  `git diff --check` passed. The dependency audit reported no vulnerabilities.
- Database regression: all 115 AR and 87 AP rollback-only assertions passed (202
  total), including RLS, two-tenant isolation, financial idempotency, OAuth audience,
  PDFs, reset authorization, exception authority, replacement, and payment behavior.
- Live end-to-end verification independently traced browser WebMCP through protected
  HTTP routes, RLS/RPC enforcement, persisted AP state, and verified AR writeback. It
  also confirmed the resulting human UI and tenant-scoped audit trails in both apps.
- The Supabase Security Advisors report zero errors. Remaining warnings are the
  intentionally role-gated synthetic reset function in AR and leaked-password
  protection for the two fixed public challenge credentials; neither had a reachable
  tenant or data bypass after public signup was disabled.
- Final result: three Low findings fixed, zero Critical/High/Medium findings, zero
  unresolved findings, zero blockers, and no regression or new finding discovered
  during independent verification.

## Exact continuation point

Review, remediation, regression testing, live independent verification, and clean
baseline restoration are complete. Commit and push the reviewed files; no security
implementation work remains from this assessment.
