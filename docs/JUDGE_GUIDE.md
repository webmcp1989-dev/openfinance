# OpenFinance judge guide

## What to evaluate

The primary contest application is the independently authenticated [Acme AP supplier portal](https://openfinance-ap.vercel.app). It exposes twelve browser WebMCP tools for buyer requirements, purchase-order context, validation, governed document writes, submission status, exception ownership, buyer cases, corrected revisions, and payment remittance.

The [OpenFinance AR system](https://openfinance-ar.vercel.app) is an independent synthetic supplier system used to reproduce the external records and writebacks in the complete demonstration. It exposes seven browser WebMCP tools. The two applications have separate deployments, authentication, databases, migrations, and credentials.

The browser agent and informed human are the only runtime bridge: **19 browser tools, two companies, zero cross-writes**. Do not show the AR remote-MCP endpoint in the primary contest flow; it is an optional own-system extension and is not part of the 19-tool browser-WebMCP claim.

## Why WebMCP fits

Supplier teams repeatedly re-key invoices into buyer portals, interpret different PO and evidence rules, resolve exceptions, and retrieve remittance. A traditional API connection is a per-partner integration project. WebMCP lets each existing portal expose precise capabilities inside its authenticated page while retaining its own rules and customer relationship.

The agent discovers and reasons across those capabilities. The applications enforce authorization and financial invariants. The human reviews exact data before it crosses company boundaries and separately approves consequential document writes.

## Starting state

- OpenFinance AR contains 24 synthetic invoices and exactly three ready Acme candidates: `INV-10482`, `INV-10491`, and `INV-10507`.
- Acme accepts `INV-10482` for $18,420 against `PO-8821` and `INV-10491` for $7,250 against `PO-8844`.
- `INV-10507` for $12,900 is blocked because `PO-8890` has only $10,000 remaining and its service entry is pending.
- AP includes `INV-10417`, a supplier-owned missing-delivery-proof exception; `INV-10463`, a buyer-receiving missing-receipt blocker; and rejected `INV-10479`, which permits a corrected revision.
- The two human-only reset controls documented in [SETUP.md](SETUP.md#restore-the-synthetic-demo-state) restore this deterministic state. Reset is not an agent tool.

## Workflow

1. Sign into both live applications in the same WebMCP-capable browser.
2. Ask the agent: **“Submit all Acme invoices that can be paid.”**
3. The agent reads the three supplier candidates and shows their invoice numbers, POs, amounts, and Acme destination. No PDF leaves AR before informed transfer approval.
4. Acme exposes requirements and PO lines, receipts, service-entry state, balances, and evidence rules. The agent validates only the approved packages.
5. The agent explains why `INV-10507` is excluded and previews the two qualifying invoices and their exact $25,670 total.
6. Acme opens its own mandatory approval panel. No invoice document is committed before the separate document-write approval bound to that exact payload.
7. Acme submits the two-invoice batch atomically, returns portal references, refreshes visible state, and makes retries idempotent. AR records only the verified results through its own tools.
8. Ask the follow-up: **“Resolve supplier-owned exceptions, open cases for buyer-owned blockers, and reconcile approved payments back into OpenFinance.”**
9. For `INV-10417`, the agent finds verified proof of delivery, previews the external transfer, obtains approval, and responds. AP visibly resolves and accepts the invoice; AR visibly records the exact result.
10. For `INV-10463`, the agent states that buyer receiving owns the blocker and opens a tracked AP case rather than claiming resolution. Both systems visibly retain the exact case reference after their respective writes.
11. Acme's deterministic test payment marks `INV-10482` paid after ten seconds. The agent reads `PAY-20260830-0DD9D23B` and its $18,420 allocation.
12. After exact human review, AR records that remittance and visibly shows the payment reference, amount, method, paid-at time, and zero remaining due.

## Expected proof

- Both portals remain usable through normal human UI for every browser WebMCP capability.
- Read and write results update visible application state without a manual refresh.
- Every document transfer has an exact preview and informed approval.
- Buyer-owned work remains buyer-owned; the supplier agent opens a case instead of overstepping its authority.
- AP tools write only AP state and AR tools write only AR state.
- The story ends with reconciled cash, not merely uploaded paperwork.

Technical details are available in [WEBMCP.md](WEBMCP.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and [openapi.yaml](openapi.yaml).
