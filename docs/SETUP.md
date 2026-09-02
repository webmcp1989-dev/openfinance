# Setup and deployment

Acme AP is the submitted application and runs independently. The OpenFinance AR reference system is needed only to reproduce the optional full-loop demonstration. If both applications are deployed, they must use separate Supabase projects, Vercel projects, environment values, and authenticated sessions.

## Prerequisites

- Bun 1.3.14 or newer
- One Supabase project for Acme AP
- One Vercel project for Acme AP
- A WebMCP-capable browser

The optional full-loop demonstration additionally requires a second Supabase project and Vercel project for OpenFinance AR.

## Database

Apply every `.sql` migration in filename order to its owning project:

| Application | Migration directory | Database tests |
| --- | --- | --- |
| Acme AP | `services/acme/supabase/migrations` | `services/acme/supabase/tests` |
| OpenFinance AR (optional reference) | `services/openfinance/supabase/migrations` | `services/openfinance/supabase/tests` |

Never apply one application's SQL to the other project. Migrations are forward-only and include schema, RLS, grants, private transaction functions, deterministic synthetic data, and reset support. The service README in each directory explains its database boundary.

Create the Acme AP password user after applying its migrations so the profile trigger can attach the correct synthetic supplier:

- Acme AP: `supplier@acme.demo`

For the optional full-loop demonstration, also create the OpenFinance AR user after applying its migrations:

- OpenFinance AR: `demo@openfinance.dev`

Use strong unique passwords and provide them only through Devpost's private credential field. Disable public signup after creating the users; keep email/password login enabled.

## Environment and hosting

Create Acme AP's `.env.local` from `.env.example`. If you also deploy the optional AR reference system, create a separate `.env.local` for it. Each Vercel project receives only its own values:

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
bun run dev:acme         # http://localhost:3001
# Optional full-loop reference system:
bun run dev:openfinance  # http://localhost:3000
```

Acme AP runs independently. When reproducing the optional full-loop demonstration, run the apps in separate terminals. Site tools call only their application's same-origin backend.

## Validation

```bash
bun run typecheck
bun run lint
bun test
bun run build
bun audit
```

After applying the Acme AP migrations, run every SQL file in `services/acme/supabase/tests` against the AP project. Then sign in to Acme AP, confirm its 12 registered tools, and run the [AP-only workflow](JUDGE_GUIDE.md#ap-only-workflow).

If you deploy the optional AR reference system, also run every SQL file in `services/openfinance/supabase/tests` against the AR project, sign in to both deployments, and follow the [optional full-loop workflow](JUDGE_GUIDE.md#optional-full-loop-reference).

## Restore the synthetic demo state

Each authenticated workspace has a two-step **Restore demo start** control. Reset is human-only, tenant-scoped, audited, and absent from WebMCP.

1. In Acme AP, review and confirm **Restore synthetic AP data**.
2. Confirm AP shows nine open POs, three historical exception invoices, and one reset event in its audit panel.

For the optional full-loop demonstration:

1. In OpenFinance AR, review and confirm **Restore synthetic AR data**.
2. Confirm AR shows 24 invoices; only `INV-10482`, `INV-10491`, and `INV-10507` are ready; `INV-10417` and `INV-10463` need attention; and no `ERP-*` invoices exist.
3. Confirm the AR audit panel contains one reset event, then verify the [full-loop starting state](JUDGE_GUIDE.md#starting-state).

The reviewed operator fallback scripts are `services/acme/supabase/demo/reset.sql` and `services/openfinance/supabase/demo/reset.sql`. Use them only in their named synthetic project after confirming no demo submission is active. Never run them against real data.
