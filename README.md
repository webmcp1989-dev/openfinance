# OpenFinance

OpenFinance is a WebMCP-native supplier portal submitted to the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/). The primary contest application is the independently authenticated [Acme AP supplier portal](https://openfinance-ap.vercel.app). The repository also includes an independent [OpenFinance AR reference system](https://openfinance-ar.vercel.app) so the complete supplier workflow is reproducible.

## What is submitted

| Component | Role |
| --- | --- |
| [`apps/acme-ap`](apps/acme-ap) | Primary application. Twelve authenticated browser WebMCP tools expose buyer requirements, PO context, validation, governed invoice submission, exceptions, cases, revisions, and remittance. |
| [`apps/openfinance-ar`](apps/openfinance-ar) | Independent synthetic supplier system used to demonstrate invoice discovery, evidence retrieval, and remittance writeback. It exposes seven browser WebMCP tools. |
| Browser agent + human | The only runtime bridge. The agent coordinates each site's tools; the human approves data transfer and consequential document writes. |

The primary submitted app is Acme AP. OpenFinance AR is supporting evidence that the portal can participate in a real external-supplier workflow rather than a required companion product.

## Why WebMCP

Supplier teams repeatedly re-key invoices into buyer portals, interpret different PO and evidence rules, resolve exceptions, and retrieve payment details. Direct API integration is usually a separate project for every buyer.

WebMCP lets each portal expose precise capabilities inside its existing authenticated page. The agent handles cross-system discovery and reasoning; each application retains its own authorization, business rules, and ledger; the human retains authority over information crossing company boundaries.

```text
OpenFinance AR              browser agent + human              Acme AP
independent auth + data  <-------- WebMCP -------->  independent auth + data
7 browser tools                                           12 browser tools
```

There is no shared database, credential, session, server-to-server API, queue, webhook, or hidden integration. The core claim is **19 browser tools, two independently authenticated companies, and zero cross-writes**. All tool capabilities also have human UI paths backed by the same backend rules.

## Demo

Opening instruction:

> Submit all Acme invoices that can be paid.

Follow-up instruction:

> Resolve supplier-owned exceptions, open cases for buyer-owned blockers, and reconcile approved payments back into OpenFinance.

The deterministic workflow qualifies three candidates, submits two totaling $25,670 after approval, leaves one blocked by buyer rules, resolves supplier-owned evidence, opens a buyer-owned case without overstepping authority, and finishes by reconciling exact payment remittance. See the [judge guide](docs/JUDGE_GUIDE.md) for the starting state and expected visible results.

## Repository

- `apps/acme-ap` and `services/acme`: primary AP application, independent Supabase migrations, reset, and database tests.
- `apps/openfinance-ar` and `services/openfinance`: independent AR reference application and its own Supabase boundary.
- `tests`: repository and production-contract tests.
- `docs/openapi.yaml`: same-origin HTTP contracts.
- `docs`: only the setup, architecture, security, WebMCP, API, and judge guidance needed to understand and reproduce the project.

## Run and verify

Requires Bun 1.3.14 or newer.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
```

Each app requires only its own Supabase URL and publishable key. See [SETUP.md](docs/SETUP.md) for migration order, local development, deployment, database tests, and deterministic reset instructions.

## Documentation

- [Judge guide](docs/JUDGE_GUIDE.md)
- [Setup and deployment](docs/SETUP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [WebMCP tools](docs/WEBMCP.md)
- [OpenAPI contract](docs/openapi.yaml)

## License

MIT. Copyright 2026 Ido Dubovi.
