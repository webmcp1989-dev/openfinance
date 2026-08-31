# Verification record

This record captures the final technical verification performed against the
August 30, 2026 release candidate. The synthetic demo databases were restored
to the documented starting state after testing.

## Automated gates

- `bun test`: 121 tests passed with 502 expectations.
- `bun run typecheck`: both applications passed.
- `bun run lint`: both applications passed with zero warnings.
- `bun run build`: both production builds completed successfully.
- `bun audit`: no known dependency vulnerabilities.
- Both documented development-server commands reached Ready on ports 3000 and
  3001. Next.js agent-file generation is disabled, so they do not create
  duplicate nested instructions.
- The dependency audit found no vulnerabilities. No dependency or infrastructure
  change was required for the portfolio expansion.

The test suite covers strict request contracts, authentication ordering,
security headers, responsive authentication controls, PDF structure and
checksum validation, money bounds, database mutation boundaries, WebMCP tool
lifecycle and annotations, authenticated human downloads, payment-aware status
mapping, idempotency, and documentation coverage.

## Live database and security verification

- The hosted AR project contains exactly 24 canonical invoices, seven ready
  packages, and one checksum-verified proof-of-delivery fixture for
  `INV-10417`. Its reset suite passed 15 assertions, ERP sync passed 19 after
  independently catching and fixing the missing due-date default, invoice PDF
  coverage passed 16, and exception-to-cash/evidence passed 13.
- The hosted AP project contains nine supplier-visible POs and exactly three
  seeded exception submissions: supplier-owned `missing_delivery_proof`,
  buyer-owned `missing_goods_receipt`, and supplier-owned
  `tax_total_mismatch` with `replace_invoice`. Its reset suite passed 20
  assertions and exception-to-cash suite passed 26, including replacement
  authorization, rejection of buyer-owned supplier responses, and rejection
  of supplier responses without the required evidence.
- The current database baseline therefore supports six valid submissions from
  seven locally ready AR packages, plus three authority-aware exception
  stories. The buyer-owned path exposes “This isn't mine to fix” and only the
  tracked inquiry action; the supplier-owned paths require exact evidence or
  an explicitly authorized corrected revision.

- The OpenFinance RLS suite passed 13 assertions and its delivery transaction
  suite passed 17 assertions in the live AR project.
- The OpenFinance ERP sync suite passed 17 assertions in the live AR project,
  covering internal-table isolation, privilege boundaries, `2 -> 0 -> 2`
  alternation, idempotent replay, unique inserts, and auditing.
- The OpenFinance renderable-PDF suite passed 12 assertions in the live AR
  project. The exact repaired download also passed strict `pypdf`, Poppler
  `pdfinfo`, text extraction, SHA-256 comparison, and visual page rendering.
- The Acme RLS suite passed 15 assertions and its submission transaction suite
  passed 14 assertions in the independent live AP project.
- The Acme deterministic payment-settlement suite passed 15 assertions in the
  live AP project, covering direct-table denial, wrapper privileges, serialized
  pair selection, 10-second maturity, payment references, and auditing.
- The independent AR and AP human-reset suites each passed 14 rollback-only
  assertions in their live projects. They prove invoker/definer boundaries,
  anonymous denial, role denial, exact fixture restoration, deterministic
  simulator reset, and one visible reset audit event.
- Unauthenticated workspace reads returned `401`, forged-origin writes returned
  `403`, and unsupported write content types returned `415`.
- The deployed reset routes independently returned `403` for a foreign origin,
  `415` for a missing JSON media type, and `401` for a same-origin request
  without an authenticated session.
- Production responses included the documented CSP, frame denial, no-sniff,
  HSTS, and permissions-policy headers.
- The live AR audience-hook verification returned `true` for all six security
  invariants: function presence, Auth schema and function privileges, application-user
  denial, exact OAuth MCP audience, and preserved normal portal audience. The
  rollback-only pgTAP suite contains six assertions covering the same boundary.
- The expanded AR exception-to-cash suite passed 12 rollback-only assertions in
  the live project. It verifies RLS, table and function privileges, serialized
  remittance retries, PDF evidence structure, and that proof-of-delivery evidence
  is a distinct document rather than a relabeled invoice.
