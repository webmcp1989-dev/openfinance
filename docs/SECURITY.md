# Security

## Trust and identity

- AR and AP are mutually untrusted applications with separate origins, Supabase projects, users, cookies, credentials, and databases.
- Protected pages and routes validate Supabase claims. Tenant, supplier, buyer, organization, and role values are derived from the authenticated profile, never caller input.
- Public signup is disabled. Demo users are administratively provisioned and passwords remain outside Git.
- Every exposed table has RLS enabled, anonymous access revoked, and minimum authenticated grants.
- Runtime code receives only the Supabase URL and publishable key. Service-role keys and database passwords are prohibited.
- Cross-tenant SQL tests create foreign fixtures and prove they cannot be read or mutated.
- The optional AR OAuth MCP accepts only signature-, issuer-, expiry-, audience-, client-, user-, role-, and RLS-validated tokens. It uses an unprivileged bearer client and cannot access AP.

## Backend enforcement

- Mutating routes require exact same-origin JSON, authenticate before body parsing, validate with Zod, and return stable errors without raw database details.
- Public mutation wrappers derive tenant scope and canonical request identity in PostgreSQL. Tenant-scoped locks make identical retries replay safely and reject changed payloads.
- Privileged implementations live in the unexposed `private` schema, set `search_path = ''`, schema-qualify relations, and expose minimum public wrappers.
- AP submission locks POs and rechecks ownership, open state, currency, balance, uniqueness, document integrity, and batch limits before one atomic commit.
- Exception response, replacement, inquiry, result recording, ERP sync, and remittance writeback enforce legal state transitions and idempotency in the database.
- Buyer-owned exceptions cannot be resolved as supplier work. They remain blocked and may only receive a tracked inquiry.
- Reset is human-only, limited to fixed synthetic tenants, independently authorized in each app, transactional, audited, and absent from WebMCP.

## Document consent and integrity

`submit_invoice_batch`, `respond_to_invoice_exception`, and `replace_rejected_invoice` require a five-minute, single-use AP approval bound to the exact user, tenant, action, idempotency key, fields, filenames, and SHA-256 values. The database recreates and compares the manifest from the final payload, then consumes approval in the same transaction as the write. Denial, expiry, cancellation, mismatch, or reuse with different content fails closed. Approval records contain no PDF bytes.

Invoice and evidence PDFs are limited to 1 MB decoded, canonical base64, and a bounded classic structure containing a catalog, page, terminal `startxref` pointing to `xref`, and EOF. AR validates before release; AP validates independently before persistence. AP also verifies declared media type, size, SHA-256, identifiers, dates, money, and the three-item batch limit.

No backend URL fetch is accepted. Authenticated PDF downloads rely on RLS, revalidate stored bytes, use generic inaccessible-record errors, and return private no-store responses.

## Browser and human control

- WebMCP tools exist only for the authenticated page lifetime and abort on navigation or sign-out.
- Business-data outputs are marked untrusted and all requests support cancellation.
- The agent must show destination, invoice numbers, POs, and amounts before cross-company transfer.
- AP separately blocks each document write on its own exact approval panel.
- Successful UI notices are presentation only; all displayed state is refreshed from the backend.
- Security headers restrict script sources, framing, MIME sniffing, referrer data, cross-origin resources, and unused browser capabilities.
- All tool capabilities remain available through human UI controls backed by the same services.

The authority claim is enforced by architecture: **19 browser tools and zero cross-writes**. AR mutations terminate in AR, AP mutations terminate in AP, and only the human authorizes data crossing the two sessions.
