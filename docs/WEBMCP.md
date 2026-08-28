# WebMCP site tools

OpenFinance uses the imperative `document.modelContext.registerTool` API on authenticated top-level pages. ChatGPT's current built-in browser does not discover declarative form tools or iframe registrations, so neither is used.

Every tool calls the site's existing same-origin backend. The browser agent receives no direct database credential and no permission beyond the current user session.

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
| `validate_invoice` | read | Checks a complete package without reserving balance or writing data. |
| `submit_invoice_batch` | consequential write, idempotent | Atomically submits only a human-confirmed valid batch and returns receipts. |
| `get_invoice_status` | read | Returns current receipt and status for one supplier invoice. |

## Contract principles

- Names are verb-based, precise, and non-overlapping.
- JSON Schemas disable additional properties and bound arrays and strings.
- Monetary values use integer minor units and ISO currency codes.
- Read annotations are truthful; write tools explicitly describe side effects.
- Read outputs include live versions, balances, rules, checksums, and validation issues needed to verify decisions.
- Write outputs include durable references and committed remaining balances.
- Frontend schemas aid tool selection; Zod, RLS, constraints, and transaction code remain authoritative.

## Required orchestration

1. Read locally ready invoices and packages.
2. Read AP rules and preflight each invoice.
3. Separate valid invoices from exceptions.
4. Present the exact valid invoice numbers, amounts, total, and exclusions.
5. Obtain explicit human confirmation.
6. Submit the valid batch exactly once with a unique idempotency key.
7. Verify returned references and visible AP state.
8. Record verified results and exceptions in OpenFinance.

The agent must never silently broaden the confirmed batch, treat a preflight as a reservation, or report submission before receiving a committed portal reference.
