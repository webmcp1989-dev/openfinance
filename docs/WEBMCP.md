# WebMCP site tools

OpenFinance uses the imperative `document.modelContext.registerTool` API on authenticated top-level pages because the challenge workflow needs structured, stateful operations backed by same-origin services rather than form submission. Declarative form tools and iframe exposure are not part of this focused workflow.

Each registration is bound to an `AbortSignal` whose lifetime matches the authenticated page component, following the current WebMCP draft lifecycle. Navigating away or signing out aborts the registrations so capabilities from the previous authenticated document cannot remain available. The optional legacy `unregisterTool` cleanup is retained as a compatibility fallback for browser implementations predating signal-scoped registration and runs again after pending registrations settle, closing the late-registration race during navigation.

Every tool calls the site's existing same-origin backend. The browser agent receives no direct database credential and no permission beyond the current user session. Read tools that return invoice, document, purchase-order, validation, or receipt data set `untrustedContentHint`; every tool has a human-readable title and forwards the WebMCP abort signal to its request. OpenFinance removes PostgreSQL's base64 line wrapping before returning a package, so AP receives canonical RFC 4648 content that matches the declared WebMCP schema. Acme independently requires that exact canonical encoding, the bounded classic PDF profile (catalog, page, and a terminal `startxref` pointing to `xref`), decoded size, and SHA-256 at both the service and public database-wrapper boundaries.

All monetary values use integer minor units and are capped at JSON's exact-integer maximum (`9007199254740991`) in the WebMCP, HTTP, and database contracts.

