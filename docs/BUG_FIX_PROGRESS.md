# Independent codebase review and remediation progress

## Review mandate and scope

This is a fresh, implementation-led review started on August 30, 2026. It is
adapted to OpenFinance's actual architecture: two independent Next.js/Vercel
applications with separate Supabase projects, browser WebMCP as the only AR to
AP interoperability path, and a separately authenticated OAuth remote MCP for
the AR application. Historical reports may be consulted only after an area has
been independently reviewed; they are not evidence of correctness or coverage.

## Independent review map and coverage

| Area | Subareas and principal risks | Status |
| --- | --- | --- |
| 1. Repository, configuration, deployment | package boundaries, CI, `.env` handling, headers, proxy behavior, build/runtime assumptions | completed — no confirmed finding |
| 2. OpenFinance AR application | login/session, workspace UI, HTTP routes, schemas, AR domain/services, audit and document download flows | completed — F-001 confirmed |
| 3. Acme AP application | login/session, workspace UI, HTTP routes, schemas, PO/submission/exception/inquiry/replacement/remittance domain flows | completed — F-002 confirmed |
| 4. Browser WebMCP surface | tool registration lifetime, schemas, user confirmation, cancellation, route contracts, UI-state updates | completed — no confirmed finding |
| 5. AR OAuth remote MCP | metadata, DCR/PKCE/consent, token and audience validation, tool authorization, connection revocation | completed — no confirmed finding |
| 6. AR Supabase database | ordered migrations, constraints, RLS, grants, RPCs, triggers, audit, sync, reset, documents, remittance | completed — no confirmed finding |
| 7. AP Supabase database | ordered migrations, constraints, RLS, grants, RPCs, triggers, audit, PO policy, submissions, payments, reset | completed — F-002 confirmed |
| 8. End-to-end interoperability | ready invoice discovery to AP preflight, explicit approval, atomic submission, AR writeback, exceptions, revisions, payment discovery | completed — F-002 carries through the document-transfer path |
| 9. Cross-cutting verification and contracts | OpenAPI, MCP docs, setup/docs agreement, regression suites, production behavior, performance-sensitive paths | completed — F-003 confirmed |

## Review order and required traces

1. Shared repository/configuration and public entry boundaries.
2. AR application from page and WebMCP entry points through services and AR
   database contracts.
3. AP application through its equivalent database contracts.
4. Browser WebMCP and remote MCP/OAuth as separate integration surfaces.
5. Both database implementations, in migration order, followed by their
   cross-application invariants.
6. Independent end-to-end, contract, documentation, and deployment review.

Required end-to-end traces are: AR readiness/package/document access; AP
requirements/PO validation; explicit human approval and AP batch submission;
AR outcome and exception writeback; payment/remittance discovery; supplier
evidence response; rejected-invoice replacement; OAuth remote-MCP authorization
and revocation; and independently authorized demo resets.

## Security-sensitive boundaries

- Separate authentication sessions, app roles, tenants/suppliers, databases,
  and deployment configuration.
- Server-side authentication before parsing or acting on untrusted data.
- Supabase RLS, public wrapper grants, private transaction functions, trigger
  behavior, and tenant/supplier identifiers at every data boundary.
- OAuth client registration, PKCE, consent, bearer token issuer/audience,
  refresh/revocation, and prevention of OAuth access to human-only actions.
- Invoice/PDF integrity, object/document access, financial state transitions,
  idempotency keys, and payment/remittance records.

## Current independent review state

- Historical progress file existed: no. Historical verification and handoff
  files are available but have not informed the map or current findings.
- Area 1 completed independently: CI uses frozen install plus lint, type-check,
  tests, build, and audit; only `.env.example` is tracked; `.env.local` is
  ignored; no privileged key is referenced; both apps set protective headers;
  production MCP configuration rejects an unsafe/non-canonical resource URL;
  and every discovered browser BFF write route calls the same-origin and
  authentication guards before body parsing. Focused configuration and
  production-contract tests passed (48 tests, 337 expectations), and the live
  dependency audit reported no vulnerabilities. No evidence-supported issue was
  found in this area.
