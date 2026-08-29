# WebMCP site tools

OpenFinance uses the imperative `document.modelContext.registerTool` API on authenticated top-level pages. ChatGPT's current built-in browser does not discover declarative form tools or iframe registrations, so neither is used.

Every tool calls the site's existing same-origin backend. The browser agent receives no direct database credential and no permission beyond the current user session. Read tools that return invoice, document, purchase-order, validation, or receipt data set `untrustedContentHint`; every tool has a human-readable title and forwards the WebMCP abort signal to its request. OpenFinance removes PostgreSQL's base64 line wrapping before returning a package, so AP receives canonical RFC 4648 content that matches the declared WebMCP schema. Acme independently requires that exact canonical encoding before checking the PDF signature, decoded size, and SHA-256.

## OpenFinance AR

| Tool | Kind | Purpose |
| --- | --- | --- |
| `list_ready_invoices` | read | Lists Acme invoices locally ready for external validation. |
| `get_submission_package` | read | Returns exact invoice fields and checksum-protected PDF payloads for selected ready invoices. |
| `record_portal_result` | write, idempotent | Records portal references only after Acme actually returns them. |
| `record_portal_exception` | write, idempotent | Records precise AP validation exceptions without claiming submission. |

## Acme AP

| Tool | Kind | Purpose |
| --- | --- | --- |
| `get_invoice_requirements` | read | Returns live media, PO, balance, and uniqueness rules. |
| `find_purchase_order` | read | Returns one supplier-authorized PO and live balance. |
| `validate_invoice` | read, transfer-approved | Checks a human-approved package without reserving balance or writing data. |
| `submit_invoice_batch` | consequential write, idempotent | Atomically submits only a human-confirmed valid batch and returns receipts; identical retries return the original result. |
| `get_invoice_status` | read | Returns current receipt and status for one supplier invoice. |

## Contract principles

- Names are verb-based, precise, and non-overlapping.
- JSON Schemas disable additional properties and bound arrays and strings.
- Monetary values use integer minor units and ISO currency codes.
- Read annotations are truthful; externally sourced business data is marked untrusted, and write tools explicitly describe side effects.
- Tool execution supports browser cancellation through the standard `AbortSignal`.
- Read outputs include live versions, balances, rules, checksums, and validation issues needed to verify decisions.
- Write outputs include durable references and committed remaining balances.
- Frontend schemas aid tool selection; Zod, RLS, constraints, and transaction code remain authoritative.

## Required orchestration

1. Read locally ready invoices and packages inside OpenFinance.
2. Present the destination and exact candidate invoice numbers, POs, and amounts, then obtain explicit approval to transfer those packages for read-only AP validation.
3. Read AP rules and preflight only the transfer-approved invoices.
4. Separate valid invoices from exceptions.
5. Present the exact valid invoice numbers, POs, amounts, total, and exclusions.
6. Obtain a separate explicit human confirmation immediately before submission.
7. Submit the valid batch exactly once with a unique idempotency key.
8. Verify returned references and visible AP state.
9. Record verified results and exceptions in OpenFinance.

Both applications refresh their visible state after writes and show recent tenant-scoped database audit events alongside the invoice queue, PO balances, and portal receipts.

The agent must never transfer an unapproved package, silently broaden either approved set, treat a preflight as a reservation, or report submission before receiving a committed portal reference.
