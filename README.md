# OpenFinance

OpenFinance demonstrates agent-mediated interoperability between two independently authenticated B2B finance applications for the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/).

```text
OpenFinance AR  <-- site tools -->  ChatGPT + human  <-- site tools -->  Acme AP
```

There is no shared database, credential, session, or point-to-point application integration. The browser agent works through each site's narrow, authenticated WebMCP tools. The human explicitly approves the destination and exact invoice packages before cross-site validation, then separately confirms the exact valid batch before the consequential AP submission tool runs.

Both portals are also complete human workspaces: every WebMCP capability can be performed through accessible UI controls backed by the same authenticated services. A human can download a verified, detailed invoice PDF containing the supplier, customer, dates, PO, line item, amount due, and synthetic remittance details, then upload it through Acme's governed submission flow. OpenFinance AR additionally includes a tenant-scoped `Sync invoices now` simulation that alternates between importing two synthetic ERP invoices and finding no new invoices.

## Demo workflow

Ask the agent:

> Submit all Acme invoices that are ready for their AP portal.

The intended result is deliberately non-trivial:

1. OpenFinance exposes three locally ready invoice packages and one missing-PO exception.
2. The agent previews the three packages and Acme destination; the human approves their transfer for read-only validation.
3. Acme validates each approved package against its independently stored PO data.
4. Two invoices pass; `INV-10507` exceeds the remaining balance on `PO-8890`.
5. The agent presents the exact valid batch and exception, then obtains a separate submission approval.
6. Acme atomically submits only the confirmed valid invoices and returns portal references.
7. OpenFinance records those references and the exception, updating the human-visible queue.
8. Ten seconds later, Acme's deterministic buyer simulation marks one of the two committed invoices paid; the UI and read-only status tool expose the same payment reference.

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

Copy `.env.example` to each app's `.env.local` and use only that app's Supabase URL and publishable key. See [setup](docs/SETUP.md) for migrations, demo users, deployments, and reset instructions.

## Documentation

- [Challenge and demo north star](docs/NORTH_STAR.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [WebMCP tool inventory](docs/WEBMCP.md)
- [Demo runbook](docs/DEMO.md)
- [Verification record](docs/VERIFICATION.md)
- [Challenge submission package](docs/SUBMISSION.md)
- [YouTube publication package](docs/YOUTUBE.md)
- [OpenAPI contract](docs/openapi.yaml)
- [Architecture decisions](docs/decisions/0001-independent-applications.md)

## License

MIT. Copyright 2026 Ido Dubovi.
