# WebMCP browser tool reference

## Scope and product boundary

The submitted product is **OpenFinance Supplier Portal — Acme AP**. Its authenticated workspace registers **12 browser WebMCP tools**: eight read-only tools and four tools that write only to Acme AP. No AP tool reads from or writes to the separate OpenFinance AR reference system.

The repository also contains an independently authenticated OpenFinance AR reference application with seven browser tools. AR exists only to make the external supplier side of the demo reproducible. It is not part of the Acme AP product or its 12-tool count.

| Inventory | Read-only | Writes its own system | Contest role |
| --- | ---: | ---: | --- |
| Acme AP | 8 | 4 | Submitted product |
| OpenFinance AR | 4 | 3 | Optional demo reference |

## How agents discover and call the tools

After a supplier signs in, [`AcmeSiteTools`](../apps/acme-ap/components/acme-site-tools.tsx) registers the 12 definitions with the authenticated page's `document.modelContext`. A compatible browser enumerates those definitions directly; there is no `show_all_tools` tool and the agent does not infer the inventory from visible page text.

Registration lasts only for the authenticated page lifetime. The component unregisters the tools when it unmounts or registration fails. A signed-out page exposes none of the business tools.

For ChatGPT evaluation, use the desktop app's built-in browser with **Site tools** enabled in Browser permissions. Chrome may expose the experimental `document.modelContext` page API through its WebMCP testing flag or an applicable origin trial; that page API and a Chrome agent side panel are separate capabilities.

Each call follows the same path:

```text
browser agent
  -> page-registered WebMCP tool
  -> same-origin /api/agent route using the current supplier cookie session
  -> domain schema validation
  -> application service
  -> supplier-scoped Supabase access / PostgreSQL transaction
  -> JSON result
  -> authoritative workspace refresh and visible agent notice when state changed
```

Tool metadata helps an agent select a capability; it is not an authorization boundary. Authentication, supplier scope, role checks, validation, idempotency, state transitions, document approval, and financial invariants are enforced by the backend and PostgreSQL.

## Shared contracts

All input objects reject undeclared properties. Identifiers use these formats:

- `invoiceNumber` and `purchaseOrderNumber`: 2–40 uppercase letters, digits, or hyphens, beginning with a letter or digit.
- `idempotencyKey`: 16–128 characters. Reusing a key with the identical request returns the original result; reusing it for different content is rejected.
- Monetary values: integer minor units, such as `1842000` for USD 18,420.00, within JavaScript's exact-integer range.
- Currency: three uppercase letters.
- Dates: ISO `YYYY-MM-DD`; timestamps: ISO date-time strings.

A complete invoice package contains:

| Field | Contract |
| --- | --- |
| `invoiceNumber` | Invoice identifier |
| `invoiceDate` | ISO date |
| `amountMinor` | Positive integer minor units |
| `currency` | Three-letter uppercase currency |
| `purchaseOrderNumber` | Acme PO identifier |
| `document.fileName` | Safe 1–120 character filename |
| `document.mediaType` | Exactly `application/pdf` |
| `document.contentBase64` | Canonical base64; at most 1.4 MB encoded and 1 MiB decoded |
| `document.sha256` | Lowercase 64-character SHA-256 digest of the decoded PDF |

Acme independently verifies canonical base64, decoded size, SHA-256, and the bounded classic-PDF structure before any document write. Client-side checks are only user experience aids.

## Inventory and implementation map

