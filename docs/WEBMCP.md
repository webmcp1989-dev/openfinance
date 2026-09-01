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
| `get_submission_package` | read | Returns exact invoice fields and checksum-protected PDF payloads for selected ready invoices or rejected invoices needing a supplier correction. A rejected package is transferable only after AP reports that replacement is an allowed supplier action. |
| `list_portal_followups` | read | Finds blocked, rejected, overdue, status-stale, or partially paid invoices and suggests the next AR action. |
| `get_invoice_supporting_documents` | sensitive read | Returns verified evidence PDFs for one invoice after informed transfer approval. |
| `record_portal_result` | write, idempotent | Records portal references only after Acme actually returns them. It also records AP's verified acceptance of the seeded missing-delivery-proof exception using the unchanged current reference, creating a retained AR resolution record. A corrected AP revision must include the exact current AR reference as `supersedesPortalReference`; stale or implicit overwrites fail closed. |
| `record_portal_exception` | write, idempotent | Records precise AP validation exceptions without claiming submission. After AP returns a buyer case, `buyer_case_open` plus the exact documented case message mirrors that verified result into AR without any cross-write. |
| `record_payment_remittance` | write, idempotent | Reconciles one verified full or partial AP payment allocation into AR. |

## Acme AP

| Tool | Kind | Purpose |
| --- | --- | --- |
| `get_invoice_requirements` | read | Returns live media, PO, balance, and uniqueness rules. |
| `list_open_purchase_orders` | read | Lists supplier-authorized open POs with line, receipt, service-entry, tolerance, evidence, and balance context. |
| `get_purchase_order_details` | read | Returns the complete live context for one supplier-authorized PO. |
| `list_supplier_invoices` | read | Lists portal invoices with optional status or PO filters. |
| `validate_invoice` | read, transfer-approved | Checks a human-approved package without reserving balance or writing data. |
| `submit_invoice_batch` | consent-gated document write, idempotent | Opens the portal's exact document-approval panel, then atomically submits only an approved valid batch and returns receipts; identical retries return the original result. |
| `get_invoice_status` | read | Returns the current receipt and revision, complete timeline across revisions, current exceptions and inquiries, and completed payment reference. |
| `get_invoice_exception` | read | Returns structured exception ownership, supplier authority, an explicit authority-boundary statement, guidance, evidence requirements, and permitted actions. |
| `respond_to_invoice_exception` | consent-gated document write, idempotent | Opens the portal's exact approval panel, then sends the approved response and up to three verified supporting PDFs. Exact requested evidence resolves that exception and approves a disputed invoice only when no other actionable blocker remains; the result reports both authoritative states. Buyer-owned blockers are rejected. |
| `replace_rejected_invoice` | consent-gated document write, idempotent | Opens the portal's exact corrected-document approval panel, then transactionally supersedes an eligible rejected invoice and adjusts PO balances. |
| `create_invoice_inquiry` | consequential write, idempotent | Opens a persistent tracked payment, invoice, expedite, terms, entry-assistance, or buyer-owned-blocker case and returns its `CASE-*` reference. It never resolves the buyer-owned exception or approves the invoice. |
| `get_payment_remittance` | read | Returns scheduled or completed payment details and exact invoice allocations so the approved workflow can finish with AR reconciliation. |

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
- AP's three document-writing tools (`submit_invoice_batch`, `respond_to_invoice_exception`, and `replace_rejected_invoice`) cannot reach their mutation RPC until the signed-in human approves a five-minute, one-time manifest. The manifest contains exact business fields, filenames, and SHA-256 values but never PDF base64. PostgreSQL derives the final manifest from the actual payload, locks the approval, compares tenant/user/action/idempotency/payload, commits the business mutation, and consumes consent in one transaction. The approval identifier is internal page state, not a WebMCP input or tool.
- Frontend schemas aid tool selection; Zod, RLS, exact public-RPC validation, constraints, and transaction code remain authoritative. Both mutation RPCs derive request identity in PostgreSQL, so a caller-supplied digest cannot disguise changed idempotent content. AR also compares the stored event type and payload directly before replaying an existing delivery result.

## Required orchestration