- Area 2 completed independently: traced login/profile recovery, protected page
  loading, queue/package/document/evidence/remittance flows, same-origin BFF
  routes, strict request schemas, verified-PDF download checks, error mapping,
  audit degradation, and human/browser-tool state refresh. The AR unit suite
  passed (41 tests, 70 expectations). Backend/RLS enforcement is reserved for
  Area 6 and remote OAuth transport for Area 5. F-001 is confirmed.
- Area 3 completed independently: traced login/session recovery, protected
  workspace loading, every BFF route, strict request schemas, human and
  browser-tool write flows, PO/context reads, exception response, replacement,
  inquiry, remittance, scheduled settlement refresh, and API error mapping.
  The AP unit suite passed (19 tests, 34 expectations). Database/RLS mutation
  enforcement is reserved for Area 7. F-002 is confirmed.
- Area 4 completed independently: compared the seven AR and twelve AP
  page-scoped registrations with their same-origin routes and human workspaces.
  Tools have bounded schemas, accurate read annotations, cancellation forwarding,
  explicit consequential-write language where required, and dispatch a visible
  state-refresh event only after successful writes. Registration uses the
  authenticated page lifetime's abort signal and cleanup fallback. No
  evidence-supported defect was found in this layer; backend authority and
  database effects remain under Areas 6 and 7.
- Area 5 completed independently: traced resource metadata, the unauthenticated
  bearer challenge, Supabase OAuth authorization-server discovery, DCR/PKCE
  delegation, consent decision flow, revocation, host/origin boundary checks,
  request-size/content-type limits, ES256 issuer/audience/claim verification,
  unprivileged bearer client creation, and tenant-derived tool services. Live
  read-only checks returned the expected resource metadata and a 401 Bearer
  challenge pointing to it. The remote MCP tests cover inventory, invalid
  tool input, token claims, role rejection, and error normalization. No
  evidence-supported defect was found; database role/RLS enforcement is
  deliberately reviewed in Area 6.
- Area 6 completed independently: reviewed all seventeen AR migrations and
  their pgTAP coverage. Every exposed table has RLS and a tenant-scoped select
  policy; direct writes are revoked. Public RPC wrappers are security invokers
  and invoke tightly scoped, empty-search-path functions that derive the user
  and organization themselves. The review traced delivery status monotonicity,
  advisory-lock idempotency, ERP alternation, detailed PDF rendering,
  evidence, remittance totals, audit attribution, human-only reset, and the
  OAuth token-audience hook. No evidence-supported data-integrity, tenant, or
  authorization defect was found. Live SQL execution is deferred to the final
  verification because this workspace does not contain a local Supabase test
  runtime or administrative database credential.
- Area 7 completed independently: reviewed all fourteen AP migrations and the
  pgTAP suite. Supplier-scoped RLS protects every exposed table; direct writes
  are revoked; public RPCs are security invokers and private functions derive
  supplier/buyer and role from `auth.uid()`. The review traced PO locks and
  balances, duplicate/idempotency serialization, exception responses,
  corrected revisions, inquiry ledgers, payment scheduling/status projection,
  reset, audit, and current-revision reads. F-002 is also present in the
  authoritative SQL paths for submissions, replacements, and evidence.
  No additional evidence-supported defect was found. Live SQL execution is
  deferred to final verification because no local Supabase runtime or
  administrative database credential is present in the workspace.
- Area 8 completed independently: traced AR ready filtering and package bounds,
  browser transfer-approval language, AP policy/PO/preflight, atomic confirmed
  submission, receipt/reference writeback, exception recording, visible-state
  refresh, 10-second payment discovery, remittance reconciliation, and the
  extended evidence/replacement/inquiry flows. Route and schema boundaries are
  same-origin and application-local; no hidden AR/AP server bridge was found.
  F-002 remains reachable through the otherwise-governed document transfer.
- Area 9 completed independently: compared current routes, schemas, tool
  inventories, application behavior, OpenAPI, setup, security, architecture,
  and judge-facing materials. F-003 is confirmed. Historical verification and
  handoff records were then consulted only as context and do not alter these
  independently derived findings.
- Final independent review summary: three confirmed findings — zero Critical,
  zero High, one Medium, and two Low. Remediation order is F-002 (document
  integrity and human-review reliability), F-001 (accurate AR MCP capability
  disclosure), then F-003 (accurate judge-facing WebMCP disclosure). No
  immediate repository-integrity issue required an exception to the review-
  before-remediation rule.
