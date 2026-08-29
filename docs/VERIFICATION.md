# Verification record

This record captures the final technical verification performed against commit
`77e0cbe` on August 29, 2026. The synthetic demo databases were restored to the
documented starting state after testing.

## Automated gates

- `bun test`: 56 tests passed with 205 expectations.
- `bun run typecheck`: both applications passed.
- `bun run lint`: both applications passed with zero warnings.
- `bun run build`: both production builds completed successfully.
- `bun audit`: no known dependency vulnerabilities.
- Git diff checks were clean and local `main` matched `origin/main`.

The test suite covers strict request contracts, authentication ordering,
security headers, responsive authentication controls, PDF structure and
checksum validation, money bounds, database mutation boundaries, WebMCP tool
lifecycle and annotations, idempotency, and documentation coverage.

## Live database and security verification

- The OpenFinance RLS suite passed 13 assertions and its delivery transaction
  suite passed 11 assertions in the live AR project.
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

## Submission-only tasks

Technical delivery is complete. The entrant must still enter the two verified
private judge passwords in Devpost, record and publish the narrated demo video
described in [SUBMISSION.md](SUBMISSION.md), accept Devpost's entrant
declarations, and submit before September 3, 2026 at 1:00 p.m. PDT.
