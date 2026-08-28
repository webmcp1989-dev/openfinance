# Security model

## Trust boundaries

- The OpenFinance and Acme origins, Supabase projects, users, and cookies are mutually untrusted.
- WebMCP definitions, inputs, and outputs are untrusted data.
- The browser agent may prepare data but does not gain permissions beyond the human's current site session.
- Only each application's backend and database are authoritative for its business rules.

## Authentication and authorization

- Supabase SSR stores sessions in project-specific cookies and refreshes them through Next.js `proxy.ts`.
- Protected pages and routes use `auth.getClaims()`, not an unverified cookie session object.
- Every exposed table has RLS enabled and anonymous grants revoked.
- Authenticated grants are read-only; writes are available only through explicitly granted RPC wrappers.
- Tenant identity is derived from `auth.uid()` through a profile row. Caller-supplied organization, buyer, or supplier IDs are never trusted.
- The runtime has only the publishable key. Service-role keys and database passwords are prohibited.

## Consequential writes

- AP submission is one atomic Postgres transaction and locks PO rows before checking and decrementing balances.
- Idempotency is scoped by supplier and bound to a SHA-256 fingerprint. A repeated identical request returns its original response; a key reused for a different payload fails.
- AR result and exception recording uses the same fingerprint-bound idempotency behavior.
- Public RPC functions are security invokers. Privileged implementation functions live in the unexposed `private` schema, set an empty search path, schema-qualify every relation, and receive minimal execution grants.

## Request and document safety

- Mutating routes require `application/json` and an exact same-origin `Origin` header.
- Zod and Postgres constraints independently enforce shape, length, enum, money, identifier, and batch limits.
- Invoice PDFs are limited to 1 MB decoded and about 1.4 MB encoded, must begin with `%PDF-`, and must match their declared SHA-256.
- No backend URL fetch is accepted, eliminating this workflow's SSRF surface.
- APIs return stable public error codes and do not expose raw database errors.

## Human control

Read tools are accurately annotated. The AP submission description marks it as a consequential write and requires the caller to present exact invoices, amounts, total, and exceptions before seeking explicit confirmation. The UI remains fully usable and shows receipts and balance changes for verification.

## Known production hardening beyond the contest slice

- Add distributed rate limiting and abuse telemetry at the edge.
- Use malware scanning and durable object storage for real invoice files.
- Require MFA and step-up approval for configurable high-value thresholds.
- Export immutable audits to a separate retention boundary.
- Add automated Supabase database tests to CI against ephemeral branches.