- Current remediation: F-002, F-001, and F-003 are implemented and awaiting
  combined independent post-implementation verification. F-004 was introduced
  and fixed during regression validation; it is included below for traceability.
- Independent post-implementation verification: complete for repository code
  and contracts. The latest fresh run passes 118 tests and 494 expectations;
  both type-checks, both lints, both production builds, `bun audit`, OpenAPI
  parsing, environment-tracking check, and `git diff --check` pass. The AP
  structural-PDF migrations are now applied to the live project. The complete
  rollback-only AP suite passes after independently correcting the bytea
  inspection implementation, canonicalizing PDF fixtures, and aligning the
  settlement privilege assertion with the current RLS-scoped read model.
- Exact continuation point: deploy the current UI/auth changes, run the final
  confirmed cross-site invoice transfer and submission, verify the resulting
  AP status/remittance and AR writeback in both WebMCP and human UI, then
  restore both independent demo workspaces.

## Current findings and remediation log

### F-001 — Remote MCP information page omits three active tools

- Severity: Low
- Status: resolved in source; independently regression-tested.
- Affected component: `apps/openfinance-ar/app/mcp-info/page.tsx`.
- Evidence: its static `tools` array contains eight names. The current remote
  MCP server registers eleven, including `list_portal_followups`,
  `get_invoice_supporting_documents`, and `record_payment_remittance`; the
  independently read remote MCP test and `docs/MCP.md` both list all eleven.
- Root cause: the public information page duplicates an older static inventory.
- Impact: no authorization, data, or tool execution behavior is affected, but
  users evaluating or connecting an agent are shown an incomplete capability
  contract and may miss evidence/remittance workflows.
- Remediation direction: update the information-page inventory and add a narrow
  regression test that keeps it aligned with the documented/advertised set.
- Remediation performed: expanded the public page inventory to all eleven live
  remote-MCP tools and exported it for a narrow regression test. No reset tool
  is advertised.
- Files changed: `apps/openfinance-ar/app/mcp-info/page.tsx`,
  `apps/openfinance-ar/app/mcp-info/page.test.ts`.
- Tests executed: dedicated page inventory test, remote-MCP server suite,
  OpenFinance type-check and lint; all passed.
- Documentation updated: `docs/SUBMISSION.md` now distinguishes the browser
  tool inventory from the separately documented eleven-tool remote MCP.
- Exact next action: re-check the final page/remote-server inventories together
  during combined verification.

### F-002 — AP accepts non-renderable pseudo-PDF invoice documents

- Severity: Medium
- Status: resolved in source and live database; independently regression-tested.
- Affected components: `apps/acme-ap/lib/services/submission-service.ts`
  (`inspectDocument`), `services/acme/supabase/migrations/202608290006_validate_pdf_structure.sql`
  (`public.submit_invoice_batch`),
  `services/acme/supabase/migrations/202608300002_replace_rejected_invoice.sql`,
  and `services/acme/supabase/migrations/202608300005_validate_attachment_pdfs.sql`.
- Evidence: the application service and database procedures accept a document
  when its base64 is canonical, it starts with `%PDF-`, contains `%%EOF` near
  the end, and has the declared hash; none validates a PDF object graph. During
  this fresh audit, the authenticated live AP `validate_invoice` WebMCP tool
  returned `valid: true` and no issues for `AUDIT-PDF-001` using the bytes
  `%PDF-1.4\nThis is deliberately not a complete PDF object graph.\n%%EOF`.
  This was a read-only validation call and did not create application data. The
  SQL test fixtures also use this header-and-EOF-only form as successful
  document fixtures.
- Root cause: the AP shared validation contract calls this minimal marker check
  a valid PDF, although a document with no catalog, page, cross-reference, or
  valid `startxref` structure cannot reliably be opened by a PDF viewer.
- Impact: a submitted or replacement invoice, or a supporting attachment, can
  be accepted even though a human or agent cannot inspect it as a real PDF.
  That undermines the governed human-review path and creates avoidable
  downstream processing failures. The reviewed path does not expose another
  tenant or credentials.
- Remediation direction: introduce one bounded structural-PDF validation rule
  across the AP server preflight and authoritative SQL mutation paths. It
  should at least require a catalog, page, `startxref`, and an in-range offset
  that points to an `xref` table, while retaining size, canonical-base64,
  checksum, and media-type checks. Add focused service and database regression
  tests for the live pseudo-PDF case and apply the rule consistently to new
  submissions, replacements, and attachments. Update the OpenAPI/document
  rules to describe the final enforced contract.
