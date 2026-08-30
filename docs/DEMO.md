# Contest demo runbook

## Story

An AR operator has several invoices ready in OpenFinance but Acme requires submission through its own independently authenticated supplier portal. There is no API integration between the companies. The human asks one agent to bridge both sites through WebMCP while retaining approval of the consequential submission.

## Starting state

- OpenFinance shows a realistic 24-invoice AR portfolio. Seven invoices are locally ready: `INV-10482`, `INV-10491`, `INV-10507`, `INV-10522`, `INV-10538`, `INV-10544`, and `INV-10561`.
- OpenFinance includes historical accepted, submitted, rejected, paid, and locally blocked work. `INV-10503` is visibly blocked because its PO is missing.
- Acme: `PO-8821` has $24,000 remaining.
- Acme: `PO-8844` has $7,250 remaining.
- Acme: `PO-8890` has $10,000 remaining, less than the $12,900 on `INV-10507`.
- Acme also has four fully received open POs matching the additional ready invoices, so six of the seven ready packages can pass independent AP validation.
- Acme starts with two historical disputed invoices: `INV-10417` is supplier-owned and needs proof of delivery; `INV-10463` is owned by `buyer_receiving` because Acme has not posted the goods receipt.

Restore this state with the separate two-step human controls in each app or the reviewed administrative scripts in [setup](SETUP.md#restore-the-synthetic-demo-state). Resets are independently authorized and audited, and are not available to the browser agent.

## Live flow

1. Open both deployed sites in the ChatGPT in-app browser and sign into each independent session.
2. In the OpenFinance tab, ask: “Submit all Acme invoices that are ready for their AP portal.”
3. The agent calls `list_ready_invoices` with `{ "customerName": "Acme Manufacturing" }`, then reads the seven packages in bounded groups of at most three inside OpenFinance.
4. Before any PDF crosses origins, it shows the Acme destination and the exact seven candidate invoices, POs, and amounts. The human explicitly confirms transfer for read-only validation.
5. In the Acme tab, the agent reads requirements and line/receipt/service-entry PO context, then validates only those approved packages in bounded groups.
6. It reports six valid invoices and the exact balance/service-entry blocker for `INV-10507` on `PO-8890`.
7. It shows the six valid invoice numbers, POs, amounts, the $49,585 total, the excluded invoice, and the two required AP batches. The human separately approves that exact consequential submission plan.
8. The agent calls `submit_invoice_batch` twice, with at most three invoices and a different idempotency key per atomic batch.
9. Acme immediately shows six new receipts and reduced PO balances. OpenFinance receives only the six returned portal references and the verified `INV-10507` exception through its own idempotent tools.
10. The agent inspects the two seeded disputed invoices. For `INV-10417`, it obtains the exact AR proof-of-delivery PDF, previews it, obtains approval, and sends a supplier response through AP.
11. For `INV-10463`, the exception output says `supplierCanResolve: false`. The agent states: **“This isn't mine to fix. Acme receiving owns this blocker; I can open a tracked AP case.”** After approval it opens an `invoice_inquiry`; it never fabricates a receipt or claims the blocker is resolved.
12. After 10 seconds, the agent checks the new receipts. The deterministic simulator makes every second newly committed invoice paid; reads do not advance payment state.
13. The workflow ends on cash, not submission: the agent calls `get_payment_remittance` for each paid invoice, previews the exact AP references and allocations, and after approval calls `record_payment_remittance` in AR. OpenFinance then shows the reconciled balances and remittance audit events.

A compact contest prompt covering the full story is: **“Submit all Acme invoices that can be paid, resolve supplier-owned exceptions, open cases for buyer-owned blockers, and reconcile approved payments back into OpenFinance.”**

The trust model should be said out loud: **19 browser tools across two apps and zero cross-writes.** Seven AR tools write only AR, twelve AP tools write only AP, and the human is the only authority that spans them.

## Pass criteria

- No invoice package is transferred to Acme before the informed transfer confirmation.
- No write occurs before the separate submission confirmation.
- `INV-10507` is never included in a submitted batch.
- The six valid invoices are split into bounded batches of at most three; no batch silently broadens the approved set.
- Retrying the AP submit with the same key returns the original result and does not decrement balances twice.
- Reusing an idempotency key with a different payload fails.
- Both UIs visibly reflect the backend state after tool execution.
- Portal references returned by Acme exactly match those recorded in OpenFinance.
- Payment discovery is a read-only status check: every second new committed invoice becomes paid after 10 seconds, no status read causes a mutation, and the UI shows the same result.
- Remittance is written to AR only after the exact AP allocation is shown and approved; duplicate, excessive, or mismatched allocations fail transactionally.
- Exception responses, invoice replacement, and buyer inquiries each require a separate exact human preview and approval.
- AP rejects supplier responses to buyer-owned exceptions at the backend. Missing delivery proof requires the correct `proof_of_delivery` attachment; the missing receipt permits only a tracked buyer inquiry.

For the all-human fallback, select any ready invoice in the OpenFinance queue and use the download button that appears beside the selection count. A human can download immediately or inspect the protected package first, then use Acme's invoice form to upload, validate, review, confirm, and submit it. Multiple selections expose one explicit download per invoice so the browser never relies on ambiguous bulk-download behavior. This path uses the same tenant-scoped backend rules as the agent flow.

## Judge-facing emphasis

- Usefulness: removes repetitive re-keying from a common AR-to-AP workflow.
- Originality: two independent websites become interoperable without a pre-existing integration.
- Execution: real auth, RLS, tenant scoping, PDF checksum validation, idempotency, atomic PO accounting, and audit events.
- Thoughtful WebMCP: narrow site-native tools expose capabilities rather than UI coordinates.
- Human-agent experience: the agent prepares and explains; the human controls the irreversible step and can inspect the visible result in both systems.
- Authority: 19 site tools expose rich capabilities but neither application can write the other's state; the agent explicitly knows when work belongs to the buyer.
