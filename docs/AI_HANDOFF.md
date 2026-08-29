# AI handoff

This file records only non-obvious continuation context. Repository-wide rules are in [`AGENTS.md`](../AGENTS.md); setup and exact database order are in [`SETUP.md`](SETUP.md).

## Current source of truth

- GitHub: `https://github.com/webmcp1989-dev/openfinance` (`main`).
- AR: `https://openfinance-ar.vercel.app`; AP: `https://openfinance-ap.vercel.app`.
- The apps use separate Vercel projects, Supabase projects, authentication sessions, databases, and migration histories. WebMCP through the human-directed browser is the only cross-application runtime bridge.
- The fixed challenge surface is four AR tools and five AP tools. Every capability also has a human UI path through the same authenticated backend contract.

## Meaningful implementation decisions

- AR **Sync invoices now** is intentionally a human-only ERP simulation, not a tenth WebMCP tool. This preserves the recorded challenge/demo contract while making the standalone AR workspace useful.
- Migration `services/openfinance/supabase/migrations/202608290006_simulate_erp_invoice_sync.sql` owns the alternating `2 -> 0 -> 2 -> 0` behavior. It derives tenant/operator identity from the session, uses the tenant's configured synthetic customer, serializes retries, row-locks sync state, inserts valid synthetic invoice documents, and records idempotent results plus an audit event atomically.
- `services/openfinance/supabase/demo/reset.sql` removes synthetic `ERP-*` imports and resets the next sync to two invoices.
- AP's human workspace exposes requirements, PO/status lookup, PDF validation, explicit batch review, and confirmed atomic submission. AR exposes scoped queue filtering, package review, result/exception recording, and ERP sync.
- Human UI controls are convenience and presentation only. The same route, service, RLS, public wrapper, and private transaction boundaries remain authoritative.
- Both Next.js configs set `agentRules: false` so `next dev` does not generate duplicate app-level `AGENTS.md`/`CLAUDE.md` files; the reviewed root `AGENTS.md` remains authoritative.

## Migration and environment status

- AR migration `202608290006_simulate_erp_invoice_sync.sql` was applied to the live AR project and its 17-assertion rollback-only suite passed. Any new environment must apply it before deploying code that calls `/api/agent/erp-sync`.
- No dependency or environment-variable change was introduced. Each app still requires only its own `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Never store demo/judge passwords, database credentials, Vercel tokens, or Supabase service-role keys in Git.

## Verified limitations and follow-up

- ERP sync is deterministic synthetic challenge behavior, not a real ERP connector or scheduler. Commercial connectors and learned-browser compatibility remain future product work.
- Database suites currently run manually in each Supabase SQL editor inside rollback transactions; ephemeral database CI is future hardening.
- After any stateful live test, run both documented reset scripts and confirm the public judge state before recording or submitting the demo.
- Challenge publication still requires entrant-controlled Devpost declarations, private judge credential entry, and public video publication; these values must remain outside the repository.