1. Read locally ready invoices for the customer named in the human's intent, then read the selected packages inside OpenFinance. For the challenge prompt, call `list_ready_invoices` with `{ "customerName": "Acme Manufacturing" }`.
2. Present the destination and exact candidate invoice numbers, POs, and amounts, then obtain explicit approval to transfer those packages for read-only AP validation.
3. Read AP rules and preflight only the transfer-approved invoices.
4. Separate valid invoices from exceptions.
5. Present the exact valid invoice numbers, POs, amounts, total, and exclusions.
6. Invoke the AP submission tool; its mandatory portal panel shows the exact destination, invoices, POs, amounts, total, filenames, and hashes. The human must approve there immediately before submission.
7. Submit the valid batch exactly once with a unique idempotency key.
8. Verify returned references and visible AP state.
9. Record verified results and exceptions in OpenFinance.
10. For open exceptions, follow the returned owner and `supplierCanResolve` boundary. Resolve supplier-owned evidence gaps after approval and verify the returned `exceptionStatus` and `invoiceStatus`, then record that exact accepted status and unchanged reference in AR. For buyer-owned work say “This isn't mine to fix,” name the buyer owner, and offer an approved tracked inquiry. Verify its returned case reference while leaving the blocker open, then record the exact case in AR with `exceptionCode: buyer_case_open` and `Case <reference> opened · owner <owner> · type <type> · status <status>`.
11. After AP marks an invoice paid, read its exact remittance, preview the allocation, and after approval record it in AR. Submission is not the end state; cash reconciliation is.

Both applications refresh their visible state after writes and show recent tenant-scoped database audit events alongside the invoice queue, PO balances, and portal receipts. A successful browser-tool write also emits app-local presentation metadata: the workspace renders an **Agent ·** confirmation while continuing to reload authoritative state from its same-origin backend. The metadata does not alter any tool schema or response and is never used for authorization or business state. AP retains the latest submitted count, total, returned references, and highlighted receipt rows; AR retains the latest verified payment reference, amount, method, paid-at time, and remaining balance in a prominent reconciliation result. Successful read tools place a subtle attention marker on the section they queried.

Acme also exposes a tenant-scoped exception queue: verified required evidence moves the supplier-owned card from **Action required** to **Approved**, while a buyer-owned blocker remains on hold and shows the durable open `CASE-*` reference. AR retains the exact evidence resolution, buyer case, and remittance details after their explicit agent-mediated writebacks. Acme's deterministic challenge simulator keeps the every-second payment rule while the canonical reset starts the sequence so `INV-10482` in the narrated pair receives the stable `PAY-20260830-0DD9D23B` signal after 10 seconds. `get_invoice_status` remains a read-only discovery operation: it reads the same session-scoped backend status used by the human UI and never advances state as a side effect.

The 19-tool inventory intentionally has **zero cross-writes**. The seven OpenFinance site tools can mutate only AR state, and the twelve Acme tools can mutate only AP state. Tool count increases capability without increasing implicit authority: the human remains the only actor who approves data crossing between the separately authenticated applications.

The human workspaces provide equivalent paths for every tool capability through the same backend contracts. AR adds actionable follow-ups, evidence download, and verified remittance reconciliation. AP adds line-level PO context and tolerances, status/PO portfolio filters, complete timelines and inquiry history, structured exception ownership and permitted actions, corrected revisions, tracked inquiries, and an exact scheduled/completed remittance-allocation lookup. This keeps both applications useful without an agent while preserving identical authorization and business rules.

AR also offers an authenticated PDF download for a human who wants to use a manual portal path. The downloaded bytes are revalidated against the stored PDF header, catalog/page markers, cross-reference pointer, size, canonical base64, and SHA-256 before release; Acme's existing human upload form independently validates the same document through its own backend.

AR's **Sync invoices now** ERP simulation is not a tenth browser WebMCP challenge tool. It is available in the human UI and through the independently authenticated AR remote MCP, alternates two imported invoices and no new invoices in a tenant-scoped idempotent backend transaction, and never connects to AP.

The AR remote MCP is documented separately in [MCP.md](MCP.md). It is the AR team's governed own-system interface. It does not alter the browser WebMCP tool inventory or the required human approvals before invoice data crosses into the customer portal.

Both applications also expose a two-step **Restore demo start** control so multiple reviewers can reproduce the canonical state. Reset remains human-only and is intentionally absent from the 19-tool browser WebMCP inventory. AR and AP authorize, execute, and audit their resets independently through their own same-origin backends; neither reset crosses origins or coordinates the other application.

The agent must never transfer an unapproved package, silently broaden either approved set, treat a preflight as a reservation, or report submission before receiving a committed portal reference.
