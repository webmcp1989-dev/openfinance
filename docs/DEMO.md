# Contest demo runbook

## Story

An AR operator has several invoices ready in OpenFinance but Acme requires submission through its own independently authenticated supplier portal. There is no API integration between the companies. The human asks one agent to bridge both sites through WebMCP while retaining approval of the consequential submission.

## Scope discipline

The primary contest demonstration uses only the browser WebMCP capabilities registered by the two authenticated sites. Do not show the AR remote-MCP endpoint, OAuth consent flow, connector setup, or remote tool inventory in the main video or live run. Those are optional own-system capabilities and are not part of the 19 browser tools. If a reviewer asks, describe the remote MCP only as a separately documented extension that cannot access Acme and does not alter the WebMCP interoperability claim.

## Starting state

- OpenFinance shows a realistic 24-invoice AR portfolio. Exactly three Acme candidates are locally ready: `INV-10482`, `INV-10491`, and `INV-10507`.
- OpenFinance includes historical accepted, submitted, rejected, paid, and locally blocked work. `INV-10503` is visibly blocked because its PO is missing.
- Acme: `PO-8821` has $24,000 remaining.
- Acme: `PO-8844` has $7,250 remaining.
- Acme: `PO-8890` has $10,000 remaining, less than the $12,900 on `INV-10507`.
- Acme independently accepts `INV-10482` and `INV-10491`; `INV-10507` remains the deliberate buyer-side rejection.
- Acme starts with three historical exception invoices: `INV-10417` is supplier-owned and needs proof of delivery; `INV-10463` is owned by `buyer_receiving` because Acme has not posted the goods receipt; rejected `INV-10479` is supplier-owned and explicitly permits a corrected replacement revision.

