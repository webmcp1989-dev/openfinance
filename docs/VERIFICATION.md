# Verification record

This record captures the final technical verification performed against the
August 30, 2026 release candidate. The synthetic demo databases were restored
to the documented starting state after testing.

## Automated gates

- `bun test`: 97 tests passed with 379 expectations.
- `bun run typecheck`: both applications passed.
- `bun run lint`: both applications passed with zero warnings.
- `bun run build`: both production builds completed successfully.
- `bun audit`: no known dependency vulnerabilities.
- Both documented development-server commands reached Ready on ports 3000 and
  3001. Next.js agent-file generation is disabled, so they do not create
  duplicate nested instructions.
- A fresh clone of public GitHub commit `e82137c` completed frozen install,
  type-check, lint, all 67 tests, and both production builds using only the
  documented variables with safe build-time placeholders; its dependency
  audit found no vulnerabilities.
- GitHub Actions completed successfully for final capability commit `693100a`.
  Both Vercel production projects reported that commit as a successful
  deployment.
- Final recovery commit `e4bc4ae` is pushed to `main`; the deployed AP
  missing-profile page visibly exposes the tested local account-switch action.

The test suite covers strict request contracts, authentication ordering,
security headers, responsive authentication controls, PDF structure and
checksum validation, money bounds, database mutation boundaries, WebMCP tool
lifecycle and annotations, authenticated human downloads, payment-aware status
mapping, idempotency, and documentation coverage.

## Live database and security verification

- The OpenFinance RLS suite passed 13 assertions and its delivery transaction
  suite passed 11 assertions in the live AR project.
- The OpenFinance ERP sync suite passed 17 assertions in the live AR project,
  covering internal-table isolation, privilege boundaries, `2 -> 0 -> 2`
  alternation, idempotent replay, unique inserts, and auditing.
- The OpenFinance renderable-PDF suite passed 12 assertions in the live AR
  project. The exact repaired download also passed strict `pypdf`, Poppler
  `pdfinfo`, text extraction, SHA-256 comparison, and visual page rendering.
- The Acme RLS suite passed 15 assertions and its submission transaction suite
  passed 13 assertions in the independent live AP project.
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
- Streamable HTTP initialization negotiated MCP `2025-06-18`. `tools/list`
  returned exactly eight schema-bearing AR tools and no reset capability.
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

The canonical workflow was completed three times from a freshly reset state in
ChatGPT's in-app browser using only the tools exposed by the two live sites.

- Authenticated OpenFinance exposed exactly four tools; authenticated Acme
  exposed exactly five. Login pages exposed none.
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

After the final capability deployment, both independent two-step human reset
controls succeeded. The public judge state is now three ready AR invoices, one
local missing-PO exception, full AP purchase-order balances, no AP receipts,
and one visible `demo_state_reset` audit event in each application.
Both synthetic judge passwords were then rotated to unique strong values and
verified through fresh, independent live sign-ins. The credentials remain
private and are not stored in this repository.

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
  its tenant-scoped alternating behavior without changing the four-tool AR
  WebMCP surface.
- Both deployed workspaces expose a two-step human-only reset. Visual review
  confirmed the exact deletion warning, cancel path, responsive layout,
  successful state refresh, and reset audit event. The authenticated WebMCP
  inventories remained exactly four AR tools and five AP tools, with no reset
  tool.
- AR provides a tenant-scoped, no-store invoice PDF download whose route and
  service tests verify exact bytes, safe headers, authorization ordering,
  structure, size, and checksum validation.
- AP provides requirements, PO and receipt lookup, exact PDF preflight, a
  three-invoice review batch, and an explicit final submission confirmation.
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

## Submission-only tasks

All local, database, deployment, OAuth/MCP, cross-application rehearsal,
reset, and security gates are complete, and both applications are restored to
the judge baseline. The entrant must still enter the two private judge
passwords in Devpost, publish the existing reviewed narrated demo video using
[YOUTUBE.md](YOUTUBE.md), accept Devpost's entrant declarations, and submit
before September 3, 2026 at 1:00 p.m. PDT.
