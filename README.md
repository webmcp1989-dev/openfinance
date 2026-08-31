# OpenFinance

OpenFinance demonstrates agent-mediated interoperability between two independently authenticated B2B finance applications for the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/).

```text
OpenFinance AR  <-- WebMCP site tools -->  browser agent + human
                                                   |
Acme AP         <-- WebMCP site tools --------------+
```

There is no shared database, credential, session, or point-to-point application integration. The browser agent works through each site's narrow, authenticated WebMCP tools. The human explicitly approves the destination and exact invoice packages before cross-site validation, then separately confirms the exact valid batch before the consequential AP submission tool runs.

Both portals are also complete human workspaces: every WebMCP capability can be performed through accessible UI controls backed by the same authenticated services. Beyond governed upload, the applications expose line/receipt/service-entry PO context, invoice timelines, structured exception ownership, evidence-backed responses, corrected revisions, AP inquiries, payment remittance, and AR follow-up reconciliation. A human can download a verified, detailed invoice PDF and supporting evidence, then use Acme's governed submission and resolution flows. OpenFinance AR additionally includes a tenant-scoped `Sync invoices now` simulation that alternates between importing two synthetic ERP invoices and finding no new invoices.

The authority model is deliberately asymmetric: **19 browser tools, zero cross-writes**. Seven OpenFinance tools write only AR; twelve Acme tools write only AP. The agent can reconcile both authenticated views, but only the human authorizes the financial data transferred between them. Buyer-owned blockers are explicitly named as outside supplier authority and routed into tracked AP cases.

### Contest scope

The primary submission, video, live prompt, and **19-tool** count cover only the browser-mediated WebMCP workflow above. The separate AR remote MCP is intentionally excluded from that judge-facing story because it is an own-system connector, not the cross-company interoperability mechanism being demonstrated.

OpenFinance AR also provides an optional OAuth-protected remote MCP server at `https://openfinance-ar.vercel.app/mcp` for an AR team's own OpenAI or Claude agent. Supabase OAuth 2.1 supplies consent, PKCE, dynamic client registration, resource-bound access tokens, and revocation while existing RLS preserves user, tenant, and role boundaries. It cannot access Acme and never creates a private AR-to-AP bridge. See [Optional AR remote MCP](docs/MCP.md).

## Demo workflow

Ask the agent:

> Submit all Acme invoices that can be paid.

The default seed is a realistic 24-invoice AR portfolio with exactly three narrated Acme candidates and three independently seeded AP exceptions. The intended result is deliberately non-trivial:

1. OpenFinance exposes `INV-10482`, `INV-10491`, and `INV-10507` as the three locally ready candidates among accepted, submitted, rejected, paid, and blocked history.
2. The agent previews the exact packages and Acme destination; the human approves their transfer for read-only validation.
3. Acme validates each approved package against its independently stored PO data.
4. Two invoices pass; `INV-10507` exceeds the remaining balance and lacks accepted service entry on `PO-8890`.
5. The agent presents the two valid invoices, their $25,670 total, and the excluded invoice, then obtains a separate submission approval.
6. Acme atomically submits only the confirmed two-invoice batch and returns portal references.
7. OpenFinance records those references and the exact exception, updating the human-visible queue.
8. For a seeded supplier-owned missing-delivery-proof exception, the agent can send verified AR evidence after approval. For a buyer-owned missing receipt, it says “This isn't mine to fix” and offers an approved tracked case. For rejected `INV-10479`, it can submit an approved corrected revision because AP explicitly permits `replace_invoice`.
9. Ten seconds later, Acme's deterministic buyer simulation marks the first invoice in this canonical approved pair paid with `PAY-20260830-0DD9D23B`; UI and read-only status tools expose the exact reference.
10. After exact human review, the agent reads AP remittance and writes those allocations back to AR. The story ends on reconciled cash, not document submission.

## Applications

- `apps/openfinance-ar`: seller-side AR queue deployed independently at [openfinance-ar.vercel.app](https://openfinance-ar.vercel.app).
- `apps/acme-ap`: Acme supplier portal deployed independently at [openfinance-ap.vercel.app](https://openfinance-ap.vercel.app).
- `services/openfinance`: reproducible OpenFinance Supabase migration and database security tests.
- `services/acme`: reproducible independent Acme Supabase migration and database security tests.
- `docs/openapi.yaml`: HTTP contract used by both sites' backend-for-frontend APIs.

## Local verification

Requires Bun 1.3.14 or newer.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
```

Copy `.env.example` to each app's `.env.local` and use only that app's Supabase URL and publishable key. See [setup](docs/SETUP.md) for migrations, demo users, deployments, and the separate human-only reset needed for repeatable judging.

## Documentation

- [Challenge and demo north star](docs/NORTH_STAR.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [WebMCP tool inventory](docs/WEBMCP.md)
- [Optional AR remote MCP and OAuth](docs/MCP.md)
- [Demo runbook](docs/DEMO.md)
- [Verification record](docs/VERIFICATION.md)
- [Challenge submission package](docs/SUBMISSION.md)
- [YouTube publication package](docs/YOUTUBE.md)
- [OpenAPI contract](docs/openapi.yaml)
- [Architecture decisions](docs/decisions/0001-independent-applications.md)

## License

MIT. Copyright 2026 Ido Dubovi.
