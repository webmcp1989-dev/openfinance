# YouTube publication package

Use this copy for the public OpenFinance challenge video. The latest optimized
upload candidate is `artifacts/openfinance-contest-optimized.mp4` (2:27.4,
1280x720, with video and audio tracks). Keep generated review artifacts local
and upload the selected file without another local transcode.

## Title

OpenFinance: Human-Controlled AR-to-AP Interoperability with WebMCP

## Description

OpenFinance lets independently authenticated AR and AP applications complete
invoice-delivery workflows through WebMCP, without a custom point-to-point
integration or shared credentials.

The first natural-language request is: “Submit all Acme invoices that can be
paid.” The browser agent discovers capabilities in both applications, reads
the supplier's AR portfolio, checks Acme's independently authenticated portal
requirements and live PO context, excludes an invoice that fails buyer-side
checks, and previews the exact documents, amounts, POs, destination, and total.
Only after the human approves does Acme atomically commit the valid $25,670
batch. An idempotent retry returns the original result instead of submitting
anything twice.

The demo then follows the harder work after submission. The agent sends
verified delivery proof for a supplier-owned exception only after another
human approval, replaces a rejected supplier-owned invoice with an explicitly
reviewed revision, and refuses to claim authority over a buyer-owned missing
receipt—saying “This isn't mine to fix” and opening a tracked buyer case. It
finishes on cash by reading exact AP remittance and, after approval, recording
that result in OpenFinance AR.

The human provides intent, judgment, and approval. The agent discovers,
reconciles, explains, and executes. Both applications visibly update their own
authoritative state and audit trail. OpenFinance demonstrates 19 browser tools
across two independently authenticated companies with zero cross-writes: each
portal writes only its own ledger, and only the human authorizes information
crossing between them.

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
