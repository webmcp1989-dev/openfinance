# OpenFinance Supplier Portal — Acme AP

The contest submission is the independently authenticated [Acme AP supplier portal](https://openfinance-ap.vercel.app). It is a WebMCP-native buyer portal with **12 authenticated browser tools** for purchase-order context, invoice validation and submission, exceptions, buyer cases, corrected revisions, receipt status, and payment remittance.

## Judge quick start

1. Evaluate **Acme AP** as the submitted product; OpenFinance AR is only an independent synthetic reference system for the demo.
2. Open the AP portal in the ChatGPT desktop app's built-in browser, enable **Site tools** in Browser permissions, and sign in with the private credentials supplied in Devpost.
3. Confirm that the page exposes exactly **12 authenticated WebMCP tools**, then run **“Submit all Acme invoices that can be paid.”**
4. Use the [judge guide](docs/JUDGE_GUIDE.md) for the deterministic workflow and expected evidence, or read the live [agent-readable guide](https://openfinance-ap.vercel.app/llms.txt).

The ChatGPT Chrome side panel does not currently expose ChatGPT Site Tools. Chrome's WebMCP testing flag is useful for testing the underlying browser API, but the ChatGPT desktop built-in browser is the supported evaluation surface for the real agent workflow.

## Contest scope

Only [`apps/acme-ap`](apps/acme-ap) and its independently deployed backend in [`services/acme`](services/acme) constitute the submitted product. The AP portal owns its authentication, authorization, supplier boundary, business rules, database, and ledger. Every AP WebMCP tool operates only inside that AP boundary and has a corresponding human UI path.

The repository also contains [`apps/openfinance-ar`](apps/openfinance-ar), an independently operated synthetic supplier invoice system with its own deployment, authentication, database, and **7 browser tools**. AR is a demo reference system, not part of the submitted AP product and not included in the AP tool count. It exists only to reproduce how an external supplier system can interact with a WebMCP-enabled buyer portal through a browser agent and informed human.

## Why WebMCP

Supplier teams repeatedly re-key invoices into buyer portals, interpret different PO and evidence rules, resolve exceptions, and retrieve payment details. Direct API integration is usually a separate project for every buyer.

WebMCP lets Acme expose precise AP capabilities inside its existing authenticated supplier portal. A browser agent can discover and operate those capabilities without a bespoke supplier integration, while Acme retains its own authorization, business rules, customer relationship, and ledger. The human retains authority over every consequential document write.

The demonstration uses the independent AR reference system as an external source and destination. There is no shared database, credential, session, server-to-server API, queue, webhook, or hidden integration between it and Acme AP. No AP tool can read or write the AR database, and Acme AP does not depend on the reference application.

## Demo

Opening instruction:

> Submit all Acme invoices that can be paid.

Follow-up instruction:

> Resolve supplier-owned exceptions, open cases for buyer-owned blockers, and reconcile approved payments back into OpenFinance.

The deterministic demonstration qualifies three external supplier invoices, submits two totaling $25,670 after approval, leaves one blocked by Acme's rules, resolves supplier-owned evidence, opens a buyer-owned case without overstepping authority, and exposes exact payment remittance. The independent AR reference system separately records the verified AP outcomes so the end-to-end use case is reproducible. See the [judge guide](docs/JUDGE_GUIDE.md) for the starting state and expected visible results.

## Repository

- `apps/acme-ap` and `services/acme`: submitted AP product, independent Supabase migrations, reset, and database tests.
- `apps/openfinance-ar` and `services/openfinance`: demo-only AR reference system with a separate Supabase boundary.
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
