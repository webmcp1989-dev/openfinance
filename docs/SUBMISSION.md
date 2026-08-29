# Challenge submission package

This file contains judge-facing copy and the recording plan for the OpenFinance WebMCP Challenge submission. Keep passwords out of this repository; Devpost provides a private credentials field for authenticated applications.

## Project details

- **Title:** OpenFinance
- **Tagline:** Agent-mediated invoice delivery between independently authenticated AR and AP applications—without a point-to-point integration.
- **Primary live URL:** https://openfinance-ar.vercel.app
- **Independent AP portal:** https://openfinance-ap.vercel.app
- **Public repository:** https://github.com/webmcp1989-dev/openfinance
- **Demo prompt:** “Submit all Acme invoices that are ready for their AP portal.”

## Ready-to-paste description

### Why this is a strong fit for WebMCP

Supplier accounts-receivable teams routinely leave their own system, sign into customer-specific AP portals, re-enter invoice data, upload documents, reconcile purchase-order rules, and copy submission references back. OpenFinance demonstrates a WebMCP-native alternative: two independent web applications expose precise, discoverable capabilities to the browser agent while retaining their own authentication, authorization, data, and business rules.

There is no shared database, credential, private connector, or server-to-server workflow integration between OpenFinance AR and the Acme AP portal. The human-directed ChatGPT browser agent is the interoperability layer. It reads invoice packages from the seller’s current session, discovers the buyer portal’s requirements and purchase orders in its separate session, reconciles the records, and uses only each site’s WebMCP tools to complete the approved transaction.

### How it creates a better user experience

One natural-language request replaces repetitive navigation and re-keying while improving—not reducing—control. The agent identifies three locally ready invoices and recognizes that a fourth is already missing a purchase order. It first presents the Acme destination and exact candidate invoices, POs, and amounts; the human approves transferring only those packages for read-only validation. After Acme exposes the deliberate remaining-balance exception, the agent presents a second preview containing the exact valid batch, $25,670 total, and all exclusions. The human separately approves the consequential submission only after reviewing that concrete result.

Successful tool calls immediately update both visible applications. Acme shows committed portal references and reduced PO balances; OpenFinance shows delivery outcomes, the unresolved exception, and a tenant-scoped audit trail. Failures return actionable business explanations rather than generic automation errors.

### What people and agents can do together that was difficult before

The human supplies intent, business judgment, and approval. The agent discovers capabilities across two sites, gathers the right records, validates them against independent rules, explains exceptions, executes only the approved batch, and returns verifiable references to the source system. This makes a browser session a user-controlled interoperability layer between companies that have never built an integration or shared credentials.

The workflow remains understandable and usable by a human on either site. With the agent, it becomes a coordinated cross-application transaction whose preparation, exception handling, execution, and evidence are visible in one conversation.

### How WebMCP was implemented

Both Next.js applications register imperative WebMCP tools only in authenticated page context. OpenFinance exposes four narrow tools for listing ready invoices, packaging selected documents, recording portal results, and recording exceptions. Acme exposes five tools for reading requirements, finding purchase orders, validating invoice packages, atomically submitting a confirmed batch, and retrieving status.

Each tool calls only its own same-origin backend with the page’s current cookie session. Read operations use `readOnlyHint`; externally sourced business records use `untrustedContentHint`; every tool has a precise title, strict JSON Schema, cancellable execution, and structured recovery guidance. Backend Zod validation and independent PostgreSQL constraints enforce inputs. Supabase Row Level Security derives tenant or supplier scope from the authenticated user. Consequential writes use fingerprint-bound idempotency, and the AP batch transaction locks PO rows before validating and decrementing balances. The two apps run on separate Vercel origins backed by separate Supabase projects.

## Private judge credentials

Enter these in Devpost’s private credentials field after the final password reset:

- OpenFinance AR: `demo@openfinance.dev` / **final AR password**
- Acme AP: `supplier@acme.demo` / **final AP password**

Include both live URLs and state that the sessions are intentionally independent. Never add the passwords to this file, the README, source control, screenshots, or narration.

## Video plan — target 2:45

The final video must be public on YouTube, include clear audio, and remain under three minutes.

### 0:00–0:18 — Problem and outcome

Show the OpenFinance AR queue.

> Supplier AR teams lose time re-entering invoices into customer portals and copying the results back. OpenFinance lets independently authenticated AR and AP applications complete that workflow through WebMCP—without a custom integration or shared credentials.

### 0:18–0:32 — Independence proof

Briefly show both origins and signed-in identities.

> These are separate applications, sessions, authorization boundaries, and databases. The browser agent is the bridge, using only the tools each page deliberately exposes.

### 0:32–0:55 — Discovery and transfer approval

Enter the canonical prompt. Show tool discovery, the three ready packages, the excluded missing-PO invoice, and the informed Acme transfer preview. Confirm the exact three packages for read-only validation on camera.

> One invoice is already excluded because it has no PO. Before any PDF crosses sites, I approve these exact three packages and the Acme destination for read-only validation.

### 0:55–1:20 — Reconciliation

Show AP requirements, purchase orders, and the three validation results.

> The agent validates only the transfer-approved packages against live Acme data. Two pass; INV-10507 exceeds PO-8890’s ten-thousand-dollar remaining balance.

### 1:20–1:42 — Submission approval

Hold on the confirmation preview long enough to read both valid invoices, POs, amounts, the $25,670 total, destination, and exceptions. Confirm on camera.

> The agent prepares and explains; the human retains authority. The validation approval did not authorize submission. I separately approve only these two valid invoices now.

### 1:42–2:20 — Execution and writeback

Show the Acme submission, two portal references, updated PO balances, then the OpenFinance writeback.

> Acme commits the approved batch atomically and returns verifiable references. The agent records those references and the rejected invoice’s actionable exception back in OpenFinance.

### 2:20–2:45 — Visible proof and implication

Show both audit trails and final states side by side.

> Both applications now show the same completed business outcome through their own authoritative state and audit trail. This is the WebMCP-native future of OpenFinance: human-controlled interoperability across the B2B web.

## Final submission gate

- Run the complete flow from a freshly seeded state in ChatGPT’s in-app browser at least twice.
- Verify all nine tools are discoverable and that their titles, schemas, annotations, and results match `docs/WEBMCP.md`.
- Verify no invoice package crosses to Acme before the recorded transfer confirmation.
- Verify no write occurs before the separate recorded submission confirmation.
- Verify identical idempotent retries do not duplicate submissions or balance changes, and changed-payload key reuse fails.
- Verify both live UIs and audit trails show the same portal references recorded in OpenFinance.
- Reset both judge passwords and test them in clean independent sessions.
- Record a single clear take, confirm its YouTube visibility and duration, and test the public link while signed out.
- Recheck the live URLs, repository visibility, MIT license, description, credentials, and current Devpost rules immediately before submitting.
