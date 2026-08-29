# Setup and deployment

The two applications must remain independently configured. Never reuse a Supabase project, publishable key, database password, or authenticated browser session between them.

## Prerequisites

- Bun 1.3.14 or newer
- Two Supabase projects
- Two Vercel projects connected to this repository
- A current ChatGPT desktop app with site tools enabled and GPT-5.6 Sol or Terra selected

## Database setup

Run each migration only in its named project:

| Application | Supabase project ref | Migrations, in order |
| --- | --- | --- |
| OpenFinance AR | `bhjtwmpwlmdqjxlvgrhj` | `services/openfinance/supabase/migrations/202608290001_initial.sql`<br>`services/openfinance/supabase/migrations/202608290002_reject_duplicate_delivery_items.sql`<br>`services/openfinance/supabase/migrations/202608290003_enforce_delivery_event_contract.sql`<br>`services/openfinance/supabase/migrations/202608290004_bound_json_money.sql`<br>`services/openfinance/supabase/migrations/202608290005_canonicalize_delivery_requests.sql`<br>`services/openfinance/supabase/migrations/202608290006_simulate_erp_invoice_sync.sql`<br>`services/openfinance/supabase/migrations/202608290007_repair_renderable_invoice_pdfs.sql`<br>`services/openfinance/supabase/migrations/202608290008_render_detailed_invoice_pdfs.sql`<br>`services/openfinance/supabase/migrations/202608290009_align_invoice_amount_due.sql`<br>`services/openfinance/supabase/migrations/202608290010_space_invoice_amount_due.sql`<br>`services/openfinance/supabase/migrations/202608290011_add_authorized_demo_reset.sql`<br>`services/openfinance/supabase/migrations/202608290012_secure_mcp_oauth_activity.sql` |
| Acme AP | `lakrgujjrhydjsoyaiin` | `services/acme/supabase/migrations/202608290001_initial.sql`<br>`services/acme/supabase/migrations/202608290002_harden_submission_wrapper.sql`<br>`services/acme/supabase/migrations/202608290003_bound_json_money.sql`<br>`services/acme/supabase/migrations/202608290004_align_submission_policy.sql`<br>`services/acme/supabase/migrations/202608290005_canonicalize_submission_requests.sql`<br>`services/acme/supabase/migrations/202608290006_validate_pdf_structure.sql`<br>`services/acme/supabase/migrations/202608290007_simulate_payment_settlement.sql`<br>`services/acme/supabase/migrations/202608290008_add_authorized_demo_reset.sql` |

Apply every listed migration in filename order through the Supabase SQL editor or a reviewed migration pipeline. The migrations are transactional, enable RLS on every exposed table, revoke anonymous access, grant only required reads, and expose authenticated write wrappers around private transaction functions.

Create one password user per project after the migration so its trigger can attach the correct tenant profile:

- OpenFinance AR: `demo@openfinance.dev`
- Acme AP: `supplier@acme.demo`

Use a strong unique password for each project. Do not commit or document either password. If a user was created before the migration, delete and recreate it or insert the corresponding profile through a reviewed administrative script.

## Application environment

Each Vercel project receives only its own values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# OpenFinance AR only:
OPENFINANCE_MCP_URL=https://openfinance-ar.vercel.app/mcp
```

The values are public connection identifiers; authorization comes from the authenticated user JWT, Postgres grants, and RLS. Never add a service-role key or database password to either Next.js runtime.

For OpenFinance AR, enable the Supabase OAuth 2.1 server, set its authorization path to `/oauth/consent`, enable dynamic client registration, and keep the AR production origin in the Auth site URL/redirect allowlist. AP does not receive `OPENFINANCE_MCP_URL` and does not share the AR authorization server. See [MCP.md](MCP.md) for the discovery and security contract.

Vercel project mapping:

| Vercel project | Root directory | Supabase project |
| --- | --- | --- |
| `openfinance-ar` | `apps/openfinance-ar` | OpenFinance AR |
| `openfinance-ap` | `apps/acme-ap` | OpenFinance AP / Acme demo |

## Local run

Create `apps/openfinance-ar/.env.local` and `apps/acme-ap/.env.local` with their separate values, then:

```bash
bun install --frozen-lockfile
bun run dev:openfinance
bun run dev:acme
```

The apps run on ports 3000 and 3001. Cross-origin site calls are intentionally not supported; each site's tools call only its own same-origin backend.

## Verification gate

Before deployment:

```bash
bun run typecheck
bun run lint
bun test
bun run build
bun audit
```

Run every SQL file under each service's `supabase/tests` directory in its corresponding project after applying all migrations. Then sign into both live applications in separate tabs, inspect Available site tools, and run the [demo checklist](DEMO.md).

## Restore the synthetic demo state

Each authenticated demo workspace has a two-step **Restore demo start** control. Restore AR and AP separately: each application calls only its own same-origin backend and database. The reset is deliberately human-only, is not registered with WebMCP, requires an explicit confirmation payload, permits only the fixed synthetic demo operator or submitter, and replaces prior workflow audit entries with one visible `demo_state_reset` event.

For a judge or normal demo rerun:

1. In Acme AP, choose **Restore demo start**, review the deletion notice, and choose **Restore synthetic AP data**.
2. In OpenFinance AR, choose **Restore demo start**, review the deletion notice, and choose **Restore synthetic AR data**.
3. Confirm Acme shows three open POs at full balances and no receipts.
4. Confirm OpenFinance shows three ready invoices, `INV-10503` as `needs_attention`, no imported `ERP-*` invoices, and the ERP sequence reset to `2 new → 0 new`.
5. Each audit panel should contain exactly one visible reset event before the next workflow run.

The reviewed SQL scripts remain an operator fallback:

1. Confirm no demo submission is currently running and that both projects are the synthetic challenge projects listed above.
2. In the **Acme AP** SQL editor, review and run `services/acme/supabase/demo/reset.sql`.
3. Confirm it reports three open POs at their full seeded balances and zero batches, submissions, and audit events.
4. In the **OpenFinance AR** SQL editor, review and run `services/openfinance/supabase/demo/reset.sql`.
5. Confirm it reports three ready invoices, `INV-10503` as `needs_attention`, zero delivery and audit events, and an ERP sync sequence reset to `2 new → 0 new`.
6. Reload both applications and verify the [starting state](DEMO.md#starting-state) before rerunning the test.

Each script uses explicit synthetic IDs, an advisory transaction lock, exact affected-row assertions, and a transaction. Never run either script against a project containing real data, and never point a script at the other application's project.
