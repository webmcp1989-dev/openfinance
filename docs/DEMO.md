# Contest demo runbook

## Story

An AR operator has several invoices ready in OpenFinance but Acme requires submission through its own independently authenticated supplier portal. There is no API integration between the companies. The human asks one agent to bridge both sites through WebMCP while retaining approval of the consequential submission.

## Starting state

- OpenFinance: `INV-10482`, `INV-10491`, and `INV-10507` are locally ready.
- OpenFinance: `INV-10503` is already blocked because its PO is missing.
- Acme: `PO-8821` has $24,000 remaining.
- Acme: `PO-8844` has $7,250 remaining.
- Acme: `PO-8890` has $10,000 remaining, less than the $12,900 on `INV-10507`.
- Acme has no submitted invoices.

Restore this state with the separate two-step human controls in each app or the reviewed administrative scripts in [setup](SETUP.md#restore-the-synthetic-demo-state). Resets are independently authorized and audited, and are not available to the browser agent.

## Live flow

1. Open both deployed sites in the ChatGPT in-app browser and sign into each independent session.
2. In the OpenFinance tab, ask: “Submit all Acme invoices that are ready for their AP portal.”
3. The agent calls `list_ready_invoices` with `{ "customerName": "Acme Manufacturing" }`, then calls `get_submission_package` for the returned ready invoices inside OpenFinance.
4. Before any PDF crosses origins, it shows the Acme destination and the exact three candidate invoices, POs, and amounts. The human explicitly confirms transfer for read-only validation.
5. In the Acme tab, the agent reads requirements, retrieves line/receipt/service-entry PO context, and validates only those three approved packages.
6. It reports two valid invoices and the exact `PO-8890` balance exception for `INV-10507`.
7. It asks for a separate explicit confirmation to submit only `INV-10482` and `INV-10491`, showing each PO and amount, the $25,670 total, and all exclusions.
8. After submission confirmation, it calls `submit_invoice_batch` once with a unique idempotency key.
9. The Acme UI immediately shows two receipts and reduced PO balances. It transparently identifies the synthetic buyer payment signal scheduled for the second committed invoice.
10. The agent records the two portal references and the exception back in OpenFinance with two idempotent tools.
11. The OpenFinance UI shows the delivered and exception statuses.
12. After 10 seconds, the Acme UI refreshes once. The agent calls `get_invoice_status` for both receipts and explains that exactly one has become `paid`, including its `PAY-...` reference, while the other remains received.
13. The agent reads that invoice's exact payment allocation with `get_payment_remittance`, shows it to the human, and after approval records it in AR with `record_payment_remittance`. OpenFinance then shows zero remaining due for that invoice.

An optional deeper prompt is: “Resolve supplier-owned exceptions, open cases for buyer-owned blockers, and reconcile every completed payment.” The agent uses structured exception ownership and permitted actions, requests approval before sending comments/evidence, replaces an invoice only when AP permits it, and opens a tracked inquiry rather than pretending to resolve buyer-owned receiving or procurement work.

## Pass criteria

- No invoice package is transferred to Acme before the informed transfer confirmation.
- No write occurs before the separate submission confirmation.
- `INV-10507` is never included in the submitted batch.
- Retrying the AP submit with the same key returns the original result and does not decrement balances twice.
- Reusing an idempotency key with a different payload fails.
- Both UIs visibly reflect the backend state after tool execution.
- Portal references returned by Acme exactly match those recorded in OpenFinance.
- Payment discovery is a read-only status check: one of the pair becomes paid after 10 seconds, no status read causes a mutation, and the UI shows the same result.
- Remittance is written to AR only after the exact AP allocation is shown and approved; duplicate, excessive, or mismatched allocations fail transactionally.
- Exception responses, invoice replacement, and buyer inquiries each require a separate exact human preview and approval.

For the all-human fallback, select any ready invoice in the OpenFinance queue and use the download button that appears beside the selection count. A human can download immediately or inspect the protected package first, then use Acme's invoice form to upload, validate, review, confirm, and submit it. Multiple selections expose one explicit download per invoice so the browser never relies on ambiguous bulk-download behavior. This path uses the same tenant-scoped backend rules as the agent flow.

## Judge-facing emphasis

- Usefulness: removes repetitive re-keying from a common AR-to-AP workflow.
- Originality: two independent websites become interoperable without a pre-existing integration.
- Execution: real auth, RLS, tenant scoping, PDF checksum validation, idempotency, atomic PO accounting, and audit events.
- Thoughtful WebMCP: narrow site-native tools expose capabilities rather than UI coordinates.
- Human-agent experience: the agent prepares and explains; the human controls the irreversible step and can inspect the visible result in both systems.
