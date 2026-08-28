# OpenFinance project guidance

## Product north star

Build **OpenFinance**, an agent-native interoperability experience for B2B finance.

The challenge proof is one complete workflow: two independently authenticated business applications complete an invoice-delivery transaction through WebMCP without a point-to-point API integration or shared credentials.

```text
OpenFinance AR <-> WebMCP <-> ChatGPT browser agent + human <-> WebMCP <-> Customer AP portal
```

The ChatGPT browser agent is the bridge. Do not introduce a hidden orchestration service that directly connects the two applications.

## Human-agent experience

Every meaningful feature must clarify the division of work:

- The human provides intent, business judgment, and approval for consequential actions.
- The agent discovers capabilities, gathers data, reconciles the two systems, explains exceptions, and executes approved actions.
- Both work from the same live application state. Tool calls must visibly update the relevant UI and leave a clear audit trail.
- The agent must preview the exact invoices, amounts, purchase orders, and destination before submission.
- Invoice submission and cross-site data transfer require explicit, informed human confirmation.
- Failures must be understandable and actionable, not generic errors.

The app should feel meaningfully better with an agent, while remaining understandable and useful to a human on its own.

## Challenge rubric

Evaluate every scope decision against all four official criteria:

1. **WebMCP leverage**: non-trivial, skillful use of discoverable structured tools across both applications.
2. **Execution**: a polished, coherent, runnable product experience rather than a protocol demo.
3. **Potential impact**: a credible solution to a specific problem faced by supplier AR teams.
4. **Creativity and ambition**: demonstrate browser-mediated interoperability between independent B2B applications.

If a feature does not strengthen at least one criterion without weakening execution, defer it.

## Required challenge architecture

- Seller-side OpenFinance AR application and customer-side AP portal must be genuinely independent.
- Use separate authentication sessions, authorization boundaries, application state, and persistence.
- Do not use a shared database or private server-to-server integration to move workflow data between them.
- Use synthetic companies, users, invoices, purchase orders, and documents.
- WebMCP is the only interoperability surface available to the browser agent.
- Keep the challenge implementation focused on the native WebMCP path. APIs, learned browser skills, and legacy-portal automation belong to the future commercial story, not the core demo.

## WebMCP tool design

- Prefer the imperative API for application operations and stateful workflows.
- Give each tool one clear, non-overlapping purpose.
- Use precise verb-based names and concise positive descriptions.
- Keep names, parameter descriptions, and outputs compact.
- Use explicit JSON Schema types, enums, required fields, and human-readable identifiers.
- Validate authentication, authorization, tenant/supplier scope, business rules, and input on the server. Never rely on the model for enforcement.
- Mark read-only tools with `readOnlyHint`.
- Mark externally sourced or user-authored results with `untrustedContentHint` when applicable.
- Return structured, verifiable results with stable identifiers and useful recovery guidance.
- Update visible application state after successful writes.
- Register tools only when their page and session context make them valid; avoid redundant or overlapping tools.
- Design idempotent write operations where practical, especially invoice submission and status recording.

## Core demo contract

The primary prompt is: **"Submit all Acme invoices that are ready for their AP portal."**

The end-to-end result must demonstrate:

1. Reading portal-ready invoices from OpenFinance.
2. Excluding an invoice that is not ready, such as one missing a PO.
3. Discovering the AP portal's independent requirements and purchase-order data.
4. Detecting a deliberate exception, such as an invoice exceeding the remaining PO balance.
5. Presenting the valid batch and exceptions clearly to the human.
6. Obtaining confirmation immediately before submission.
7. Submitting only the approved valid invoices.
8. Receiving AP references and statuses.
9. Writing the results and exceptions back to OpenFinance.
10. Showing the updated state and audit trail in both applications.

## Messaging rules

Lead with the outcome, not the technology:

> OpenFinance lets independently authenticated AR and AP applications complete financial workflows through WebMCP, without custom point-to-point integrations or shared credentials.

Avoid reducing the product to "AI uploads invoices." The value is cross-application interoperability, exception handling, human control, and buyer-side payment intelligence.

Be precise: the challenge demonstrates the WebMCP-native future. The commercial OpenFinance Network would later add API and learned-browser compatibility for legacy portals.

## Delivery requirements

- Working public deployment accessible in ChatGPT's in-app browser.
- Public repository containing all required source, assets, setup instructions, and a visible open-source license.
- Clear README that explains why WebMCP is necessary and how to reproduce the demo.
- Public demo video under three minutes with audio.
- Submission copy must explicitly explain the WebMCP fit, improved user experience, new human-agent capability, and implementation.
- Test the exact natural-language demo flow repeatedly in the ChatGPT in-app browser; do not rely only on direct tool unit tests.

See `docs/NORTH_STAR.md` for the research-backed rationale and detailed decision rubric.

## Permanent engineering rules

These rules apply to every implementation decision in this repository:

- Prioritize correctness, security, reliability, and tenant isolation above optimization, convenience, token reduction, or implementation speed.
- Keep business rules, authorization, validation, synchronization, integrations, and authoritative data processing on the backend.
- Treat the frontend as presentation and user interaction. Client-side checks improve UX but never establish authorization or business correctness.
- Prefer clean, lean, explicit code. Avoid unnecessary abstractions, infrastructure, dependencies, indirection, and duplication.
- Simplicity must not weaken correctness, security, reliability, isolation, extensibility, or provider-agnostic boundaries.
- Separate UI, service/API, application/business logic, integration adapters, and data access. Dependencies must point inward toward domain logic.
- Do not leak Supabase-, Vercel-, browser-, framework-, or runtime-specific concerns into domain modules.
- Do not hard-code tenants, customers, providers, workflows, or features in reusable business logic. Synthetic challenge data belongs in seeds and fixtures.
- Enforce authentication and tenant/supplier authorization for every backend operation, including read-only queries.
- Default to deny. Use least privilege, explicit data ownership, Row Level Security, safe error handling, and auditable mutations.
- Validate all untrusted inputs at process boundaries. Use shared machine-readable schemas only within a bounded application; do not create hidden coupling between the independent AR and AP applications.
- Design consequential and retryable operations for idempotency and concurrency safety.
- Use database constraints and transactions to preserve invariants; do not depend on UI sequencing or agent behavior.
- Avoid N+1 queries, unnecessary network round trips, excessive client bundles, and repeated processing, but never trade correctness or clarity for micro-optimization.
- Add proportionate unit, integration, contract, authorization, and end-to-end tests. Security and tenant-isolation behavior require explicit negative tests.
- Keep secrets server-side. Never expose Supabase service-role keys or equivalent privileged credentials to browser bundles.
- Maintain accessible, semantic, responsive interfaces with clear loading, empty, success, partial-success, and error states.

## Documentation is part of the implementation

Every affected change must update the relevant documentation in the same change:

- OpenAPI specification and request/response examples.
- Human-readable architecture, setup, operations, and security guides.
- WebMCP tool inventory, schemas, behavior, annotations, and examples.
- Agent instructions in this file and related scoped `AGENTS.md` files.
- Database schema, migrations, RLS policies, data ownership, and seed documentation.
- Architecture decision records when boundaries or major technology choices change.
- Deployment and environment-variable documentation.

Code and documentation that disagree is an incomplete change.