| Tool | Type | Same-origin API | Human interface equivalent |
| --- | --- | --- | --- |
| `get_invoice_requirements` | Read | `GET /api/agent/requirements` | Invoice requirements |
| `list_open_purchase_orders` | Read | `GET /api/agent/purchase-orders` | Purchase orders |
| `get_purchase_order_details` | Read | `POST /api/agent/purchase-orders` | Find a purchase order |
| `list_supplier_invoices` | Read | `GET /api/agent/supplier-invoices` | Invoice submissions and filters |
| `validate_invoice` | Read-only preflight | `POST /api/agent/validate` | Validate an invoice |
| `submit_invoice_batch` | Document write | `POST /api/agent/submissions` | Review and submit + approval dialog |
| `get_invoice_status` | Read | `POST /api/agent/status` | Track an invoice |
| `get_invoice_exception` | Read | `POST /api/agent/exceptions` | Exception queue and invoice detail |
| `respond_to_invoice_exception` | Document write | `POST /api/agent/exception-responses` | Respond to an exception + approval dialog |
| `replace_rejected_invoice` | Document write | `POST /api/agent/replacements` | Replace rejected invoice + approval dialog |
| `create_invoice_inquiry` | Non-document write | `POST /api/agent/inquiries` | Open an AP inquiry + buyer cases |
| `get_payment_remittance` | Read | `POST /api/agent/remittance` | Finish on cash |

The routes call the use cases in [`submission-service.ts`](../apps/acme-ap/lib/services/submission-service.ts). The same service layer supports the human workspace; the frontend is not an alternative authority path.

## Detailed AP tool reference

### `get_invoice_requirements`

**Why it exists.** Lets an agent learn Acme's current submission policy instead of assuming document, PO, balance, or uniqueness rules.

- **Input:** empty object.
- **Returns:** `acceptedMediaTypes`, `maxDocumentBytes`, `requireOpenPurchaseOrder`, `enforceRemainingBalance`, and `uniqueInvoiceNumberRequired`.
- **How it works:** reads the supplier-visible submission policy through `getRequirements`; it does not inspect an invoice or change state.
- **Visible result:** the Invoice requirements section shows the same policy and receives a temporary “Agent read this” marker.
- **Important failures:** unauthenticated session or an unavailable policy record.

### `list_open_purchase_orders`

**Why it exists.** Gives the agent the complete set of POs the signed-in supplier is allowed to use, including the operational facts required to avoid blind submission.

- **Input:** empty object.
- **Returns:** `{ purchaseOrders, count }`; only open POs are included.
- **PO content:** number, description, currency, authorized and remaining amounts, terms, receipt requirement and received amount, service-entry requirement and state, tolerances, required evidence, detailed lines, and version.
- **How it works:** reads supplier-scoped PO rows and lines under RLS, orders them by PO number, and filters out closed orders.
- **Visible result:** the Purchase orders section shows the same records and an “Agent read this” marker.
- **Important failures:** unauthenticated session or a backend query failure. Another supplier's POs are not returned.

### `get_purchase_order_details`

**Why it exists.** Retrieves the authoritative context for one PO without forcing the agent to search a full list or guess current balances and receiving state.

- **Input:** `{ purchaseOrderNumber }`.
- **Returns:** `{ found, purchaseOrder }`; an unavailable or out-of-scope PO produces `found: false` and `purchaseOrder: null` rather than disclosing it.
- **How it works:** performs a supplier-scoped lookup and returns the same complete PO shape used by the list tool.
- **Visible result:** Find a purchase order renders the detailed PO; the Purchase orders area receives the read marker.
- **Important failures:** malformed identifier, unauthenticated session, or query failure.

### `list_supplier_invoices`

**Why it exists.** Lets an agent discover the signed-in supplier's AP invoice history and effective statuses before checking individual records.

- **Input:** optional `status` and `purchaseOrderNumber` filters.
- **Allowed statuses:** `received`, `under_review`, `accepted`, `rejected`, `disputed`, `voided`, and `paid`.
- **Returns:** `{ invoices, count }`. Each receipt includes invoice and portal references, PO, amount, currency, status, creation time, expected settlement, paid time, and payment reference when applicable.
- **How it works:** reads the tenant-scoped status view, then applies the requested filters.
- **Visible result:** Invoice submissions displays the same records and provides equivalent status and PO filters.
- **Important failures:** invalid filters, unauthenticated session, or status-query failure.

### `validate_invoice`

**Why it exists.** Separates a read-only preflight from consequential submission so an agent can explain exactly why an invoice qualifies or is excluded.

