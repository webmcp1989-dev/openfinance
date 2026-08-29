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

## AR remote MCP access surface

An AR team's own external agent may connect to `OpenFinance AR /mcp` through Streamable HTTP. The resource server publishes RFC 9728 metadata and delegates OAuth 2.1 authorization to the AR project's Supabase Auth server. Supabase supplies authorization code + PKCE, dynamic client registration, consent, refresh, and revocation. OpenFinance validates the ES256 signature, exact issuer, exact MCP resource audience, expiry, OAuth `client_id`, active Auth user, AR profile, tenant, and role before creating any tool server.

Each tool uses an unprivileged Supabase client carrying the OAuth bearer token. Existing RLS and RPC role checks therefore remain authoritative. The remote MCP never uses a service-role key and cannot access Acme AP. It is an additional own-system interface, not the cross-application bridge demonstrated by the challenge.

## Layers inside each app

1. UI renders human-readable state and registers tools only on an authenticated top-level page.
2. Site tools use narrow JSON Schemas and same-origin `fetch` with the site's existing cookie session.
3. Next.js route handlers enforce content type, same-origin writes, verified Supabase claims, Zod validation, and stable error contracts.
4. Services implement use cases and map database records into provider-agnostic domain objects.
5. Supabase Data API calls run as the authenticated user; Postgres grants and RLS enforce tenant scope independently of application code.
6. Private Postgres functions perform consequential multi-row changes atomically and idempotently.

Both public mutation wrappers serialize tenant-scoped idempotency keys and derive authoritative request identity inside PostgreSQL. The compatibility fingerprint argument is format-checked but not trusted; exact stored content determines whether a retry is identical.

The browser never receives a service-role key. The frontend is not an authorization or business-rule boundary.
Shared hashing and typed-error primitives live in framework-free `http-core` modules, so domain services and their tests do not initialize Next.js or Supabase infrastructure.

Every one of the nine WebMCP operations also has a first-class human UI path. Those controls call the same same-origin routes and services as the tools; the UI adds guidance and informed confirmation but never replaces backend authorization or validation.

## AR ERP sync simulation

The AR workspace includes **Sync invoices now**, which models an inbound ERP connector without expanding the fixed nine-tool WebMCP challenge contract. It is available through the human UI and the separately authenticated AR remote MCP. Its same-origin UI route and MCP tool both reach the same authoritative service/RPC. PostgreSQL derives the signed-in organization and operator, locks the tenant state, and alternates imported results `2 -> 0 -> 2 -> 0`.

Repeatable judging uses separate two-step human resets in AR and AP. These are not WebMCP tools and are not a cross-application integration: each app requires a same-origin confirmation, authorizes the fixed synthetic operator or submitter in its own database, restores only its own fixture rows in one serialized transaction, and writes one reset audit event. A reviewer must restore both applications independently.

Imported invoices use the organization's configured synthetic customer, valid synthetic PDF records, unique ERP invoice numbers, and auditable idempotent events. The operation never reads or writes the independent AP database and is not a hidden cross-site integration.

Synthetic AR documents are complete one-page PDF 1.4 invoices with supplier/customer identities, invoice and deterministic Net-30 due dates, PO, line item, currency, subtotal, tax, amount due, remittance details, and an explicit synthetic-data footer. They also contain a catalog, page tree, content stream, font resources, cross-reference table, trailer, and byte-accurate `startxref`. A private database renderer derives the financial fields from the authoritative invoice row, repairs fixtures during migration, and a private insert trigger handles future ERP imports before storage. This keeps documents reproducible without a runtime PDF dependency.

## AP submission transaction

`submit_invoice_batch` is a public security-invoker wrapper around a private security-definer function with `search_path = ''`. Execution is revoked from `public` and `anon` and granted only to `authenticated`.

Within one database transaction it:

1. verifies the caller has a submitter role and derives its supplier and buyer IDs;
2. resolves or creates the supplier-scoped idempotency record;
3. locks every referenced PO row;
4. revalidates ownership, open status, currency, remaining balance, uniqueness, canonical encoding, PDF signature and tail marker, size, and SHA-256;
5. inserts receipt records and decrements balances;
6. writes one audit event and stores the immutable response;
7. commits all invoices or none.

Application preflight improves the human-agent experience but the transaction is authoritative, preventing time-of-check/time-of-use errors. The submission endpoint therefore calls the transaction directly instead of repeating the read-only preflight first: an identical retry reaches the stored idempotent response, while the transaction still revalidates every invariant before a first commit.

## AP payment signal simulation

After each committed submission, a private trigger assigns a serialized per-supplier sequence. Every second invoice receives one immutable synthetic payment schedule for 10 seconds later and a scheduling audit event in the same transaction. A public security-invoker wrapper delegates to a private function that derives supplier scope from the authenticated profile, computes the effective `paid` status from database time, and exposes the payment reference only after maturity. The settlement and sequence tables have no direct application read or write grants.

The browser schedules a single refresh for the next known settlement time, avoiding polling. Status reads never mutate data, and idempotent submission retries cannot create another schedule. This is an explicit buyer-side challenge simulation inside Acme AP, not a payment processor or a hidden integration with OpenFinance AR.

## Data transfer

The OpenFinance package tool returns a small challenge PDF as base64 plus its media type, filename, and SHA-256. After the human approves the exact invoices and Acme destination for read-only validation, the browser agent passes only those explicit packages to Acme. Acme independently decodes, bounds, checks the PDF signature and final 1,024-byte window for `%%EOF`, and verifies the hash. A separate human confirmation is still required immediately before AP submission. Production evolution can replace inline content with a governed attachment handoff without changing invoice or validation contracts.

The same AR document is available to an authenticated human through a no-store download route. That route revalidates the stored document and relies on AR RLS before returning it; manual upload in Acme uses the same AP validation and confirmed-submission backend as agent-assisted transfer.

## Performance choices

- Server Components load identity and workspace data concurrently.
- Workspace refreshes use one same-origin endpoint after writes.
- A transient recent-audit read failure degrades only that panel: each workspace returns `auditAvailable: false`, renders an actionable retry message, and continues to show authoritative invoice, PO, and receipt state.
- Query indexes match tenant, status, PO, uniqueness, and recent-audit access paths.
- Validation queries PO and duplicate state concurrently.
- No caching is allowed for authenticated financial state.

These are bounded optimizations; correctness and isolation remain the primary constraints.
