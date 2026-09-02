# Judge guide — Acme AP

## What to evaluate

[Acme AP](https://openfinance-ap.vercel.app) is the complete contest entry. Its **12 authenticated browser WebMCP tools** cover buyer requirements, purchase orders, validation, governed document writes, submission status, exception ownership, buyer cases, corrected revisions, and payment remittance.

Evaluate Acme AP on its own by default. The separate OpenFinance AR application is not required to understand, run, or judge the submitted product.

## Why WebMCP fits

Supplier teams repeatedly re-key invoices into buyer portals, interpret different PO and evidence rules, resolve exceptions, and retrieve remittance. A traditional API connection is a separate integration project for every buyer.

WebMCP lets Acme expose precise capabilities inside its existing authenticated portal. The agent can discover the portal's live rules and permitted actions; Acme's backend still enforces supplier authorization, financial invariants, and state transitions. The human separately approves every consequential document write.

## Recommended AP-only evaluation

1. In the ChatGPT desktop app, enable **Site tools** under Browser permissions.
2. Open only [Acme AP](https://openfinance-ap.vercel.app) in the built-in browser and sign in using the private Devpost credentials.
3. Confirm that the authenticated page registers exactly 12 tools.
4. Ask: **“Using only this supplier portal's tools, review its invoice requirements, open purchase orders, current invoices, exceptions, buyer cases, and payment remittance. Explain what the supplier can act on and what Acme owns. Do not make changes.”**
5. Verify that the agent uses AP tools to read live portal state and distinguishes supplier-owned work from Acme-owned receiving work.
6. Compare the agent's answer with the visible purchase orders, invoice queue, exception ownership, buyer cases, receipts, and remittance in the same AP interface.

A Chrome WebMCP flag can expose the page API for lower-level testing, but a Chrome side panel alone is not the ChatGPT Site tools environment.

## What AP proves

- Twelve distinct authenticated capabilities cover a real invoice lifecycle rather than wrapping one generic endpoint.
- Every browser capability has a corresponding human interface path backed by the same services.
- Tool calls use the signed-in supplier session and can read or write only Acme AP state.
- AP validation uses current PO lines, receipts, service-entry state, balances, tolerances, and evidence rules.
- Document submission, exception evidence, and corrected replacement require an exact, single-use portal approval before the write.
- Submission is bounded, atomic, idempotent, concurrency-safe, and auditable.
- Buyer-owned blockers remain buyer-owned; the supplier can open a tracked case without falsely resolving the exception.
- Read and write results refresh visible state without a manual page reload.
- Reset is human-only and is not a WebMCP tool.

## Optional full-loop reference

Only use this section if you want to reproduce the external supplier-system loop shown in the demo video. [OpenFinance AR](https://openfinance-ar.vercel.app) is an independent synthetic reference system, not part of Acme AP or its tool count. It has its own deployment, authentication, database, migrations, credentials, and seven browser tools.

There is no shared database, credential, session, server-to-server API, queue, webhook, or hidden synchronization path. The browser agent is the only bridge, and each application writes only its own ledger.

### Starting state

- AR contains 24 synthetic invoices and three ready Acme candidates: `INV-10482`, `INV-10491`, and `INV-10507`.
- Acme accepts `INV-10482` for $18,420 against `PO-8821` and `INV-10491` for $7,250 against `PO-8844`.
- `INV-10507` for $12,900 is blocked because `PO-8890` has only $10,000 remaining and its service entry is pending.
- AP includes `INV-10417`, a supplier-owned missing-delivery-proof exception; `INV-10463`, an Acme-receiving missing-receipt blocker; and rejected `INV-10479`, which permits a corrected revision.
- The separate human-only reset controls documented in [SETUP.md](SETUP.md#restore-the-synthetic-demo-state) restore this state. Reset is not an agent tool.

### Optional workflow

1. Open and sign in to AR separately, while keeping Acme AP open and authenticated.
2. Ask: **“Submit all Acme invoices that can be paid.”**
3. The agent reads the three external candidates and shows invoice numbers, POs, amounts, and the Acme destination. No PDF leaves AR before informed transfer approval.
4. The agent reads Acme's requirements and PO context, excludes `INV-10507`, and previews the two qualifying invoices and exact $25,670 total.
5. Acme opens its mandatory approval panel. No invoice document is committed before the separate document-write approval bound to that exact payload.
6. Acme submits the batch atomically, returns portal references, and refreshes visible AP state. The reference system separately records only those returned results.
7. Ask: **“Resolve supplier-owned exceptions, open cases for buyer-owned blockers, and reconcile approved payments back into OpenFinance.”**
8. For `INV-10417`, the agent finds verified proof of delivery, obtains transfer and AP write approvals, and submits the evidence. AP visibly resolves and accepts the invoice.
9. For `INV-10463`, the agent states that Acme receiving owns the blocker and opens a tracked AP case rather than claiming resolution.
10. Acme's deterministic test payment marks `INV-10482` paid after ten seconds. The agent reads `PAY-20260830-0DD9D23B` and its $18,420 allocation.
11. After exact human review, the reference system records that remittance and shows the payment reference, amount, method, paid-at time, and zero remaining due.

Technical details are in [WEBMCP.md](WEBMCP.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and [openapi.yaml](openapi.yaml). Agents can read the deployed AP guide at [`/llms.txt`](https://openfinance-ap.vercel.app/llms.txt).
