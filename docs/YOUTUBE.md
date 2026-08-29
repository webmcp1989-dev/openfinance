# YouTube publication package

Use this copy for the public OpenFinance challenge video. The reviewed upload
artifact is `artifacts/demo-video/openfinance-demo.webm` (2:47, 1600x900,
VP9 + Opus). Upload the file without transcoding it locally.

## Title

OpenFinance: Human-Controlled AR-to-AP Interoperability with WebMCP

## Description

OpenFinance lets independently authenticated AR and AP applications complete
invoice-delivery workflows through WebMCP, without a custom point-to-point
integration or shared credentials.

One natural-language request starts the demo: “Submit all Acme invoices that
are ready for their AP portal.” The browser agent discovers capabilities in
both applications, finds three locally ready invoices, excludes an invoice
that is missing a PO, and previews the exact documents, amounts, POs, and Acme
destination before anything crosses sites. After the human approves that
read-only transfer, the agent checks Acme's live portal requirements and PO
balances. It detects that INV-10507 exceeds PO-8890's remaining balance, then
asks for a separate confirmation before submitting only the valid $25,670
batch. Acme returns two portal references, which the agent records back in
OpenFinance together with the actionable exception.

The human provides intent, judgment, and approval. The agent discovers,
reconciles, explains, and executes. Both applications visibly update their own
authoritative state and audit trail.

This challenge demo uses synthetic companies, users, invoices, purchase
orders, and documents.

Try the independently deployed applications:
- OpenFinance AR: https://openfinance-ar.vercel.app
- Acme AP: https://openfinance-ap.vercel.app

Source and reproducibility guide:
- https://github.com/webmcp1989-dev/openfinance

OpenAI WebMCP Challenge:
- https://openai.com/webmcp-challenge/

#WebMCP #OpenAI #AIAgents #Fintech #HumanInTheLoop

## Tags

`WebMCP, OpenAI, ChatGPT, AI agents, browser agents, human in the loop, accounts receivable, accounts payable, invoice automation, B2B finance, fintech, OpenFinance`

## Upload settings

- Visibility: **Public**
- Category: **Science & Technology**
- Audience: **No, it is not made for kids**
- Language: **English**
- Thumbnail: `scripts/demo-video/assets/youtube-thumbnail.png`
- Captions: allow YouTube to generate English captions, then review names,
  invoice identifiers, purchase-order identifiers, and amounts for accuracy.
- License: **Standard YouTube License**
- Comments: leave enabled unless moderation requires otherwise.

## Publication verification

1. Confirm the uploaded duration is under three minutes and processing reaches
   HD before sharing the link.
2. Open the public video URL in a signed-out window and confirm that the video,
   audio, thumbnail, title, description links, and captions work.
3. Do not place judge passwords in the title, description, tags, captions,
   thumbnail, or comments. Devpost's private credentials field is the only
   place for judge credentials.
4. Paste the final public URL into the Devpost submission and `docs/SUBMISSION.md`.
