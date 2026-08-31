# Challenge submission package

This file contains judge-facing copy and the recording plan for the OpenFinance WebMCP Challenge submission. Keep passwords out of this repository; Devpost provides a private credentials field for authenticated applications.

## Project details

- **Title:** OpenFinance
- **Tagline:** Agent-mediated invoice delivery between independently authenticated AR and AP applications—without a point-to-point integration.
- **Primary live URL:** https://openfinance-ar.vercel.app
- **Independent AP portal:** https://openfinance-ap.vercel.app
- **Public repository:** https://github.com/webmcp1989-dev/openfinance
- **Demo prompt:** “Submit all Acme invoices that are ready for their AP portal.”

## Submission scope boundary

Keep the title, description, screenshots, video, live run, and 19-tool inventory focused on browser WebMCP across the independently authenticated AR and AP applications. Do not include the optional AR remote MCP, OAuth connector setup, or its tool inventory in the primary contest narrative. That separate own-system interface may be mentioned only as an additional technical extension if a reviewer asks; it cannot access Acme and is not the interoperability layer demonstrated by the submission.

## Ready-to-paste description

### Why this is a strong fit for WebMCP

Supplier accounts-receivable teams routinely leave their own system, sign into customer-specific AP portals, re-enter invoice data, upload documents, reconcile purchase-order rules, and copy submission references back. OpenFinance demonstrates a WebMCP-native alternative: two independent web applications expose precise, discoverable capabilities to the browser agent while retaining their own authentication, authorization, data, and business rules.

There is no shared database, credential, private connector, or server-to-server workflow integration between OpenFinance AR and the Acme AP portal. The human-directed ChatGPT browser agent is the interoperability layer. It reads invoice packages from the seller’s current session, discovers the buyer portal’s requirements and purchase orders in its separate session, reconciles the records, and uses only each site’s WebMCP tools to complete the approved transaction.

### How it creates a better user experience

One natural-language request replaces repetitive navigation and re-keying while improving—not reducing—control. A realistic 24-invoice portfolio contains seven locally ready invoices. The agent first presents the Acme destination and exact candidate invoices, POs, and amounts; the human approves transferring only those packages for read-only validation. Acme independently finds six valid invoices totaling $49,585 and exposes the deliberate `PO-8890` balance/service-entry blocker. The agent presents the exact valid invoices, two bounded submission batches, and all exclusions. The human separately approves the consequential submission only after reviewing that concrete result.

Successful tool calls immediately update both visible applications. Acme shows committed portal references and reduced PO balances; OpenFinance shows delivery outcomes, the unresolved exception, and a tenant-scoped audit trail. Three seeded exception branches make authority visible: supplier AR can attach exact delivery proof; a missing receipt belongs to buyer receiving, so the agent says “This isn't mine to fix” and opens a tracked case; and a supplier-owned tax mismatch permits one approved corrected revision that explicitly supersedes the rejected invoice. The AP backend enforces those distinct permissions. Failures return actionable business explanations rather than generic automation errors.

### What people and agents can do together that was difficult before

The human supplies intent, business judgment, and approval. The agent discovers capabilities across two sites, gathers the right records, validates them against independent rules, explains exception ownership, executes only approved batches, opens cases instead of overreaching, and returns verifiable references. After AP signals payment, it reads the exact remittance and, after a final approval, reconciles it into AR. The workflow ends on cash rather than paperwork. This makes a browser session a user-controlled interoperability layer between companies that have never built an integration or shared credentials.

The workflow remains understandable and usable by a human on either site. With the agent, it becomes a coordinated cross-application transaction whose preparation, exception handling, execution, and evidence are visible in one conversation.

### How WebMCP was implemented

Both Next.js applications register imperative WebMCP tools only in authenticated page context. OpenFinance exposes seven focused tools for ready-invoice discovery, package and supporting-document reads, portal follow-ups, and governed portal-result, exception, and remittance writeback. Acme exposes twelve focused tools for requirements, PO and invoice context, validation, confirmed batch submission, status/portfolio reads, exception evidence, corrected revisions, inquiries, and payment remittance. That is 19 tools with zero cross-writes: AR tools mutate only AR, AP tools only AP, and the human is the only authority spanning them. Reset remains human-only.

