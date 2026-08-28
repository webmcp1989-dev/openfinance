# System architecture

## Context

OpenFinance contains two independent applications:

- **OpenFinance AR**, used by a supplier's accounts-receivable team.
- **Acme AP**, used by that supplier inside a customer's supplier portal.

The applications have separate origins, authentication sessions, authorization models, persistence, APIs, deployments, and WebMCP tools. They do not call one another.

## Deployment topology

```text
Vercel project: openfinance-ar
  -> apps/openfinance-ar
  -> OpenFinance Supabase project only

Vercel project: openfinance-acme-ap
  -> apps/acme-ap
  -> Acme Supabase project only

ChatGPT in-app browser
  -> observes and invokes WebMCP tools from each open, authenticated origin
  -> carries user-approved workflow data between tool calls
```

Two Vercel projects may reference the same Git repository while using different root directories and isolated environment variables. Each frontend receives only its own Supabase URL and publishable key.

## Application layering

Each bounded application follows the same dependency direction without sharing domain code:

```text
UI and WebMCP registration
  -> typed API client
    -> Supabase Edge Function HTTP boundary
      -> application service / use case
        -> domain rules
          -> repository interface
            -> Supabase/Postgres adapter
```

Business rules and authorization are enforced in Edge Functions and Postgres. Browser code may repeat validation for usability but is not authoritative.

## Data movement

There is no server-to-server data movement between the two applications. A typical workflow is:

1. The browser agent invokes a OpenFinance read tool.
2. OpenFinance authorizes the current user and returns a bounded invoice submission package.
3. The agent invokes Acme validation tools using the relevant user-approved data.
4. Acme authorizes the independently signed-in supplier and evaluates its own rules.
5. After human confirmation, the agent invokes Acme's idempotent submission tool.
6. The agent invokes OpenFinance's recording tool with Acme's returned reference and status.

## Provider boundaries

Supabase-specific code is confined to authentication adapters, repository implementations, Edge Function bootstrapping, migrations, and deployment configuration. Domain rules do not import Supabase clients or depend on Postgres-specific types.

Vercel-specific configuration is confined to deployment files and environment configuration. Application code must run in a standard Next.js production environment.

## Performance approach

- Server-render authenticated application shells where safe and useful.
- Keep authenticated responses private and non-cacheable when session refresh is possible.
- Select only required database columns.
- Batch invoice reads and writes rather than issuing per-row network calls.
- Use indexes that correspond to tenant, supplier, status, PO, and idempotency access paths.
- Keep WebMCP outputs concise and task-specific.
- Measure before introducing caches or additional infrastructure.
