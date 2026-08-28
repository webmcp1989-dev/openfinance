# Architecture

## System boundary

OpenFinance AR and Acme AP are separate applications deployed on different origins and backed by different Supabase projects. Their only runtime bridge is the human-directed browser agent.

```text
┌────────────────────────────┐                 ┌────────────────────────────┐
│ OpenFinance AR             │                 │ Acme Supplier Portal       │
│ openfinance-ar.vercel.app  │                 │ openfinance-ap.vercel.app  │
│                            │                 │                            │
│ Next.js UI + BFF routes    │                 │ Next.js UI + BFF routes    │
│ imperative WebMCP tools    │                 │ imperative WebMCP tools    │
│ own Supabase Auth + DB     │                 │ own Supabase Auth + DB     │
└─────────────┬──────────────┘                 └─────────────┬──────────────┘
              │ signed-in page tool                            │ signed-in page tool
              └────────────── ChatGPT + human ─────────────────┘
```

There is no shared database, session cookie, service credential, server-to-server API, queue, webhook, or hidden synchronization path.

## Layers inside each app

1. UI renders human-readable state and registers tools only on an authenticated top-level page.
2. Site tools use narrow JSON Schemas and same-origin `fetch` with the site's existing cookie session.
3. Next.js route handlers enforce content type, same-origin writes, verified Supabase claims, Zod validation, and stable error contracts.
4. Services implement use cases and map database records into provider-agnostic domain objects.
5. Supabase Data API calls run as the authenticated user; Postgres grants and RLS enforce tenant scope independently of application code.
6. Private Postgres functions perform consequential multi-row changes atomically and idempotently.

The browser never receives a service-role key. The frontend is not an authorization or business-rule boundary.

## AP submission transaction

`submit_invoice_batch` is a public security-invoker wrapper around a private security-definer function with `search_path = ''`. Execution is revoked from `public` and `anon` and granted only to `authenticated`.

Within one database transaction it:

1. verifies the caller has a submitter role and derives its supplier and buyer IDs;
2. resolves or creates the supplier-scoped idempotency record;
3. locks every referenced PO row;
4. revalidates ownership, open status, currency, remaining balance, uniqueness, PDF signature, size, and SHA-256;
5. inserts receipt records and decrements balances;
6. writes one audit event and stores the immutable response;
7. commits all invoices or none.

Application preflight improves the human-agent experience but the transaction is authoritative, preventing time-of-check/time-of-use errors.

## Data transfer

The OpenFinance package tool returns a small challenge PDF as base64 plus its media type, filename, and SHA-256. The browser agent passes that explicit package to Acme. Acme independently decodes, bounds, identifies, and hashes it. Production evolution can replace inline content with a governed attachment handoff without changing invoice or validation contracts.

## Performance choices

- Server Components load identity and workspace data concurrently.
- Workspace refreshes use one same-origin endpoint after writes.
- Query indexes match tenant, status, PO, uniqueness, and recent-audit access paths.
- Validation queries PO and duplicate state concurrently.
- No caching is allowed for authenticated financial state.

These are bounded optimizations; correctness and isolation remain the primary constraints.