Each tool calls only its own same-origin backend with the page’s current cookie session. Read operations use `readOnlyHint`; externally sourced business records use `untrustedContentHint`; every tool has a precise title, strict JSON Schema, cancellable execution, and structured recovery guidance. Backend Zod validation and independent PostgreSQL constraints enforce inputs. Supabase Row Level Security derives tenant or supplier scope from the authenticated user. Consequential writes use fingerprint-bound idempotency, and the AP batch transaction locks PO rows before validating and decrementing balances. The two apps run on separate Vercel origins backed by separate Supabase projects.

## Private judge credentials

Enter these in Devpost’s private credentials field after the final password reset:

- OpenFinance AR: `demo@openfinance.dev` / **final AR password**
- Acme AP: `supplier@acme.demo` / **final AP password**

Include both live URLs and state that the sessions are intentionally independent. Never add the passwords to this file, the README, source control, screenshots, or narration.

Also tell reviewers that each workspace has a separate two-step **Restore demo start** control. They should restore AP and AR independently before a fresh run; the controls affect only synthetic data, remain outside WebMCP, and leave a visible reset audit event.

## Video plan — 2:27 optimized candidate

The final video must be public on YouTube, include clear audio, and remain under three minutes.

Use the reviewed title, description, tags, visibility settings, and publication
checks in [`docs/YOUTUBE.md`](YOUTUBE.md). The generated 16:9 upload thumbnail
is `scripts/demo-video/assets/youtube-thumbnail.png`.

A reproducible source renderer is available in `scripts/demo-video`. The latest
optimized upload candidate is `artifacts/openfinance-contest-optimized.mp4`:
1280×720, 147.4 seconds, 19,810,624 bytes, with separate video and audio tracks.
Generated review files remain untracked; publish only the entrant-reviewed
candidate selected for submission.

### Problem and product

Establish the repetitive supplier-AR burden across buyer portals, then show the
authenticated OpenFinance AR workspace and the first human instruction:
“Submit all Acme invoices that can be paid.” Make clear that the two companies
have no point-to-point integration or shared credentials.

### Validation, control, and submission

Show the agent reading both authenticated applications, checking Acme's live PO
and evidence rules, and excluding the invoice that fails buyer-side checks.
Hold on the exact invoices, destination, total, and exclusion before showing the
human's separate submission approval. Acme then commits the valid $25,670 batch
atomically and an identical retry returns the original result.

### Exception ownership

Show the second human instruction: “Resolve supplier-owned exceptions, open
cases for buyer-owned blockers, and reconcile approved payments back into
OpenFinance.” Demonstrate all three authority branches:

- verified delivery proof crosses companies only after human approval;
- a corrected supplier-owned revision supersedes the rejected reference only
  after human review; and
- the buyer-owned missing receipt produces “This isn't mine to fix” and a
  tracked buyer case rather than a false resolution.

### Cash and authority conclusion

End on exact payment remittance recorded back in AR with remaining due zero.
Show both audit trails, then state the product and authority claim: 19 tools, two
independently authenticated companies, and zero cross-writes. Each portal writes
only its own ledger; the agent carries only information the human approves.

## Final submission gate

- Run the complete flow from a freshly seeded state in ChatGPT’s in-app browser at least twice.
- Verify all 19 browser WebMCP tools (7 AR and 12 AP) are discoverable and that their titles, schemas, annotations, and results match `docs/WEBMCP.md`.
- Verify no invoice package crosses to Acme before the recorded transfer confirmation.
- Verify no write occurs before the separate recorded submission confirmation.
- Verify identical idempotent retries do not duplicate submissions or balance changes, and changed-payload key reuse fails.
- Verify both live UIs and audit trails show the same portal references recorded in OpenFinance.
- Reset both judge passwords and test them in clean independent sessions.
- Record a single clear take, confirm its YouTube visibility and duration, and test the public link while signed out.
- Recheck the live URLs, repository visibility, MIT license, description, credentials, and current Devpost rules immediately before submitting.