- The expanded AP exception-to-cash suite passed 16 rollback-only assertions in
  the independent live project. It verifies supplier isolation, mutation
  boundaries, serialized inquiry and exception-response retries, attachment PDF
  integrity, and named PostgREST RPC arguments.

## Remote MCP and OAuth verification

- Production RFC 9728 protected-resource metadata advertises only
  `https://openfinance-ar.vercel.app/mcp`, the Supabase authorization issuer,
  header Bearer tokens, and the `email` identity scope. The authorization-server
  metadata exposes authorization code, refresh token, dynamic registration, and
  PKCE; unauthenticated MCP requests return `401` with the protected-resource
  metadata URL in `WWW-Authenticate`.
- A real dynamically registered public client completed authorization code +
  PKCE through the deployed OpenFinance consent screen. The issued ES256 JWT had
  the exact MCP audience, expected Supabase issuer, OAuth `client_id`,
  `authenticated` role, user subject, one-hour lifetime, and refresh token.
- Streamable HTTP initialization negotiated MCP `2025-06-18`. The earlier full
  OAuth lifecycle rehearsal covered the original eight tools; the current
  protocol inventory test returns exactly 11 schema-bearing AR tools and no
  reset capability after the exception-to-cash expansion.
- Live calls covered workspace, customer, invoice, PDF package, and audit reads;
  all three PDFs had valid signatures, EOF markers, and matching SHA-256 hashes.
  ERP sync imported two invoices, and an identical retry returned the same result.
- The independent AP rehearsal returned two receipts and one PO-balance exception.
  `record_portal_result` and `record_portal_exception` wrote those exact outcomes
  through remote MCP; identical retries were stable, AR UI updated immediately,
  audit events were labeled `oauth_mcp` with the exact client ID, and an OAuth
  reset attempt returned `403`.
- `/connections` displayed and revoked the test grant; its refresh token then
  returned HTTP `400`. The temporary DCR client, token file, package JSON, and PDF
  files were deleted after verification. No test credential remains in Git or Temp.

## In-app browser WebMCP verification

The final post-portfolio rehearsal completed the expanded authority-to-cash
workflow against both production applications on August 30, 2026:

- Independent human resets established 24 AR invoices with seven ready and the
  AP baseline of nine POs plus three historical exception submissions.
- The human-approved `INV-10482` ($18,420 / `PO-8821`) and `INV-10491`
  ($7,250 / `PO-8844`) PDFs transferred from AR, passed live AP validation, and
  committed atomically. AP returned stable references and AR recorded both.
- The exact checksum-verified `INV-10417-proof-of-delivery.pdf` resolved the
  supplier-owned evidence action to `responded` without changing the
  buyer-owned exception.
- `INV-10463` retained `buyer_receiving` ownership, displayed “This isn't mine
  to fix,” and created tracked case `CASE-20260830-B64B4F7B` rather than
  claiming supplier resolution.
- A temporary buyer-authorized replacement condition exercised
  `replace_rejected_invoice`; `INV-10482` became revision 2, superseded the
  original AP receipt atomically, and preserved the $5,580 PO balance. The
  first run exposed that AR had no explicit replacement-reference transition.
  Migration `202608300010_record_portal_replacement_results.sql` fixed that gap
  with an exact `supersedesPortalReference` concurrency token. A fresh deployed
  run then reconciled AP revision 2 into AR, and both human workspaces displayed
  the same new reference while implicit and stale replacements remained denied.
- AP completed the deterministic second-invoice ACH for `INV-10491` with
  reference `PAY-20260830-3BF11174`; AR recorded the exact $7,250 allocation and
  reached zero remaining due.
- Before cleanup, the human UIs visibly showed six AP audit events and three AR
  audit events covering submission, exception response, inquiry, replacement,
  portal result, and remittance. Final independent resets restored seven ready
  AR invoices, three open AP exception fixtures with no inquiries, and exactly
  one reset audit event in each application.

The canonical workflow was completed three times from a freshly reset state in
ChatGPT's in-app browser using only the tools exposed by the two live sites.

- Authenticated OpenFinance exposed exactly seven tools; authenticated Acme
  exposed exactly twelve. Login pages exposed none.
- OpenFinance returned three locally ready Acme invoices while the invoice with
  a missing purchase order remained locally excluded.
- All three transferred PDF packages had canonical base64, a valid `%PDF-`
  signature, and SHA-256 checksums that matched their declared values.
