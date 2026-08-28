# WebMCP design

## Role in the architecture

WebMCP is the applications' only cross-application interoperability surface. Each application registers tools in its own active, authenticated document. The browser agent discovers those tools and coordinates them under the user's direction.

## Design principles

- One non-overlapping purpose per tool.
- Clear verb-based name, human-readable title, and concise positive description.
- Explicit JSON Schema with bounded input sizes and meaningful identifiers.
- Backend authorization and validation for every execution.
- Structured, compact output that lets the agent and human verify the result.
- Visible UI synchronization after mutations.
- Correct `readOnlyHint` and `untrustedContentHint` annotations.
- Idempotency for retryable consequential actions.
- Registration only while the authenticated page context can support the tool.

## Planned OpenFinance tools

| Tool | Mode | Purpose |
| --- | --- | --- |
| `list_ready_invoices` | Read | Return a bounded summary of invoices currently eligible for portal preparation. |
| `get_submission_package` | Read | Return the authorized fields and synthetic document required for one invoice. |
| `record_portal_result` | Write | Idempotently record an AP portal reference and received status. |
| `record_portal_exception` | Write | Record a structured portal validation exception for AR follow-up. |

## Planned Acme tools

| Tool | Mode | Purpose |
| --- | --- | --- |
| `get_invoice_requirements` | Read | Return Acme's current supplier invoice requirements. |
| `find_purchase_order` | Read | Return an authorized supplier-scoped PO summary and remaining balance. |
| `validate_invoice` | Read | Evaluate invoice fields against Acme's backend business rules without changing state. |
| `submit_invoice` | Write | Submit one validated invoice idempotently and return its AP reference. |
| `get_invoice_status` | Read | Return the current supplier-scoped status of a submitted invoice. |

Names and schemas remain provisional until the first contract tests validate natural-language selection and non-overlap.

## Testing standard

Each tool requires:

- schema validation tests;
- authenticated happy-path integration tests;
- anonymous and cross-tenant denial tests;
- domain-rule and error-contract tests;
- UI synchronization verification for writes;
- natural-language selection evaluations in the ChatGPT in-app browser;
- end-to-end workflow tests from a clean seed state.