Restore this state with the separate two-step human controls in each app or the reviewed administrative scripts in [setup](SETUP.md#restore-the-synthetic-demo-state). Resets are independently authorized and audited, and are not available to the browser agent.

## Live flow

1. Open both deployed sites in the ChatGPT in-app browser and sign into each independent session.
2. In the OpenFinance tab, ask: “Submit all Acme invoices that can be paid.”
3. The agent calls `list_ready_invoices` with `{ "customerName": "Acme Manufacturing" }`, then reads the three packages inside OpenFinance.
4. Before any PDF crosses origins, it shows the Acme destination and the exact three candidate invoices, POs, and amounts. The human explicitly confirms transfer for read-only validation.
5. In the Acme tab, the agent reads requirements and line/receipt/service-entry PO context, then validates only those approved packages in bounded groups.
6. It reports two valid invoices and the exact balance/receipt/service-entry blockers for `INV-10507` on `PO-8890`.
7. It shows `INV-10482`, `INV-10491`, their POs and amounts, the $25,670 total, and the excluded invoice. The human separately approves that exact consequential submission plan.
8. The agent calls `submit_invoice_batch` once for the exact two approved invoices. The transaction is atomic and its idempotency key is bound to that payload.
9. Acme immediately shows two new receipts and reduced PO balances. OpenFinance receives only the two returned portal references and the verified `INV-10507` exception through its own idempotent tools.
10. The human gives the second instruction: “Resolve exceptions, open cases for buyer-owned blockers, and reconcile approved payments back into our invoice system.” The agent inspects the seeded exception invoices.
11. For `INV-10417`, it obtains the exact AR proof-of-delivery PDF, previews it, obtains approval, and sends a supplier response through AP. Acme verifies the exact requested evidence, returns `exceptionStatus: resolved` and `invoiceStatus: accepted`, and its visible card moves from **Action required** to **Approved**. The agent then records that exact accepted result in AR with the same portal reference; the AR invoice becomes **Accepted** and a durable **Recently resolved** card retains the document name and timestamp.
12. For `INV-10463`, the exception output says `supplierCanResolve: false`. The agent states: **“This isn't mine to fix. Acme receiving owns this blocker; I can open a tracked AP case.”** After approval it opens an `invoice_inquiry`; Acme shows the returned `CASE-*` reference and keeps the invoice on hold. The agent then records that exact returned case in AR using `exceptionCode: buyer_case_open` and the documented structured message. Both portals show the case; neither application writes the other application's state.
13. After 10 seconds, the agent checks the new receipts. The deterministic canonical sequence makes `INV-10482` paid with `PAY-20260830-0DD9D23B`; reads do not advance payment state.
14. The workflow ends on cash, not submission: the agent calls `get_payment_remittance`, previews the exact AP reference and $18,420 allocation, and after approval calls `record_payment_remittance` in AR. The AR invoice visibly shows the payment reference, amount, ACH method, paid-at time, and zero remaining due.

A compact contest prompt covering the full story is: **“Submit all Acme invoices that can be paid, resolve supplier-owned exceptions, open cases for buyer-owned blockers, and reconcile approved payments back into OpenFinance.”**

The trust model should be said out loud: **19 browser tools across two apps and zero cross-writes.** Seven AR tools write only AR, twelve AP tools write only AP, and the human is the only authority that spans them.

## Pass criteria

- No invoice package is transferred to Acme before the informed transfer confirmation.
- No write occurs before the separate submission confirmation.
- `INV-10507` is never included in a submitted batch.
- The one two-invoice batch exactly matches the approved set and total; no call silently broadens it.
- Retrying the AP submit with the same key returns the original result and does not decrement balances twice.
- Reusing an idempotency key with a different payload fails.
- Both UIs visibly reflect the backend state after tool execution.
- Portal references returned by Acme exactly match those recorded in OpenFinance.
- Payment discovery is a read-only status check: the canonical pair makes `INV-10482` paid after 10 seconds with the stable reference `PAY-20260830-0DD9D23B`; no status read causes a mutation, and both tool and UI show the same result.
- Remittance is written to AR only after the exact AP allocation is shown and approved; duplicate, excessive, or mismatched allocations fail transactionally.
- Exception responses, invoice replacement, and buyer inquiries each require a separate exact human preview and approval.
- AP rejects supplier responses to buyer-owned exceptions at the backend. Missing delivery proof requires the correct structurally valid `proof_of_delivery` attachment; only after that exact evidence is committed does AP resolve the exception and accept the invoice when no other blocker remains. The missing receipt permits only a tracked buyer inquiry and stays disputed.
- The AP exception queue updates without a page reload after either WebMCP write: `INV-10417` becomes **Approved**, while `INV-10463` shows **Case open** with the exact durable case reference and buyer owner. After the explicit agent-mediated AR writebacks, AR visibly retains the resolved evidence and the same open buyer case.
- `INV-10479` is present in both systems, exposes only the supplier-owned `replace_invoice` correction, and produces one current revision 2 while resolving the original exception and preserving PO accounting.

For the all-human fallback, select any ready invoice in the OpenFinance queue and use the download button that appears beside the selection count. A human can download immediately or inspect the protected package first, then use Acme's invoice form to upload, validate, review, confirm, and submit it. Multiple selections expose one explicit download per invoice so the browser never relies on ambiguous bulk-download behavior. This path uses the same tenant-scoped backend rules as the agent flow.

Rejected follow-ups also expose **Download correction source**. The same rejected PDF is available through `get_submission_package`, but it may be transferred as a replacement only after Acme reports `replace_invoice` as an allowed supplier action and the human approves the exact revision preview.

## Judge-facing emphasis

- Usefulness: removes repetitive re-keying from a common AR-to-AP workflow.
- Originality: two independent websites become interoperable without a pre-existing integration.
- Execution: real auth, RLS, tenant scoping, PDF checksum validation, idempotency, atomic PO accounting, and audit events.
- Thoughtful WebMCP: narrow site-native tools expose capabilities rather than UI coordinates.
- Human-agent experience: the agent prepares and explains; the human controls the irreversible step and can inspect the visible result in both systems.
- Authority: 19 site tools expose rich capabilities but neither application can write the other's state; the agent explicitly knows when work belongs to the buyer.

## Demo line bank

Keep these lines available for the final demo script. Preserve their meaning when editing for timing.

1. “Integration is a per-partner project, so only the largest relationships get one. The exception is framed as working capital—caught in seconds, not four weeks later as a rejected invoice and a payment that never arrived.”
2. “OpenFinance demonstrates what becomes possible when independently operated B2B portals expose secure WebMCP capabilities. We implemented both sides to prove the complete workflow today.”