- Acme validation was read-only: before submission there were no receipts,
  audit events, balance changes, or purchase-order version changes.
- `INV-10482` and `INV-10491` validated successfully. `INV-10507` was excluded
  because its $12,900 amount exceeded `PO-8890`'s $10,000 remaining balance.
- The confirmed $25,670 batch created exactly two receipts, decremented only the
  corresponding PO balances, and returned two portal references.
- OpenFinance recorded the same references and the actionable AP exception, and
  both applications immediately displayed matching state and audit trails.
- Identical retries returned the original results without duplicate writes or
  balance changes. Reusing any idempotency key with a changed payload failed.
- The final run also verified the buyer payment signal: `INV-10491` became
  `paid` with a stable `PAY-*` reference after 10 seconds while `INV-10482`
  remained `received`; the two subsequent status-tool reads left the AP audit
  count unchanged at two events.
- A separate post-expansion production run invoked all 19 current browser tools.
  It read detailed PO lines, receipt and service-entry context; found the local
  missing-PO follow-up; transferred a distinct checksum-verified proof of
  delivery; submitted only the two valid invoices; and excluded `INV-10507`
  with balance, receipt, and service-entry exceptions.
- The AP payment signal for `INV-10491` was read as an exact ACH allocation and
  reconciled into AR. Identical remittance retries replayed one result and a
  changed retry failed closed.
- A synthetic buyer-owned exception on `INV-10482` was discovered through
  WebMCP, answered with the approved proof-of-delivery PDF, then resolved by an
  atomic corrected revision. Inquiry, exception-response, and replacement
  retries replayed exactly, while changed-payload reuse was rejected. The
  current revision remained visible and PO balance was not double-consumed.
- The same run verified every human action is present in the live workspaces.
  Both human reset controls then restored the earlier three-ready baseline;
  the portfolio migration below intentionally superseded that state.

After the portfolio deployment, both independent reset transactions succeeded.
The public judge state is now 24 AR invoices with seven ready and no `ERP-*`
imports, plus nine AP purchase orders and exactly three historical exception
fixtures (`INV-10417` evidence, `INV-10463` buyer-owned, and `INV-10479`
replacement-authorized). Each application
retains its own audit and authorization boundary.
Both synthetic judge passwords were then rotated to unique strong values and
verified through fresh, independent live sign-ins. The credentials remain
private and are not stored in this repository.

The seeded replacement branch was then independently exercised end to end.
`get_invoice_exception` returned `replace_invoice` for rejected `INV-10479`;
the AP write created revision 2 with a new `ACME-*` reference and voided the
superseded revision. An identical retry returned the original result and a
changed-payload retry failed closed. AR initially rejected the verified result
because its replacement guard allowed only a locally submitted state; migration
`202608300015_accept_rejected_replacement_results.sql` corrected that narrow
state mismatch while retaining the exact prior-reference concurrency token.
The live AR write-back then succeeded, replayed idempotently, rejected changed
key reuse, and the human workspace displayed the same revision-2 AP reference.

A final independent judge-style rehearsal then exercised all 19 deployed
browser tools from the restored portfolio. All seven ready AR packages were
transferred for preflight; six invoices totaling $49,585 passed, while
`INV-10507` was excluded for insufficient PO balance, missing receipt, and a
pending service entry. Two confirmed three-invoice batches committed and AR
recorded the six exact references plus the verified exception. The three
historical branches then produced a checksum-verified evidence response for
`INV-10417`, a buyer-receiving case for `INV-10463`, and revision 2 for
`INV-10479`, whose exact new reference reconciled back to AR. AP subsequently
reported three deterministic ACH payments; AR recorded all three exact
allocations and each invoice reached zero remaining due. Identical batch,
response, inquiry, replacement, result, and remittance retries replayed their
original results. Changed replacement and remittance retries failed closed,
and a supplier response to the buyer-owned receipt blocker was rejected with
the documented authority-boundary message. Both live UIs showed matching
references, payment state, controls, and audit events. Separate human resets
then restored seven ready AR invoices, three AP fixtures with no inquiries,
the open `replace_invoice` action on `INV-10479`, no rehearsal references, and
exactly one reset audit event per application.

The public remote MCP boundary was also smoke-tested after deployment: both
OAuth metadata documents returned `200`, and an unauthenticated `tools/list`
request returned `401` with the canonical RFC 9728 protected-resource metadata
challenge. No OAuth client, token, or credential was created for this smoke test.

