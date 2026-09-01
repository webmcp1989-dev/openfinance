# Setup and deployment

OpenFinance AR and Acme AP must use separate Supabase projects, Vercel projects, environment values, and authenticated sessions.

## Prerequisites

- Bun 1.3.14 or newer
- Two Supabase projects
- Two Vercel projects connected to this repository
- A WebMCP-capable browser

## Database

Apply every `.sql` migration in filename order to its owning project:

| Application | Migration directory | Database tests |
| --- | --- | --- |
| OpenFinance AR | `services/openfinance/supabase/migrations` | `services/openfinance/supabase/tests` |
| Acme AP | `services/acme/supabase/migrations` | `services/acme/supabase/tests` |

Never apply one application's SQL to the other project. Migrations are forward-only and include schema, RLS, grants, private transaction functions, deterministic synthetic data, and reset support. The service README in each directory explains its database boundary.

Create one password user per project after applying migrations so the profile trigger can attach the correct synthetic tenant:

- OpenFinance AR: `demo@openfinance.dev`
- Acme AP: `supplier@acme.demo`

Use strong unique passwords and provide them only through the contest's private credential field. Disable public signup after creating the users; keep email/password login enabled.

## Environment and hosting

Create a separate `.env.local` for each app from `.env.example`. Each Vercel project receives only its own values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

OpenFinance AR production also uses `OPENFINANCE_MCP_URL=https://openfinance-ar.vercel.app/mcp`. Its optional own-system connector requires the Supabase OAuth server, `/oauth/consent` authorization path, dynamic client registration, the AR production redirect allowlist, and `public.custom_access_token_hook`. This connector never has access to Acme AP.

Never add a service-role key or database password to either Next.js runtime.

| Vercel project | Root directory | Supabase project |
| --- | --- | --- |
| `openfinance-ap` | `apps/acme-ap` | Acme AP |
| `openfinance-ar` | `apps/openfinance-ar` | OpenFinance AR |

## Local development

```bash
bun install --frozen-lockfile
bun run dev:openfinance  # http://localhost:3000
bun run dev:acme         # http://localhost:3001
```

Run the apps in separate terminals. Site tools call only their application's same-origin backend.

## Validation

```bash
bun run typecheck
bun run lint
bun test
bun run build
bun audit
```

After migrations, run every SQL file in each application's `supabase/tests` directory against its owning project. Then sign into both deployments, inspect the registered site tools, and run the [judge workflow](JUDGE_GUIDE.md#workflow).

## Restore the synthetic demo state

Each authenticated workspace has a two-step **Restore demo start** control. Restore AP and AR separately; reset is human-only, tenant-scoped, audited, and absent from WebMCP.

1. In Acme AP, review and confirm **Restore synthetic AP data**.
2. In OpenFinance AR, review and confirm **Restore synthetic AR data**.
3. Confirm AP shows nine open POs and three historical exception invoices.
4. Confirm AR shows 24 invoices; only `INV-10482`, `INV-10491`, and `INV-10507` are ready; `INV-10417` and `INV-10463` need attention; and no `ERP-*` invoices exist.
5. Confirm each audit panel contains one reset event, then verify the [starting state](JUDGE_GUIDE.md#starting-state).

The reviewed operator fallback scripts are `services/acme/supabase/demo/reset.sql` and `services/openfinance/supabase/demo/reset.sql`. Use them only in their named synthetic project after confirming no demo submission is active. Never run them against real data.