- **Input:** one complete invoice package.
- **Returns:** `{ valid, invoiceNumber, purchaseOrder, issues }`.
- **Possible issue codes:** `purchase_order_not_found`, `purchase_order_closed`, `currency_mismatch`, `amount_exceeds_remaining_balance`, `duplicate_invoice`, `invalid_document`, `missing_receipt`, and `service_entry_not_accepted`.
- **How it works:** verifies the PDF and checksum, reads the live PO and duplicate state in parallel, and evaluates currency, remaining balance, receipt, and service-entry rules. It neither reserves PO balance nor creates an invoice.
- **Human boundary:** when the package came from another company, the human must approve transferring that exact package before the agent calls Acme. This upstream sharing decision is separate from Acme's later submission approval.
- **Visible result:** Validate an invoice shows a pass decision or the exact issues and can add only a valid package to the human review batch.
- **Important failures:** malformed package, unauthenticated session, or inability to perform the duplicate/PO read. Business-rule failures are returned as structured issues, not disguised as a successful submission.

### `submit_invoice_batch`

**Why it exists.** Commits only the invoices that passed validation while making the exact document write atomic, retry-safe, and human governed.

- **Input:** `idempotencyKey` and one to three unique complete invoice packages.
- **Returns:** `batchId`, `submittedAt`, and an item for each invoice containing `invoiceNumber`, stable `portalReference`, `portalStatus: received`, `purchaseOrderNumber`, new `remainingAmountMinor`, and `currency`.
- **How it works:** the tool first requests a short-lived approval for document metadata, opens the portal approval dialog, and waits. After approval it sends the same request with the opaque approval identifier. PostgreSQL binds and consumes that approval inside the atomic batch transaction, rechecks business state, reserves PO balances, creates invoice receipts and audit events, and returns stable references.
- **Mandatory approval:** yes. The signed-in human sees the destination, invoice numbers, dates, POs, amounts, filenames, hashes, count, and total. Denial or dismissal performs no submission.
- **Visible result:** the workspace refreshes, shows an `Agent ·` confirmation, displays a prominent count/total/reference summary, and highlights the new receipt rows.
- **Important failures:** missing, expired, denied, consumed, wrong-user, or request-mismatched approval; invalid or duplicate invoice; idempotency conflict; changed PO state; insufficient submitter role; or failed document validation. Nothing is partially committed.

### `get_invoice_status`

**Why it exists.** Provides one authoritative lifecycle view instead of making the agent reconstruct state from separate screens.

- **Input:** `{ invoiceNumber }`.
- **Returns:** `{ found, submission }`. The submission includes the current receipt, revision, full cross-revision timeline, structured exceptions, tracked inquiries, settlement timing, and completed payment reference where present.
- **How it works:** loads the current supplier-scoped invoice and then reads all of its revisions, timeline events, current-revision exceptions, and inquiries. A completed synthetic payment is included in the timeline.
- **Visible result:** Track an invoice renders the status, references, timeline, exceptions, authority guidance, and inquiries; the receipt section receives a read marker.
- **Important failures:** malformed invoice number, unauthenticated session, or detail-query failure. An unavailable invoice returns `found: false` rather than leaking another supplier's data.

### `get_invoice_exception`

**Why it exists.** Makes exception ownership and supplier authority explicit so an agent does not pretend it can fix buyer-owned receiving or procurement work.

- **Input:** `{ invoiceNumber }`.
- **Returns:** `invoiceNumber`, `portalReference`, and structured `exceptions`.
- **Exception content:** code, category, owner, status, message, resolution guidance, allowed actions, required evidence kind, `supplierCanResolve`, an explicit `authorityBoundary`, and timestamps.
- **How it works:** obtains the current invoice detail and derives the supplier authority statement from the stored owner.
- **Visible result:** the Exception queue and tracked-invoice detail show the same owner, guidance, evidence requirement, and permitted actions.
- **Important failures:** invoice not found or outside supplier scope, malformed input, or unauthenticated session.

### `respond_to_invoice_exception`

**Why it exists.** Allows a supplier to resolve only the exception work it actually owns and to attach exact evidence under a separate document-consent decision.