- Remediation performed: added a browser-safe structural validator for immediate
  upload feedback and service preflight; added forward-only AP migration
  `202608300009_enforce_structural_pdf_contract.sql` that makes the public
  submit wrapper, replacement transaction, and evidence constraint require
  canonical classic-PDF structure. Successful SQL fixtures now generate a
  valid catalog/page/xref document, and the former pseudo-PDF has a dedicated
  database regression assertion.
- Files changed: AP workspace/service/tests, the new migration, AP SQL tests,
  `AGENTS.md`, OpenAPI, architecture/security/WebMCP/setup docs, the AP service
  README, and `docs/AI_HANDOFF.md`.
- Tests executed: focused UI/service tests (15 pass), full AP suite (24 pass),
  final repository suite (115 pass, 479 expectations), both type-checks,
  both lints, both production builds, `bun audit` (no vulnerabilities), and
  OpenAPI/environment/diff checks.
- Database/manual verification: migrations `202608300009` and corrective
  `202608300010` are applied to project `lakrgujjrhydjsoyaiin`. All five AP
  rollback-only SQL suites pass. The live WebMCP preflight must still be
  repeated after the current UI build deploys as part of the final workflow.
- Exact next action: verify one approved live structural invoice package through
  preflight and confirmed submission, then verify the remittance/UI state.

### F-003 — Judge-facing submission copy advertises an obsolete WebMCP inventory

- Severity: Low
- Status: resolved in source; independently regression-tested.
- Affected component: `docs/SUBMISSION.md`.
- Evidence: the current live/browser inventory, `docs/WEBMCP.md`, `AGENTS.md`,
  and the final-submission gate all consistently identify seven AR and twelve
  AP tools. However, the judge-facing “How WebMCP was implemented” paragraph
  still says that AR exposes four tools and Acme exposes five. It also omits
  the live follow-up, evidence, remittance, PO-detail, portfolio, exception,
  revision, and inquiry capabilities.
- Root cause: expanded tool implementation was not propagated to the earlier
  ready-to-paste submission description.
- Impact: an evaluator receives a materially incomplete implementation
  explanation even though the application correctly exposes the expanded
  capability set. This reduces clarity and can weaken challenge evaluation;
  it does not affect runtime authorization or data.
- Remediation direction: replace the stale numeric/tool summary with a concise,
  accurate description of the seven AR and twelve AP tools and their governed
  human-agent workflow. Keep it aligned with `docs/WEBMCP.md` without copying
  a second full inventory.
- Remediation performed: replaced the stale 4/5-tool paragraph with a concise,
  accurate description of the seven AR and twelve AP browser tools and their
  human-control boundary.
- Files changed/tests/verification: `docs/SUBMISSION.md`; full OpenAPI and
  production-contract coverage passed in the 114-test suite.
- Exact next action: verify submission copy against `docs/WEBMCP.md` one final
  time during documentation review.

### F-004 — OpenAPI description briefly became invalid YAML during remediation

- Severity: Low
- Status: resolved before completion.
- Evidence/root cause: the initial F-002 documentation edit introduced an
  unquoted colon in a plain YAML scalar. The first full repository regression
  run failed both OpenAPI parsing tests with `YAML Parse error: Unexpected
  token`.
- Remediation performed: converted the description to a folded YAML block
  scalar and re-ran the entire suite.
- Files changed/tests/verification: `docs/openapi.yaml`; final suite now
  passes 115 tests and 479 expectations.
- Exact next action: include OpenAPI parsing in the final combined verification.

### F-005 — AP human UI omitted exact remittance and complete discovery context

- Severity: Medium
- Status: resolved in source; focused tests pass; live deployment verification pending.
- Evidence: `get_payment_remittance` returned payment status, method, schedule,
  exact allocation, and currency through `/api/agent/remittance`, but no human
  control called that route. The invoice list had no WebMCP-equivalent status
  or PO filters, and the status/PO cards omitted inquiry, resolution, allowed
  action, tolerance, evidence, and line details already returned by services.
