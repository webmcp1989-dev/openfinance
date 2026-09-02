# OpenFinance Supplier Portal — Acme AP

[Acme AP](https://openfinance-ap.vercel.app) is the contest submission: an authenticated buyer portal with **12 browser WebMCP tools** for purchase-order context, invoice validation and submission, exceptions, buyer cases, corrected revisions, receipt status, and payment remittance.

Supplier teams normally learn and operate a different portal for every large customer. Direct API integration is a costly project per buyer; manual work is repetitive and error-prone. Acme AP makes the existing portal agent-operable without giving up its authentication, business rules, ledger, or human approval controls.

## Judge quick start

1. Evaluate **Acme AP** as the submitted product. Open it in the ChatGPT desktop app's built-in browser, enable **Site tools** in Browser permissions, and sign in with the private credentials supplied in Devpost.
2. Confirm that the authenticated page exposes exactly **12 tools**.
3. Ask: **“Using only this supplier portal's tools, review its invoice requirements, open purchase orders, current invoices, exceptions, buyer cases, and payment remittance. Explain what the supplier can act on and what Acme owns. Do not make changes.”**
4. Use the [judge guide](docs/JUDGE_GUIDE.md) for expected AP evidence. Agents can also read the deployed [evaluation guide](https://openfinance-ap.vercel.app/llms.txt).

The Chrome WebMCP flag exposes the experimental page API for lower-level testing. The complete ChatGPT agent workflow uses the desktop app's built-in browser and Site tools; installing or opening a Chrome side panel alone does not enable Site tools.

## Contest scope

Only [`apps/acme-ap`](apps/acme-ap) and [`services/acme`](services/acme) constitute the submitted product. Acme AP owns its authentication, authorization, supplier boundary, business rules, database, and ledger. Every AP tool operates only inside that boundary and has a corresponding human UI path.

The repository also contains [`apps/openfinance-ar`](apps/openfinance-ar), an independently operated synthetic supplier invoice system with its own deployment, authentication, database, and **7 browser tools**. AR exists only to make the cross-company demo reproducible. It is not part of Acme AP or its tool count.

## Why this is a strong WebMCP use case

WebMCP turns portal actions into precise, discoverable capabilities inside the authenticated page. An agent can read Acme's live PO and evidence rules, explain which invoices qualify, submit an approved batch, route exceptions to the correct owner, and retrieve exact remittance. Acme's backend remains authoritative, and the human retains control of every document write.

The demo proves interoperability rather than a hidden integration. AP and AR share no database, credential, session, server-to-server API, queue, or webhook. The browser agent carries only information the human approves, and each application writes only its own ledger.

| Judging area | Verifiable product evidence |
| --- | --- |
| WebMCP leverage | 12 distinct authenticated capabilities cover a real invoice lifecycle, not a single wrapper call. |
| Execution | Read and write results appear in the same production UI; writes are validated, transactional, idempotent, and auditable. |
| Impact | One agent can operate buyer-specific rules and exception workflows that suppliers otherwise handle portal by portal. |
| Creativity and ambition | AP exposes a governed browser interface that can interoperate with external supplier systems without a partner-specific integration. |

## Optional full-loop demonstration

Acme AP can be evaluated on its own. The repository also includes an independent synthetic AR reference system for judges who want to reproduce the complete external-system loop shown in the video.

Opening instruction:

> Submit all Acme invoices that can be paid.

Follow-up instruction:

> Resolve supplier-owned exceptions, open cases for buyer-owned blockers, and reconcile approved payments back into OpenFinance.

The optional deterministic demonstration finds three external supplier invoices, submits the two that qualify for a total of $25,670 after approval, and leaves one blocked by Acme's live rules. It then resolves a supplier-owned evidence exception, opens a case for a buyer-owned blocker without falsely claiming resolution, and reads exact payment remittance. The AR reference system separately records the verified AP outcomes. See the [judge guide](docs/JUDGE_GUIDE.md#optional-full-loop-reference) for the starting state and visible results.

## Repository

- `apps/acme-ap` and `services/acme`: submitted AP product, independent Supabase migrations, reset, and database tests.
- `apps/openfinance-ar` and `services/openfinance`: demo-only AR reference system with a separate Supabase boundary.
- `tests`: repository and production-contract tests.
- `docs/openapi.yaml`: same-origin HTTP contracts.
- `docs`: setup, architecture, security, WebMCP, API, and judge guidance.

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
