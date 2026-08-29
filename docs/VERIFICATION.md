# Verification record

This record captures the final technical verification performed against the
August 29, 2026 release candidate. The synthetic demo databases were restored
to the documented starting state after testing.

## Automated gates

- `bun test`: 67 tests passed with 271 expectations.
- `bun run typecheck`: both applications passed.
- `bun run lint`: both applications passed with zero warnings.
- `bun run build`: both production builds completed successfully.
- `bun audit`: no known dependency vulnerabilities.
- A fresh clone of public GitHub commit `dd12be5` completed frozen install,
  type-check, lint, all 67 tests, and both production builds using only the
  documented variables with safe build-time placeholders.
- GitHub Actions CI run 35 completed successfully. Both Vercel production
  projects reported commit `dd12be5` as Ready.

The test suite covers strict request contracts, authentication ordering,
security headers, responsive authentication controls, PDF structure and
checksum validation, money bounds, database mutation boundaries, WebMCP tool
lifecycle and annotations, idempotency, and documentation coverage.

## Live database and security verification

- The OpenFinance RLS suite passed 13 assertions and its delivery transaction
  suite passed 11 assertions in the live AR project.
- The OpenFinance ERP sync suite passed 17 assertions in the live AR project,
  covering internal-table isolation, privilege boundaries, `2 -> 0 -> 2`
  alternation, idempotent replay, unique inserts, and auditing.
- The Acme RLS suite passed 15 assertions and its submission transaction suite
  passed 13 assertions in the independent live AP project.
- Unauthenticated workspace reads returned `401`, forged-origin writes returned
  `403`, and unsupported write content types returned `415`.
- Production responses included the documented CSP, frame denial, no-sniff,
  HSTS, and permissions-policy headers.

## In-app browser WebMCP verification

The canonical workflow was completed twice from a freshly reset state in
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

After the second run, both scoped administrative reset scripts succeeded. The
public judge state is now three ready AR invoices, one local missing-PO
exception, full AP purchase-order balances, and empty receipt and audit trails.
Both synthetic judge passwords were then rotated to unique strong values and
verified through fresh, independent live sign-ins. The credentials remain
private and are not stored in this repository.

## Human workspace coverage

- Both applications expose every WebMCP capability through accessible human UI
  controls backed by the same authenticated routes and authoritative services.
- The deployed AR package-review path returned the selected invoice's filename
  and checksum verification. The deployed AP PO and status lookups returned the
  live authorized balance and the correct no-receipt state without mutation.
- AR adds a human-only ERP sync control; the backend and database tests prove
  its tenant-scoped alternating behavior without changing the four-tool AR
  WebMCP surface.
- AP provides requirements, PO and receipt lookup, exact PDF preflight, a
  three-invoice review batch, and an explicit final submission confirmation.

## Demo video artifact

The local renderer produced
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

## Submission-only tasks

Technical delivery is complete. The entrant must still enter the two verified
private judge passwords in Devpost, publish the reviewed narrated demo video
using [YOUTUBE.md](YOUTUBE.md), accept Devpost's entrant declarations, and
submit before September 3, 2026 at 1:00 p.m. PDT.
