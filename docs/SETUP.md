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
| OpenFinance AR | `bhjtwmpwlmdqjxlvgrhj` | `services/openfinance/supabase/migrations/202608290001_initial.sql`<br>`services/openfinance/supabase/migrations/202608290002_reject_duplicate_delivery_items.sql`<br>`services/openfinance/supabase/migrations/202608290003_enforce_delivery_event_contract.sql`<br>`services/openfinance/supabase/migrations/202608290004_bound_json_money.sql`<br>`services/openfinance/supabase/migrations/202608290005_canonicalize_delivery_requests.sql`<br>`services/openfinance/supabase/migrations/202608290006_simulate_erp_invoice_sync.sql`<br>`services/openfinance/supabase/migrations/202608290007_repair_renderable_invoice_pdfs.sql` |
| Acme AP | `lakrgujjrhydjsoyaiin` | `services/acme/supabase/migrations/202608290001_initial.sql`<br>`services/acme/supabase/migrations/202608290002_harden_submission_wrapper.sql`<br>`services/acme/supabase/migrations/202608290003_bound_json_money.sql`<br>`services/acme/supabase/migrations/202608290004_align_submission_policy.sql`<br>`services/acme/supabase/migrations/202608290005_canonicalize_submission_requests.sql`<br>`services/acme/supabase/migrations/202608290006_validate_pdf_structure.sql`<br>`services/acme/supabase/migrations/202608290007_simulate_payment_settlement.sql` |

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
```

The values are public connection identifiers; authorization comes from the authenticated user JWT, Postgres grants, and RLS. Never add a service-role key or database password to either Next.js runtime.

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

The applications intentionally expose no reset endpoint. Reset is an explicit administrative operation, not a hidden integration or a browser-agent capability.

1. Confirm no demo submission is currently running and that both projects are the synthetic challenge projects listed above.
2. In the **Acme AP** SQL editor, review and run `services/acme/supabase/demo/reset.sql`.
3. Confirm it reports three open POs at their full seeded balances and zero batches, submissions, and audit events.
4. In the **OpenFinance AR** SQL editor, review and run `services/openfinance/supabase/demo/reset.sql`.
5. Confirm it reports three ready invoices, `INV-10503` as `needs_attention`, zero delivery and audit events, and an ERP sync sequence reset to `2 new → 0 new`.
6. Reload both applications and verify the [starting state](DEMO.md#starting-state) before recording or rerunning the test.

Each script uses explicit synthetic IDs, an advisory transaction lock, exact affected-row assertions, and a transaction. Never run either script against a project containing real data, and never point a script at the other application's project.
