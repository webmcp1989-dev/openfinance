# Security model

## Trust boundaries

- The OpenFinance and Acme origins, Supabase projects, users, and cookies are mutually untrusted.
- WebMCP definitions, inputs, and outputs are untrusted data.
- The browser agent may prepare data but does not gain permissions beyond the human's current site session.
- Only each application's backend and database are authoritative for its business rules.

## Authentication and authorization

- Supabase SSR stores sessions in project-specific cookies and refreshes them through Next.js `proxy.ts`.
- Protected pages and routes use `auth.getClaims()`, not an unverified cookie session object.
- Mutating routes reject wrong-origin or wrong-content-type requests, then authenticate the caller before parsing the untrusted request body.
- Every exposed table has RLS enabled and anonymous grants revoked.
- Authenticated grants are read-only; writes are available only through explicitly granted RPC wrappers.
- Tenant identity is derived from `auth.uid()` through a profile row. Caller-supplied organization, buyer, or supplier IDs are never trusted.
- Rollback-only pgTAP suites create foreign organization and supplier fixtures, then prove authenticated demo users cannot read or mutate those records.
- The runtime has only the publishable key. Service-role keys and database passwords are prohibited.

## Consequential writes

- AP submission is one atomic Postgres transaction and locks PO rows before checking and decrementing balances.
- Idempotency is scoped by tenant or supplier and bound to a SHA-256 fingerprint. Transaction-scoped advisory locks serialize concurrent retries for the same scoped key; a repeated identical request reaches the transaction and returns its original response without a duplicate preflight blocking it, while a key reused for a different payload fails.
- AR result and exception recording enforces exact payload fields, legal portal statuses, field bounds, purchase-order presence, and allowed invoice state transitions inside Postgres—not only in the HTTP layer.
- Public RPC functions are security invokers. Privileged implementation functions live in the unexposed `private` schema, set an empty search path, schema-qualify every relation, and receive minimal execution grants.

## Request and document safety

- Mutating routes require `application/json` and an exact same-origin `Origin` header.
- Zod and Postgres constraints independently enforce shape, length, enum, money, identifier, and batch limits.
- Money integers are capped at `9007199254740991` in WebMCP, HTTP, and Postgres contracts so JSON/JavaScript transport cannot silently lose precision.
- Invoice PDFs are limited to 1 MB decoded and about 1.4 MB encoded, must begin with `%PDF-`, and must match their declared SHA-256.
- Cross-site package reads and AP submission requests are limited to three invoices, keeping their worst-case JSON payload below the deployment platform's 4.5 MB function request/response boundary.
- No backend URL fetch is accepted, eliminating this workflow's SSRF surface.
- APIs return stable public error codes and do not expose raw database errors.
- Production responses set a restrictive CSP, deny framing and MIME sniffing, disable unused browser capabilities, isolate cross-origin resources, and suppress referrer data.
- Login failures do not reveal whether an email exists. A separately authenticated account whose tenant profile is missing receives an actionable workspace-assignment message instead of a misleading credential error.

## Human control

Read tools are accurately annotated. Before an invoice PDF crosses from OpenFinance to Acme for read-only validation, the caller must show the destination and exact candidate invoices, POs, and amounts and obtain informed transfer approval. The AP submission description marks it as a consequential write and requires a separate preview of the exact valid invoices, amounts, total, and exceptions immediately before submission confirmation. The UI remains fully usable and shows receipts, balance changes, and recent tenant-scoped database audit events for verification. WebMCP reads containing invoice, document, purchase-order, validation, or receipt data set `untrustedContentHint`, and tool requests honor browser cancellation. AP document validation rejects non-canonical base64 encodings before checking the PDF signature, byte limit, and SHA-256 so the same bytes cannot have multiple accepted wire representations.

## Known production hardening beyond the contest slice

- Add distributed rate limiting and abuse telemetry at the edge.
- Use malware scanning and durable object storage for real invoice files.
- Require MFA and step-up approval for configurable high-value thresholds.
- Export immutable audits to a separate retention boundary.
- Add automated Supabase database tests to CI against ephemeral branches.