## Human workspace coverage

- Both applications expose every WebMCP capability through accessible human UI
  controls backed by the same authenticated routes and authoritative services.
- Both deployed missing-profile login states provide a generic local-session
  account-switch recovery action without weakening the mandatory tenant or
  supplier membership check.
- The deployed AR package-review path returned the selected invoice's filename
  and checksum verification. The deployed AP PO and status lookups returned the
  live authorized balance and the correct no-receipt state without mutation.
- AR adds a human-only ERP sync control; the backend and database tests prove
  its tenant-scoped alternating behavior without creating an AR-to-AP backend connection.
- Both deployed workspaces expose a two-step human-only reset. Visual review
  confirmed the exact deletion warning, cancel path, responsive layout,
  successful state refresh, and reset audit event. The authenticated WebMCP
  inventories exclude reset; the current reviewed inventory is seven AR and
  twelve AP browser tools.
- AR provides a tenant-scoped, no-store invoice PDF download whose route and
  service tests verify exact bytes, safe headers, authorization ordering,
  structure, size, and checksum validation.
- AP provides requirements, PO and receipt lookup, exact PDF preflight, a
  three-invoice review batch, and an explicit final submission confirmation.
- AP also provides human-readable PO line/tolerance/evidence details,
  status/PO invoice portfolio filters, complete exception/inquiry context, and
  the exact remittance allocation returned by the same scoped backend used by
  `get_payment_remittance`.
- AP schedules every second committed invoice for a synthetic buyer payment
  signal after 10 seconds. The human UI performs one scheduled refresh and the
  existing read-only status tool returns the same backend-derived state.
- The repaired human workflow was exercised twice independently against the
  live deployments with four distinct ERP invoices. All four standards-compliant
  PDFs passed the AP upload preflight; both confirmed two-invoice batches
  committed atomically; invoices 2 and 4 alone matured to `paid` after 10
  seconds with stable `PAY-*` references; invoices 1 and 3 remained `received`.
- Each paid/received pair matched through both the visible AP workspace and
  authenticated `get_invoice_status` WebMCP calls. The read-only status calls
  did not add audit events: each run produced exactly one batch event and one
  synthetic-payment-scheduled event.

## Demo video artifact

The existing local renderer produced
`artifacts/demo-video/openfinance-demo.webm` from committed screenshots of the
deployed applications and eight Windows-generated narration tracks. Native
browser playback and seeking verified frames at 0:55, 1:45, and 2:35 and played
through the exact 167.145-second end without a media error. The file is 1600×900,
54.16 MB, and contains VP9 video plus Opus audio. Its SHA-256 digest is
`3A405343C70A3F62B756B5A4B1F66B2F8CBB44ED7FFA00931111822CE26A725F`.

The source renderer, narration manifest, and deployed-app screenshots are
tracked under `scripts/demo-video`; generated WAV and WebM files remain ignored
so private review artifacts are not added to the public repository.
The same renderer produces the tracked 1600×900 judge-facing thumbnail at
`scripts/demo-video/assets/youtube-thumbnail.png`; tests verify its dimensions,
bounded size, and public-safe YouTube copy.

The repeatable-reset capability did not modify the renderer, screenshots,
narration, thumbnail, generated WebM artifact, or create another video.

The later optimized upload candidate is
`artifacts/openfinance-contest-optimized.mp4`. A container-level media check on
August 31 verified a 147.4-second duration, 1280x720 dimensions, and separate
video and audio tracks. The file is 19,810,624 bytes and its SHA-256 digest is
`7FF79D2130B9083CB26FD9530D69CCFA95AA4AB660BB8D1A6D112284DF7FE6D9`.
It remains a local entrant-controlled artifact and has not been published by
an AI agent.

## Submission-only tasks

All local, database, deployment, OAuth/MCP, cross-application rehearsal, and
security gates are complete. The August 31 readiness check found that both
applications still require one final independent restore to the canonical
judge baseline described below. The entrant must also enter the two private judge
passwords in Devpost, publish the existing reviewed narrated demo video using
[YOUTUBE.md](YOUTUBE.md), accept Devpost's entrant declarations, and submit
before September 3, 2026 at 1:00 p.m. PDT.
