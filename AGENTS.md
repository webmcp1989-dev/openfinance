# Temporary Codex handoff

> Temporary cross-computer handoff. Remove this file after the second computer has cloned the repository and completed the recording task.

## Current task

Record the final Acme AP WebMCP Challenge demo in Chrome using the real **ChatGPT for Chrome** pinned side panel. The recording must show genuine ChatGPT prompts, responses, AP WebMCP tool activity, application approval screens, and resulting live application state. Do not reconstruct, imitate, or overlay a fake agent interface.

Contest application — the only submitted product:

- Acme AP supplier portal: <https://openfinance-ap.vercel.app>

Independent supplier reference system used only to provide external demo records:

- OpenFinance AR: <https://openfinance-ar.vercel.app>

Before recording, sign in to ChatGPT and both applications on the recording computer. Keep the ChatGPT side panel visible beside the active portal, with approximately two-thirds of the frame for the application and one-third for the agent.

## Exact demo instructions

Opening instruction:

> Submit all Acme invoices that can be paid.

Follow-up instruction:

> Resolve supplier-owned exceptions, open cases for buyer-owned blockers, and reconcile approved payments back into OpenFinance.

The canonical workflow is:

1. Restore the synthetic starting state in OpenFinance AR and Acme AP separately.
2. The agent discovers three Acme candidates in AR:
   - `INV-10482`, `$18,420`, `PO-8821`
   - `INV-10491`, `$7,250`, `PO-8844`
   - `INV-10507`, `$12,900`, `PO-8890`
3. The agent reads Acme's live requirements, PO lines, receipts, terms, and evidence rules.
4. The agent qualifies `INV-10482` and `INV-10491`. It excludes `INV-10507` because it exceeds the `$10,000` remaining PO balance, only `$6,000` has been received, and service entry is pending.
5. Show the exact human approval screen before document submission. After approval, submit the two qualified invoices atomically for `$25,670`. Show Acme's returned portal references and visible receipt summary.
6. Record those exact portal results back in OpenFinance AR through the AR tool and its approval flow.
7. For supplier-owned `INV-10417`, retrieve the verified `INV-10417-proof-of-delivery.pdf`, show the exact external-sharing preview, obtain human approval, submit it to Acme, and visibly show the exception change from action required to approved/resolved.
8. For buyer-owned `INV-10463`, state plainly: **“This isn't mine to fix.”** Open an Acme buyer case, show the returned case reference and `buyer_receiving` ownership, then record that same case in AR without claiming resolution.
9. Read Acme's exact remittance for `INV-10482`: `PAY-20260830-0DD9D23B`, `$18,420`, ACH. Show the AR approval preview, record it in AR, and visibly show remaining due `$0` and reconciled status.
10. End on Acme AP's visible outcomes: invoices submitted, supplier exception resolved, buyer case open, and remittance available. Separately show the AR reference system recording the verified AP results and payment.

## Recording requirements

- Final video must be public-ready, include narration/audio, and remain under three minutes.
- Show working product behavior in the first 10–15 seconds; skip login, setup, loading, and reset screens in the final edit.
- Show the agent actually using WebMCP tools. The agent interface is the centerpiece, not an illustrative overlay.
- Every narrated claim must be visible at the same time in the agent interface or application.
- Preserve exact invoice numbers, amounts, purchase orders, exception ownership, document names, case references, payment details, and status changes across scenes.
- Show every consequential approval immediately before the write. Do not silently approve document transfer, invoice submission, exception response, inquiry creation, portal-result writeback, or payment writeback.
- Remove dead time with cuts; do not falsify application state or tool behavior.
- Save raw footage and editing artifacts locally. Do not commit recordings, credentials, tokens, cookies, or temporary production files.

## Repository invariants

- Acme AP is the only contest product. It has exactly **12 authenticated browser tools**.
- OpenFinance AR is an independent demo reference system. It has exactly **7 browser tools** and is not part of the AP product or contest tool count.
- Never describe them as one 19-tool product in the UI, video, README, submission, or agent response.
- The applications are independently authenticated, deployed, and persisted.
- Never add a shared database, credential, session, server-to-server integration, queue, webhook, or hidden cross-write between them.
- Each of Acme AP's 12 tools terminates in AP. Each of the AR reference system's seven tools terminates in AR.
- The human is the only authority that permits information to move between the separate applications.
- Buyer-owned blockers must remain outside supplier authority and be routed through a tracked case.
- Critical authorization, validation, tenant isolation, financial state, and integration rules remain backend-authoritative.
- Use only synthetic data. Never expose secrets or service-role credentials.
- Do not change application code merely to simplify filming. Fix only genuine defects, test them proportionately, and preserve the real workflow.

## If code changes become necessary

Read `README.md` and the relevant files in `docs/` first. From the repository root, verify with:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
bun audit
```

Supabase migrations are forward-only and must be applied before dependent deployments. Preserve unrelated changes, update affected documentation, and commit and push only completed, verified work.
