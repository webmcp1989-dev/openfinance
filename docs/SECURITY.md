# Security model

## Trust boundaries

OpenFinance AR, Acme AP, the browser agent, and the human user are separate parties. Data received from any other party is untrusted until authenticated, authorized, validated, and checked against the receiving application's business rules.

## Authentication and session isolation

- OpenFinance and Acme use independent Supabase Auth projects and cookie-backed sessions.
- A session from one application has no meaning in the other application.
- Authenticated routes must not use shared public caching or ISR when session refresh can occur.
- Demo credentials contain synthetic data only and receive the least privileges needed for the workflow.

## Authorization and tenant isolation

- Every table exposed through Supabase has RLS enabled.
- Grants are revoked first and then restored at least privilege.
- Every policy and backend use case scopes reads and writes to the authenticated tenant or supplier.
- Negative tests prove that users cannot access another tenant's or supplier's rows by guessing identifiers.
- Service-role credentials remain server-side and are avoided when a user-scoped client is sufficient.
- Views, functions, and storage objects receive the same isolation review as tables.

## Business invariants

- Invoice submission is idempotent per supplier, destination, and invoice identity.
- PO balance validation happens on Acme's backend within the same transaction as submission.
- Duplicate invoice numbers are rejected within the appropriate supplier/customer scope.
- Submission results and OpenFinance status updates are auditable and immutable where appropriate.
- Optimistic UI never reports a successful financial action before backend confirmation.

## WebMCP safety

- Read-only tools use `readOnlyHint`.
- Tools returning externally sourced text use `untrustedContentHint` where appropriate.
- Tool descriptions state side effects accurately and concisely.
- Consequential tools return an exact preview or validation result before execution.
- ChatGPT's action-time confirmation is complemented by backend validation; it is not treated as authorization.
- WebMCP tool outputs never contain secrets, tokens, internal error details, or unrestricted data dumps.

## Secret handling

- Browser bundles receive only the relevant Supabase URL and publishable key.
- Service-role keys, signing secrets, database passwords, and deployment tokens are stored only in provider-managed server environments.
- `.env*` files are ignored except documented examples.
- Logs redact authorization headers, cookies, document contents, and sensitive financial fields unless explicitly required and protected.

## Security verification

Required tests include:

- anonymous denial;
- wrong-tenant and wrong-supplier denial;
- malformed and oversized inputs;
- duplicate and concurrent submission attempts;
- stale PO balance;
- unauthorized status mutation;
- prompt-injection-like text preserved as data rather than instructions;
- safe error responses without internal leakage.