Cross-site package reads and AP submission writes accept at most three invoices per call. With the 1.4 MB encoded-document bound, the complete JSON request or response remains below [Vercel Functions' 4.5 MB payload limit](https://vercel.com/docs/functions/limitations#request-body-size). Larger commercial batches should use multiple explicitly reviewed chunks or direct authenticated object-storage transfer rather than route large files through an application function.

## OpenFinance AR

| Tool | Kind | Purpose |
| --- | --- | --- |
| `list_ready_invoices` | read | Lists locally ready invoices for an explicitly named customer. |
| `get_submission_package` | read | Returns exact invoice fields and checksum-protected PDF payloads for selected ready invoices. |
| `list_portal_followups` | read | Finds blocked, rejected, overdue, status-stale, or partially paid invoices and suggests the next AR action. |
| `get_invoice_supporting_documents` | sensitive read | Returns verified evidence PDFs for one invoice after informed transfer approval. |
| `record_portal_result` | write, idempotent | Records portal references only after Acme actually returns them. |
| `record_portal_exception` | write, idempotent | Records precise AP validation exceptions without claiming submission. |
| `record_payment_remittance` | write, idempotent | Reconciles one verified full or partial AP payment allocation into AR. |

## Acme AP

| Tool | Kind | Purpose |
| --- | --- | --- |
| `get_invoice_requirements` | read | Returns live media, PO, balance, and uniqueness rules. |
| `list_open_purchase_orders` | read | Lists supplier-authorized open POs with line, receipt, service-entry, tolerance, evidence, and balance context. |
| `get_purchase_order_details` | read | Returns the complete live context for one supplier-authorized PO. |
| `list_supplier_invoices` | read | Lists portal invoices with optional status or PO filters. |
| `validate_invoice` | read, transfer-approved | Checks a human-approved package without reserving balance or writing data. |
| `submit_invoice_batch` | consequential write, idempotent | Atomically submits only a human-confirmed valid batch and returns receipts; identical retries return the original result. |
| `get_invoice_status` | read | Returns the receipt, revision, complete timeline, exceptions, inquiries, and completed payment reference. |
| `get_invoice_exception` | read | Returns structured exception ownership, guidance, evidence requirements, and permitted actions. |
| `respond_to_invoice_exception` | consequential write, idempotent | Sends a reviewed supplier response and up to three verified supporting PDFs. |
| `replace_rejected_invoice` | consequential write, idempotent | Transactionally supersedes an eligible rejected invoice with a corrected revision and adjusts PO balances. |
| `create_invoice_inquiry` | consequential write, idempotent | Opens a tracked payment, invoice, expedite, terms, or entry-assistance case. |
| `get_payment_remittance` | read | Returns scheduled or completed payment details and exact invoice allocations. |

## Contract principles

- Names are verb-based, precise, and non-overlapping.
- JSON Schemas disable additional properties and bound arrays and strings.
- Package-transfer and submission batches are capped at three invoices so their worst-case encoded payload fits the deployed request and response boundary.
- Monetary values use integer minor units and ISO currency codes.
- Read annotations are truthful; externally sourced business data is marked untrusted, and write tools explicitly describe side effects.
- Tool execution supports browser cancellation through the standard `AbortSignal`.
- Read outputs include live versions, balances, rules, checksums, and validation issues needed to verify decisions.
- Acme's stored requirements are database-constrained to the same PDF, size, open-PO, and balance contract advertised by its tools and enforced during submission.
- Write outputs include durable references and committed remaining balances.
- Frontend schemas aid tool selection; Zod, RLS, exact public-RPC validation, constraints, and transaction code remain authoritative. Both mutation RPCs derive request identity in PostgreSQL, so a caller-supplied digest cannot disguise changed idempotent content. AR also compares the stored event type and payload directly before replaying an existing delivery result.

## Required orchestration

1. Read locally ready invoices for the customer named in the human's intent, then read the selected packages inside OpenFinance. For the challenge prompt, call `list_ready_invoices` with `{ "customerName": "Acme Manufacturing" }`.
2. Present the destination and exact candidate invoice numbers, POs, and amounts, then obtain explicit approval to transfer those packages for read-only AP validation.
3. Read AP rules and preflight only the transfer-approved invoices.
4. Separate valid invoices from exceptions.
5. Present the exact valid invoice numbers, POs, amounts, total, and exclusions.
6. Obtain a separate explicit human confirmation immediately before submission.
7. Submit the valid batch exactly once with a unique idempotency key.
8. Verify returned references and visible AP state.
9. Record verified results and exceptions in OpenFinance.

Both applications refresh their visible state after writes and show recent tenant-scoped database audit events alongside the invoice queue, PO balances, and portal receipts. Acme's deterministic challenge simulator schedules every second committed supplier invoice for payment 10 seconds later. `get_invoice_status` remains a read-only discovery operation: it reads the same session-scoped backend status used by the human UI and never advances state as a side effect.

The human workspaces provide equivalent paths for every tool capability through the same backend contracts. AR adds actionable follow-ups, evidence download, and verified remittance reconciliation. AP adds line-level PO context and tolerances, status/PO portfolio filters, complete timelines and inquiry history, structured exception ownership and permitted actions, corrected revisions, tracked inquiries, and an exact scheduled/completed remittance-allocation lookup. This keeps both applications useful without an agent while preserving identical authorization and business rules.

AR also offers an authenticated PDF download for a human who wants to use a manual portal path. The downloaded bytes are revalidated against the stored PDF header, catalog/page markers, cross-reference pointer, size, canonical base64, and SHA-256 before release; Acme's existing human upload form independently validates the same document through its own backend.

AR's **Sync invoices now** ERP simulation is not a tenth browser WebMCP challenge tool. It is available in the human UI and through the independently authenticated AR remote MCP, alternates two imported invoices and no new invoices in a tenant-scoped idempotent backend transaction, and never connects to AP.

The AR remote MCP is documented separately in [MCP.md](MCP.md). It is the AR team's governed own-system interface. It does not alter the browser WebMCP tool inventory or the required human approvals before invoice data crosses into the customer portal.

Both applications also expose a two-step **Restore demo start** control so multiple reviewers can reproduce the canonical state. Reset remains human-only and is intentionally absent from the 19-tool browser WebMCP inventory. AR and AP authorize, execute, and audit their resets independently through their own same-origin backends; neither reset crosses origins or coordinates the other application.

The agent must never transfer an unapproved package, silently broaden either approved set, treat a preflight as a reservation, or report submission before receiving a committed portal reference.
