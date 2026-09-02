# WebMCP browser tools

## Contest scope

The submitted Acme AP product registers **12 authenticated browser tools**. Every AP tool calls only Acme's same-origin backend using the current supplier session; the browser receives no database credential.

This repository also includes an independent OpenFinance AR reference system with **7 browser tools** for the external side of the demonstration. AR is not part of Acme AP and its tools are not included in the AP contest count. Each page registers its own imperative `document.modelContext` tools for only its authenticated lifetime.

For ChatGPT evaluation, use the desktop app's built-in browser with **Site tools** enabled in Browser permissions. Chrome can expose the experimental `document.modelContext` API through its WebMCP testing flag or an applicable origin trial; that page API and a Chrome agent side panel are separate capabilities. The deployed AP origin also publishes a concise agent-readable overview at [`/llms.txt`](https://openfinance-ap.vercel.app/llms.txt).

## Acme AP — 12 tools

| Tool | Purpose |
| --- | --- |
| `get_invoice_requirements` | Read live media, PO, balance, and uniqueness rules. |
| `list_open_purchase_orders` | List supplier-authorized POs with lines, receipts, service entries, tolerances, evidence rules, and balances. |
| `get_purchase_order_details` | Read complete live context for one supplier-authorized PO. |
| `list_supplier_invoices` | List portal invoices with optional status or PO filters. |
| `validate_invoice` | Validate a transfer-approved package without reserving balance or writing data. |
| `submit_invoice_batch` | After portal approval, atomically and idempotently submit the approved batch and return receipts. |
| `get_invoice_status` | Read current revision, timeline, exceptions, inquiries, and payment state. |
| `get_invoice_exception` | Read ownership, supplier authority, guidance, required evidence, and allowed actions. |
| `respond_to_invoice_exception` | After portal approval, submit the approved response and verified evidence. Buyer-owned blockers are rejected. |
| `replace_rejected_invoice` | After portal approval, transactionally supersede an eligible rejected invoice. |
| `create_invoice_inquiry` | Open an idempotent tracked buyer case without resolving the underlying blocker. |
| `get_payment_remittance` | Read scheduled or completed payment details and exact allocations. |

## Independent OpenFinance AR reference — 7 tools

| Tool | Purpose |
| --- | --- |
| `list_ready_invoices` | List ready invoices for a customer named in the user's instruction. |
| `get_submission_package` | Return exact invoice fields and verified PDF packages for selected ready invoices or authorized corrections. |
| `list_portal_followups` | Find blocked, rejected, overdue, stale, or partially paid invoices. |
| `get_invoice_supporting_documents` | Return verified evidence PDFs for one invoice. |
| `record_portal_result` | Idempotently record exact AP references and statuses already returned by Acme. |
| `record_portal_exception` | Idempotently record exact validation exceptions or verified buyer-case outcomes. |
| `record_payment_remittance` | Idempotently reconcile an approved AP payment allocation into AR. |

## Enforced contracts

- Tool purposes do not overlap; schemas reject additional properties and bound all arrays and strings.
- Monetary values use integer minor units within JSON's exact-integer range.
- Business-data reads are marked untrusted and all calls support cancellation.
- Package reads and submissions are limited to three invoices and 1.4 MB encoded documents.
- AR verifies canonical base64, PDF structure, size, and SHA-256 before releasing a document; AP independently verifies the same properties before writing.
- Authentication, role and tenant scope, validation, idempotency, state transitions, and financial invariants are enforced by backend services and PostgreSQL, never by tool metadata or frontend state.
- `submit_invoice_batch`, `respond_to_invoice_exception`, and `replace_rejected_invoice` require a five-minute, one-time AP approval bound to the exact action, user, tenant, idempotency key, business fields, filenames, and hashes. PDF bytes are not stored in the approval record.
- Successful writes refresh authoritative UI state and display an **Agent ·** result notice. Presentation events never authorize or persist business state.
- Reset is human-only and is not part of the browser tool inventory.

## Required workflow

1. Read ready invoices from AR and preview the destination, invoice numbers, POs, and amounts.
2. Obtain informed approval before package data leaves AR.
3. Read AP requirements and PO context; validate only the approved packages.
4. Explain qualified invoices and exclusions, then invoke AP submission.
5. Let Acme's approval panel obtain separate consent for the exact document write.
6. Submit once with an idempotency key, verify returned references, and record only those verified results in AR.
7. Follow AP's stored exception owner: resolve supplier-owned evidence after approval; open a tracked case for buyer-owned work without claiming resolution.
8. Read exact AP remittance and, after approval, reconcile it in AR.

Acme AP's 12-tool inventory is the contest product boundary. The independent AR reference system has its own seven-tool inventory. No tool crosses those boundaries, and the counts are never combined as one product. HTTP payloads and errors are defined in [openapi.yaml](openapi.yaml); backend boundaries are described in [SECURITY.md](SECURITY.md).
