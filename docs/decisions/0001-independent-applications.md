# ADR 0001: Independent applications in one monorepo

- Status: Accepted
- Date: 2026-08-28

## Context

The challenge must prove that two business applications can interoperate through WebMCP without a private connector. The project also needs to remain practical to develop, review, deploy, and open-source during a short challenge.

## Decision

Maintain OpenFinance AR and Acme AP in one Bun workspace repository, but deploy them as two Vercel projects connected to two independent Supabase projects.

The applications may share repository-level development conventions but do not share domain models, API clients, persistence, authentication, business logic, or runtime environment variables.

## Consequences

- Reviewers can inspect the entire proof in one public repository.
- Each application can deploy and evolve independently.
- Authentication and tenant boundaries are credible and testable.
- The agent, rather than shared code or infrastructure, performs cross-application mapping.
- Some infrastructure and presentation code may be duplicated intentionally when sharing it would blur independence. Duplication should still be small and explicit.
