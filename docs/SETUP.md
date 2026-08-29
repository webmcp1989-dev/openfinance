# Setup and deployment

The two applications must remain independently configured. Never reuse a Supabase project, publishable key, database password, or authenticated browser session between them.

## Prerequisites

- Bun 1.3.14 or newer
- Two Supabase projects
- Two Vercel projects connected to this repository
- A current ChatGPT desktop app with site tools enabled and GPT-5.6 Sol or Terra selected

## Database setup

Run each migration only in its named project:

| Application | Supabase project ref | Migration |
| --- | --- | --- |
| OpenFinance AR | `bhjtwmpwlmdqjxlvgrhj` | `services/openfinance/supabase/migrations/202608290001_initial.sql`<br>`services/openfinance/supabase/migrations/202608290002_reject_duplicate_delivery_items.sql` |
| Acme AP | `lakrgujjrhydjsoyaiin` | `services/acme/supabase/migrations/202608290001_initial.sql` |

Apply every listed migration in filename order through the Supabase SQL editor or a reviewed migration pipeline. The migrations are transactional, enables RLS on every exposed table, revokes anonymous access, grants only required reads, and exposes authenticated write wrappers around private transaction functions.

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

Then sign into both live applications in separate tabs, inspect Available site tools, and run the [demo checklist](DEMO.md).