- Remediation: added a read-only remittance lookup, supplier-portfolio filters,
  complete PO detail, and complete status/exception/inquiry presentation using
  existing authenticated routes and data. No business rule moved to the client.
- Tests: added filter behavior tests and expanded the repository parity contract.

### F-006 — Workspace queries could fail before membership recovery

- Severity: Medium
- Status: resolved in source; focused tests pass; live deployment verification pending.
- Evidence: both production roots produced server errors while simple
  authenticated API reads still succeeded. Each root launched tenant data
  queries concurrently with its profile lookup and checked profile failure only
  afterward, bypassing the intended `profile_missing` recovery boundary.
- Remediation: both apps now resolve and validate profile plus organization or
  supplier membership before starting parallel tenant-scoped workspace reads.
- Tests: the production contract now enforces membership resolution ordering.

### F-007 — Initial structural-PDF migration called a nonexistent bytea function

- Severity: High
- Status: resolved and applied to the live AP database; all AP SQL suites pass.
- Evidence: after applying `202608300009`, a real valid structural PDF reached
  `private.is_structurally_valid_pdf` and PostgreSQL raised `42883` because
  `pg_catalog.replace(bytea, bytea, bytea)` does not exist. This blocked the
  core invoice-submission transaction.
- Root cause: static source assertions did not execute the new PL/pgSQL helper.
- Remediation: forward migration `202608300010_repair_binary_pdf_inspection.sql`
  uses PostgreSQL `encode(bytea, 'escape')`, preserving searchable ASCII PDF
  structure while safely representing arbitrary binary bytes. Canonical SQL
  fixtures now strip PostgreSQL base64 line wrapping. The payment suite now
  asserts the current least-privilege model: supplier-scoped settlement SELECT
  through RLS, with INSERT/UPDATE/DELETE denied.
- Verification: live AP reset 14/14, exception-to-cash 16/16, payment 15/15,
  RLS 15/15, and submission-wrapper 14/14 passed in rollback transactions.

## August 31 contest-readiness re-verification

This was a fresh review of the current implementation. The August 30 map and
findings above were historical context only and were not used to narrow scope
or establish correctness.

| Review area | Current coverage | Result |
| --- | --- | --- |
| Repository and deployment | workspaces, CI, dependency graph, ignored environments, license, fresh clone, Vercel builds | complete |
| Authentication boundaries | login, profile recovery, session refresh, protected routes, unauthenticated behavior | complete |
| OpenFinance AR | queue, packages, PDF/evidence, outcome/exception/remittance, sync, audit, human UI | complete — F-010/F-011 |
| AR remote MCP | metadata, OAuth resource/audience, RLS-bound services, consent/revocation, contest separation | complete |
| Acme AP | PO policy, validation, submission, status, exception, replacement, inquiry, payment, human UI | complete — F-008/F-009/F-011 |
| Database state machines | migrations, RLS/grants, tenant derivation, locks, idempotency, reset, payment sequence | complete by source and contract review |
| Cross-application workflow | 7 + 12 tools, package normalization, AP preflight, authority branches, remittance, zero cross-writes | complete for read paths; final stateful replay pending |
| Human UX and documents | PDF download/render/upload, detail views, responsive containment, feedback, console | complete |
| Contracts and submission | OpenAPI, MCP docs, setup, public repo/license, challenge requirements and judging criteria | complete |
| Independent final verification | fresh GitHub clone, full tests/type-check/lint/build/audit, public headers, fresh live tabs | complete except final stateful replay/reset |

### F-008 — AP refresh discarded complete invoice detail

- Severity: Medium.
- Status: fixed, deployed, and regression-tested.
- Evidence/root cause: `AcmeWorkspace.refresh()` replaced the active status
  detail with a row from the summary portfolio endpoint. Summary rows do not
  contain timeline, exception, inquiry, or revision data, so any successful
  tool mutation or scheduled settlement refresh silently removed those fields.
- Remediation: when a detail card is active, refresh now loads the supplier-
  scoped status endpoint concurrently with the workspace summary and replaces
  the detail only with that authoritative complete response.
- Tests: production parity contract plus full 124-test fresh-clone suite;
  production status UI displays complete timeline and exception metadata.

### F-009 — Replacement conflict could expose PostgreSQL error text

