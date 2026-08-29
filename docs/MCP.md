# OpenFinance AR remote MCP

OpenFinance AR exposes a production Streamable HTTP MCP resource at:

```text
https://openfinance-ar.vercel.app/mcp
```

It lets an AR team's OpenAI or Claude agent operate its own OpenFinance workspace. It is not a direct AR-to-AP integration: customer AP discovery, validation, transfer, and submission remain browser-mediated WebMCP actions under separate human approval.

## OAuth 2.1 flow

The MCP resource publishes RFC 9728 metadata at `/.well-known/oauth-protected-resource/mcp` and the compatibility root location. The advertised authorization server is the AR Supabase Auth issuer at `https://<project>.supabase.co/auth/v1`.

Supabase OAuth must have:

- OAuth server enabled;
- authorization path `/oauth/consent`;
- dynamic client registration enabled for OpenAI and Claude connectors;
- the production AR URL configured as the Auth site URL and allowed redirect origin.

Clients use authorization code + PKCE (`S256`) and send the exact MCP URL as the OAuth resource indicator. OpenFinance accepts only a resource-bound ES256 access token with the exact issuer, audience `https://openfinance-ar.vercel.app/mcp`, expiry, OAuth client ID, authenticated role, active user, and RLS-visible AR membership. Identity scopes are standard Supabase scopes; data authorization comes from the user's AR profile, role, RLS policies, and transaction functions.

Supabase's OAuth server currently leaves the access-token audience at its default even when the client sends `resource`. The AR project's reviewed Custom Access Token hook binds `aud` to the exact MCP URL whenever an OAuth `client_id` is present and leaves normal portal sessions unchanged. The hook must be enabled in **Authentication → Auth Hooks → Customize Access Token**. This preserves strict MCP audience validation without creating a second authorization server.

The consent screen explains the actual capabilities and acting role. Users can inspect and revoke grants at `/connections`; revocation invalidates the grant's refresh tokens, while already signed short-lived access tokens expire normally. OpenAI and Claude should retain approvals for consequential write tools.

## Tool inventory

| Tool | Kind | Purpose |
| --- | --- | --- |
| `get_ar_workspace` | read | Confirm the authenticated organization and role. |
| `list_customers` | read | List tenant customers and configured portal origins. |
| `list_invoices` | read | Filter live tenant invoice state. |
| `get_submission_package` | sensitive read | Return exact ready invoice data and verified PDF payloads. Separate approval is required before cross-site transfer. |
| `list_portal_followups` | read | Find blocked, rejected, overdue, status-stale, and partially paid invoices. |
| `get_invoice_supporting_documents` | sensitive read | Return verified evidence PDFs for one invoice. Separate approval is required before cross-site transfer. |
| `list_audit_events` | read | Read tenant audit activity, including OAuth client attribution. |
| `sync_invoices_from_erp` | idempotent write | Run the authorized simulated ERP sync. |
| `record_portal_result` | idempotent write | Record only portal results that were actually returned. |
| `record_portal_exception` | idempotent write | Record exact portal validation exceptions. |
| `record_payment_remittance` | idempotent write | Reconcile a verified full or partial AP payment allocation into AR. |

Demo reset is intentionally excluded and OAuth clients are denied at the database boundary. The server never exposes Supabase credentials, another tenant, or Acme AP.

## Client setup

Add the MCP URL as a remote or custom MCP connector in ChatGPT, the OpenAI API, Claude, or another OAuth-capable MCP client. Standards-compliant clients discover metadata, dynamically register, open the OpenFinance consent screen, and store the resulting grant. For an OpenAI Responses API request, configure an MCP tool with `server_url` equal to the URL above; if the host does not perform interactive OAuth discovery, provide a user-authorized Bearer token through its authorization field. Never use a portal cookie, publishable key, service-role key, or password as MCP authorization.

After connecting, call `get_ar_workspace` first. Keep approvals enabled for the four write tools and for any action that transfers package data outside OpenFinance.

## Local development

Set the app's own Supabase variables plus:

```dotenv
OPENFINANCE_MCP_URL=http://localhost:3000/mcp
```

Production requires canonical HTTPS. Start AR with `bun run dev:openfinance`, then verify protected-resource metadata, unauthenticated `401` plus `WWW-Authenticate`, OAuth PKCE and DCR, exact token audience, `tools/list`, role and tenant negative cases, revocation, and audit attribution. The endpoint is JSON POST only, 128 KiB bounded, and validates Host and Origin.