- **Input:** `idempotencyKey`, `invoiceNumber`, `exceptionCode`, a 1–1,000 character `message`, and zero to three supporting PDF attachments. Each attachment adds `documentKind`: `proof_of_delivery`, `service_acceptance`, `timesheet`, `tax_document`, `contract`, or `other`.
- **Returns:** invoice and exception identifiers, authoritative `exceptionStatus`, resulting `invoiceStatus`, response/resolution timestamps, attachment count, and resolution outcome.
- **How it works:** the portal obtains an exact document approval, then PostgreSQL locks the actionable exception, verifies ownership and permitted action, validates every PDF, enforces required evidence, records the response and audit trail, and resolves the exception when the requested evidence is present. The invoice becomes accepted only when no other actionable blocker remains.
- **Mandatory approval:** yes. The human sees the invoice, exception, message, attachment kinds, filenames, and hashes before anything is attached.
- **Visible result:** the workspace shows an `Agent ·` notice; the exception visibly changes to resolved/approved when appropriate rather than disappearing.
- **Important failures:** buyer-owned exception, missing required evidence, inactive or missing exception, stale/mismatched approval, submitter-role failure, invalid document, or idempotency conflict.

### `replace_rejected_invoice`

**Why it exists.** Corrects an eligible rejected invoice as a new audited revision without mutating history or leaving the old reference active.

- **Input:** `idempotencyKey` and one corrected complete invoice package.
- **Returns:** `invoiceNumber`, new `revision`, new `portalReference`, `portalStatus: received`, `supersededPortalReference`, PO, remaining balance, currency, and submission time.
- **How it works:** the portal obtains exact document approval. PostgreSQL locks the workflow, verifies that replacement is permitted, revalidates the PDF and PO, adjusts the relevant PO balance, creates the next revision, marks the prior revision non-current/voided, and records timeline and audit events atomically.
- **Mandatory approval:** yes. The human sees the corrected invoice, amount, PO, filename, and hash.
- **Visible result:** the corrected revision appears in the receipt/status UI with the superseded history preserved and an `Agent ·` confirmation.
- **Important failures:** replacement not permitted in the current state, missing invoice, changed/invalid PO, invalid document, stale or mismatched approval, submitter-role failure, or idempotency conflict.

### `create_invoice_inquiry`

**Why it exists.** Gives the supplier a truthful route for buyer-owned blockers and payment questions without claiming the underlying invoice exception was resolved.

- **Input:** `idempotencyKey`, `invoiceNumber`, `inquiryType`, `subject` up to 160 characters, and `message` up to 1,000 characters.
- **Inquiry types:** `payment_inquiry`, `invoice_inquiry`, `expedite_payment`, `payment_terms`, and `invoice_entry_assistance`.
- **Returns:** `invoiceNumber`, durable `caseReference` in `CASE-YYYYMMDD-XXXXXXXX` form, `inquiryType`, `status: open`, and `createdAt`.
- **How it works:** PostgreSQL serializes concurrent retries, verifies the current supplier invoice, writes the case, adds a timeline event, and records an audit event. An identical retry returns the original case instead of opening another.
- **Approval model:** this is a consequential write but not a document submission, so it does not use the special PDF approval token. The tool directs the agent to show the exact case type, subject, and message and obtain normal human confirmation. The equivalent human form has an explicit approval checkbox.
- **Visible result:** the exact case reference immediately appears in Open buyer cases and on the related exception card; the buyer-owned exception remains blocked.
- **Important failures:** invoice not found or outside supplier scope, insufficient role, invalid fields, or idempotency conflict.

### `get_payment_remittance`

**Why it exists.** Lets the supplier obtain the buyer's exact payment evidence instead of inferring payment from an invoice status or amount.