- Severity: Low.
- Status: fixed, deployed, and regression-tested.
- Evidence/root cause: the service returned arbitrary `error.message` for every
  PostgreSQL `23514` replacement failure. A constraint error could disclose
  internal table or constraint names through the public API.
- Remediation: all replacement-state conflicts now return one stable public
  message. A focused service test supplies an internal-looking database error
  and proves that it is not exposed.

### F-010 — Primary AR workspace advertised out-of-scope remote MCP tools

- Severity: Low (contest execution).
- Status: fixed and deployed.
- Evidence/root cause: although submission documentation correctly excludes the
  optional own-system remote MCP, the primary challenge workspace prominently
  linked to it and displayed `7 site + 11 remote tools`, competing with the
  browser challenge's deliberate `19 tools, zero cross-writes` story.
- Remediation: retained the optional routes and documentation but removed their
  marketing block and dead styles from the primary judge workspace. A contract
  test prevents the out-of-scope count from returning there.

### F-011 — Locale-dependent timestamps caused production hydration errors

- Severity: Medium.
- Status: fixed, deployed, and independently verified live.
- Evidence/root cause: both workspaces formatted timestamps without an explicit
  timezone. Vercel rendered in UTC while the browser rendered in its local
  timezone, producing React hydration error 418 in both production consoles.
- Remediation: both server/client formatters now use explicit UTC fields and a
  visible UTC timezone label. Fresh production tabs render the same text and
  report zero warnings or errors. A contract test enforces the deterministic
  timezone configuration.

### Operational finding — judge baseline was not canonical

- Status: resolved and independently verified live on August 31.
- Evidence: the live read-only pass found four ready Acme invoices in AR and
  five AP submissions, including the prior `INV-10479` revision and two prior
  invoice submissions. The documented clean baseline is seven ready AR
  invoices and three AP exception fixtures.
- Remediation and verification: after action-time confirmation, the separate
  human controls restored AR and AP. Authenticated read-only WebMCP calls then
  returned exactly seven ready AR invoices and three AP exception fixtures
  (`INV-10479`, `INV-10463`, and `INV-10417`); both browser logs were empty.
- Exact next action: preserve this state until the final demo. If any further
  stateful rehearsal occurs, restore both applications again afterward.

### Current verification evidence

- Fresh production tool inventories: seven AR and twelve AP browser tools.
- Live normalized `INV-10522` package passed AP validation against PO-8912.
- Live human path downloaded a 3,994-byte one-page PDF, rendered and visually
  verified all invoice fields, uploaded the same file to AP, and passed human
  preflight. PO detail, status timeline/authority, and exact ACH remittance were
  visible through human controls.
- Unauthenticated roots redirect to login; protected workspace APIs and MCP
  return `401`. Login responses are private/no-store and include CSP, frame,
  MIME, referrer, and permissions protections.
- A fresh clone of commit `5eda779` installed with the frozen lockfile and
  passed 124 tests / 515 expectations, both type-checks, both lints, and both
  production builds. `bun audit` reported no vulnerabilities.
- No migration or environment-variable change was required. SQL suites were
  reviewed but not re-executed in this fresh pass because the repository has no
  local Supabase runtime or administrative database credential.

### F-012 — Rejected replacement source was unreachable from AR

- Severity: Medium.
- Status: fixed locally; production deployment and final stateful replay pending.
- Evidence/root cause: AP correctly exposed `replace_rejected_invoice` for the
  seeded `INV-10479` rejection, but AR's package service filtered exclusively
  to `ready`. The human queue also disabled selection for rejected invoices and
  offered only supporting documents, of which that invoice has none. Neither
  an agent nor a human could obtain the authoritative rejected PDF needed for
  the replacement preview.
- Remediation: the existing tenant-scoped package service now permits only
  `ready` and `rejected` invoice states. Tool descriptions explicitly require
  AP replacement authority before transferring a rejected package, and the AR
  follow-up card exposes the same authenticated, checksum-validating PDF route
  as **Download correction source**. Ready-only queue selection is unchanged;
  AP's transaction remains the authoritative replacement guard.
- Tests: focused service and production-contract suites pass (59 tests, 381
  expectations), including a rejected-package test that asserts the exact
  `ready`/`rejected` query bound. Both type-checks and both lints pass.
- Exact next action: run the full build/regression suite, deploy, verify the
  human and WebMCP paths live, then resume the confirmed stateful rehearsal.
