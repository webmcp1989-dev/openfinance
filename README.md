# OpenFinance

OpenFinance is a WebMCP-native supplier portal submitted to the [OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/). Its primary contest application is the independently authenticated **Acme AP supplier portal**. The repository also includes an independently authenticated **OpenFinance AR reference system** so judges can reproduce and inspect the complete external-supplier workflow shown in the demo.

## Submission hierarchy

| Level | Repository component | Contest role | What it proves |
| --- | --- | --- | --- |
| **Primary submitted application** | [`apps/acme-ap`](apps/acme-ap) · [live AP portal](https://openfinance-ap.vercel.app) | The WebMCP-native buyer-operated supplier portal being evaluated. It exposes twelve authenticated site tools for requirements, PO context, validation, invoice submission, status, exceptions, buyer cases, corrected revisions, and remittance. | An existing B2B portal can become reliably agent-operable while retaining its own authentication, authorization, business rules, data, and human controls. |
| **Independent reference/demo system** | [`apps/openfinance-ar`](apps/openfinance-ar) · [live AR system](https://openfinance-ar.vercel.app) | A synthetic supplier-owned invoice system used to provide the external records, documents, evidence, and remittance writeback visible in the narrated demonstration. It exposes seven browser site tools. | A real external supplier system and the AP portal can participate in one human-directed workflow without a private connector or shared infrastructure. |
| **Runtime interoperability layer** | WebMCP-enabled browser agent plus the signed-in human | Reads and invokes the tools independently exposed by each authenticated page. It is not a hidden application service and owns no shared ledger. | The agent can coordinate semantically precise work across company boundaries while the human controls every consequential data transfer and document write. |
| **Optional, outside contest narrative** | OpenFinance AR remote MCP at `/mcp` | An own-system OAuth connector for an AR team's external agent. It is not part of the submitted browser-WebMCP story or the 19-tool count. | Remote MCP can complement the product without becoming a private AR-to-AP integration. |

### What judges should evaluate

The AP supplier portal is the primary application and the center of the contest claim. Its twelve WebMCP tools turn buyer-owned rules and workflows into authenticated, discoverable capabilities: an agent can inspect invoice requirements and purchase orders, validate a supplier package, request explicit human approval for document writes, submit an idempotent batch, respect exception ownership, open a buyer case, and read exact payment remittance. Every capability is also available through the normal human interface and reaches the same backend services and authorization rules.

The AR application is supporting evidence, not a second half of a private product integration. It represents the kind of supplier-owned system that would exist outside the buyer's organization in a real deployment. The complete demo uses it to prove that the primary AP portal works with an independently operated external system rather than only with records already inside Acme.

Keeping the AR reference implementation in this public monorepo is deliberate:

- the submitted video materially uses it for invoice discovery, protected invoice PDFs, delivery evidence, and payment reconciliation;
- judges can reproduce the complete narrated workflow from source rather than trust an opaque demo dependency;
- separate code, deployments, authentication, databases, migrations, and credentials make the absence of a hidden integration auditable;
- matching synthetic identifiers can be inspected as deterministic fixtures rather than mistaken for shared records or synchronization; and
- one repository, license, setup guide, and commit history gives reviewers a complete and lower-friction submission package.

Its inclusion does **not** mean Acme owns the supplier's AR system, that customers must deploy OpenFinance AR, or that the commercial AP product depends on this specific companion application. A real supplier could use its own system or agent workflow. OpenFinance AR is the reproducible reference participant used to prove that interoperability today.

## System boundary

```text
REFERENCE SUPPLIER SYSTEM                         PRIMARY CONTEST APPLICATION
┌──────────────────────────────┐                 ┌──────────────────────────────┐
│ OpenFinance AR               │                 │ Acme AP supplier portal      │
│ independent auth + database  │                 │ independent auth + database  │
│ 7 browser WebMCP tools       │                 │ 12 browser WebMCP tools      │
└──────────────┬───────────────┘                 └──────────────┬───────────────┘
               │                                                │
               └──────── browser agent + informed human ────────┘
                             only runtime bridge
```

There is no shared database, credential, session, server-to-server API, queue, webhook, or point-to-point application integration. The browser agent works through each site's narrow, authenticated WebMCP tools in the user's existing sessions. The human explicitly approves the destination and exact invoice packages before cross-site validation, then separately approves each consequential AP document write.

Both portals are also complete human workspaces: every WebMCP capability can be performed through accessible UI controls backed by the same authenticated services. Beyond governed upload, the applications expose line/receipt/service-entry PO context, invoice timelines, structured exception ownership, evidence-backed responses, corrected revisions, AP inquiries, payment remittance, and AR follow-up reconciliation. A human can download a verified, detailed invoice PDF and supporting evidence, then use Acme's governed submission and resolution flows. OpenFinance AR additionally includes a tenant-scoped `Sync invoices now` simulation that alternates between importing two synthetic ERP invoices and finding no new invoices.

The authority model is deliberately asymmetric: **19 browser tools, zero cross-writes**. Seven OpenFinance tools write only AR; twelve Acme tools write only AP. The agent can reconcile both authenticated views, but only the human authorizes the financial data transferred between them. Buyer-owned blockers are explicitly named as outside supplier authority and routed into tracked AP cases.

## Why WebMCP

Financial work needs reliable business semantics, not coordinate-based browser guessing. Acme exposes narrow operations for requirements, validation, document submission, exception handling, buyer cases, and remittance. The agent can reason across those capabilities while Acme continues to enforce authorization and financial invariants in its own backend.

| Human | Agent | Applications |
| --- | --- | --- |
| States the business intent and reviews exact previews | Discovers the relevant tools, records, rules, and blockers | Authenticate users and enforce their own permissions |
| Approves each cross-company transfer and consequential document write | Explains what qualifies, what is excluded, and who owns each exception | Validate inputs and commit only authorized state changes |
| Retains final authority and can inspect the visible result | Carries only approved information between the two sessions | Keep independent ledgers, audit trails, and human UI paths |

### Contest scope

The primary submitted app is Acme AP. The video broadens the proof by exercising it from the independent OpenFinance AR reference system. The live prompt and **19-tool** count cover the complete browser-mediated workflow: twelve AP tools plus seven reference-system AR tools, with zero cross-writes. This distinction should remain explicit in the submission description and demo so the supporting system is never mistaken for a hidden product dependency.

The separate AR remote MCP is intentionally excluded from that judge-facing story because it is an own-system connector, not the cross-company interoperability mechanism being demonstrated.

OpenFinance AR also provides an optional OAuth-protected remote MCP server at `https://openfinance-ar.vercel.app/mcp` for an AR team's own OpenAI or Claude agent. Supabase OAuth 2.1 supplies consent, PKCE, dynamic client registration, resource-bound access tokens, and revocation while existing RLS preserves user, tenant, and role boundaries. It cannot access Acme and never creates a private AR-to-AP bridge. See [Optional AR remote MCP](docs/MCP.md).

## Judge paths

### Primary application review

A reviewer can open only the [Acme AP portal](https://openfinance-ap.vercel.app) to inspect its normal supplier workspace, authenticated WebMCP registrations, buyer-owned purchase-order rules, human-equivalent controls, document approval boundary, exception ownership, cases, invoice timelines, and remittance state. AP authorization and business rules are complete within that application and never depend on an AR session.

### Complete interoperability demonstration

The narrated demo opens both independently authenticated applications. It uses OpenFinance AR as an external supplier participant and Acme AP as the primary WebMCP-native portal. The browser agent is the only runtime bridge; each application reads and writes only its own backend.

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

## Repository structure

- `apps/acme-ap`: **primary submitted application**—the independently deployed Acme AP supplier portal.
- `services/acme`: AP portal schema, migrations, deterministic synthetic seed, reset logic, and database security tests.
- `apps/openfinance-ar`: **independent reference/demo application**—the synthetic supplier invoice system used in the complete workflow.
- `services/openfinance`: AR reference schema, migrations, deterministic synthetic seed, reset logic, and database security tests.
- `tests`: repository and production-contract verification across the public submission.
- `docs/openapi.yaml`: same-origin HTTP contracts for both independently deployed applications.
- `docs`: architecture, security, setup, WebMCP, API, and concise judge guidance.

The folder order above reflects the contest hierarchy, not a runtime dependency direction. Neither application imports the other's business logic, connects to the other's database, or calls the other's backend.

## Local verification

Requires Bun 1.3.14 or newer.

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
```

Copy `.env.example` to each app's `.env.local` and use only that app's Supabase URL and publishable key. A judge evaluating only the primary AP application can configure its AP environment independently. Reproducing the complete video additionally requires the separate AR environment. See [setup](docs/SETUP.md) for migrations, demo users, deployments, and the separate human-only resets needed for repeatable judging.

## Documentation

- [Judge guide](docs/JUDGE_GUIDE.md)
- [Setup and deployment](docs/SETUP.md)
- [System architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [WebMCP tool inventory](docs/WEBMCP.md)
- [OpenAPI contract](docs/openapi.yaml)

The [optional AR remote MCP appendix](docs/MCP.md) documents an own-system extension that is intentionally outside the browser-WebMCP contest narrative.

## License

MIT. Copyright 2026 Ido Dubovi.