- **Input:** `{ invoiceNumber }`.
- **Returns:** invoice and portal references, `paymentStatus` (`not_scheduled`, `scheduled`, or `paid`), scheduled and paid timestamps, payment reference, amount, currency, method, and exact invoice allocations. Payment details and allocations remain null/empty until paid.
- **How it works:** reads the current supplier invoice and its settlement row. The read never triggers payment. In the synthetic challenge environment, every second newly committed invoice receives a deterministic settlement scheduled ten seconds after receipt.
- **Visible result:** Finish on cash and the invoice receipt show the same payment status, reference, method, amount, and timing; the receipt section receives a read marker.
- **Authority boundary:** this AP tool cannot write to AR. In the optional full-loop demo, the agent must separately propose the exact AR reconciliation and obtain approval there.
- **Important failures:** invoice not found or outside supplier scope, malformed input, unauthenticated session, or remittance-query failure.

## Document approval protocol

Only these three AP tools submit or attach documents and therefore invoke the portal-managed consent gate:

1. `submit_invoice_batch`
2. `respond_to_invoice_exception`
3. `replace_rejected_invoice`

For each call, the browser component requests a pending approval from `POST /api/agent/document-approvals`. The approval preview contains business fields plus filenames, media types, and hashes, but never stores PDF base64. The signed-in human approves or denies through `PATCH /api/agent/document-approvals`.

An approved identifier is valid for five minutes, single-use, and bound to the same user, supplier, action, idempotency key, and exact manifest. It is passed to the document route in `X-OpenFinance-Document-Approval`, verified and consumed transactionally with the write, and is deliberately absent from the WebMCP input schema so an agent cannot invent or replay consent.

`validate_invoice` is read-only and does not use this AP submission gate. `create_invoice_inquiry` writes no document and uses normal informed action confirmation rather than the document-specific token.

## Error and trust model

- `400`: malformed tool input or filters.
- `401`: no valid Acme application session.
- `403`: same-origin or supplier-role authorization failure.
- `404`: the authenticated supplier cannot access the requested invoice or exception.
- `409`: changed business state, missing authority/evidence, or idempotency conflict.
- `415`: JSON content type is required for body-bearing routes.
- `422`: a business operation was rejected without exposing database details.
- `428`: fresh approval is required for the exact document action.

POs, invoice records, exception messages, and tool results are business data and remain untrusted content for the agent. They cannot expand tool authority or override the user's instruction. All responses use private no-store caching, and write results are safe to retry only with their original idempotency key and identical content.

## Evaluation workflows

### AP-only evaluation workflow

1. Open Acme AP in a WebMCP-capable browser and sign in.
2. Enumerate the authenticated page tools and confirm the 12 definitions above.
3. Ask the agent to read requirements, open POs, current invoices, exception ownership, buyer cases, and remittance using only this portal's tools.
4. Compare the answer with the same records in the visible AP interface.

The AR reference application is not required for this evaluation.

### Optional full-loop reference

1. Read ready invoices from AR and preview destination, invoice numbers, POs, amounts, and documents.
2. Obtain informed approval before the exact packages leave AR.
3. Read AP requirements and PO context, then validate only the approved packages.
4. Explain qualified invoices and exclusions and request AP submission.
5. Let Acme's approval dialog obtain separate consent for the exact document batch.
6. Submit once, verify the returned references, and record only those verified results in AR.
7. Follow AP's stored exception owner: submit approved supplier evidence or open a tracked case for buyer-owned work without claiming resolution.
8. Read exact AP remittance and, after separate approval, reconcile that allocation in AR.

No tool crosses the application boundary. The browser agent carries only the data the human approved.

## Authoritative supporting references

- [WebMCP registrations and browser execution](../apps/acme-ap/components/acme-site-tools.tsx)
- [Input validation schemas](../apps/acme-ap/lib/domain/submissions.ts)
- [Document approval manifests](../apps/acme-ap/lib/domain/document-approvals.ts)
- [AP use cases and safe error mapping](../apps/acme-ap/lib/services/submission-service.ts)
- [HTTP request and response contracts](openapi.yaml)
- [Security and tenant isolation](SECURITY.md)
- [System boundaries and data flow](ARCHITECTURE.md)
- [Concise live agent overview](https://openfinance-ap.vercel.app/llms.txt)

The OpenAPI document is authoritative for exact HTTP shapes. This guide explains why each browser tool exists and how it maps to those contracts and visible product behavior.
