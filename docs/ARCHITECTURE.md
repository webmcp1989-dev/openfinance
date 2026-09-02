# Architecture

## Submitted AP product boundary

```text
browser agent + informed human  <-------- WebMCP -------->  Acme AP
                                                        Next.js + 12 tools
                                                        Supabase Auth + Postgres
```

Acme AP is the submitted product. Its 12 browser tools, UI, backend, Supabase project, supplier identities, and ledger form one independently governed application boundary.

## Independent AR reference boundary

```text
browser agent + informed human  <-------- WebMCP -------->  OpenFinance AR
                                                        Next.js + 7 tools
                                                        Supabase Auth + Postgres
```

OpenFinance AR is a separate synthetic supplier reference system used by the demonstration. It is not an AP module, dependency, service, or part of the AP tool inventory. The applications use separate origins, deployments, Supabase projects, users, sessions, credentials, schemas, and ledgers. There is no shared database, server-to-server API, queue, webhook, or hidden synchronization path. Matching synthetic identifiers are independently seeded demo fixtures.

The optional AR own-system OAuth MCP endpoint uses the AR user's bearer token and existing RLS. It cannot access Acme and is not the cross-company bridge.

## Application layers

1. React UI renders state, collects intent and approval, and registers authenticated page-scoped tools.
2. Site tools call narrow same-origin Next.js routes with the existing session.
3. Routes enforce method, content type, origin, authentication, and Zod input contracts.
4. Services implement use cases and map provider records into domain objects.
5. Supabase queries execute as the authenticated user; grants and RLS enforce tenant scope.
6. Private Postgres functions perform consequential changes atomically and idempotently.

The frontend is never authoritative. Within Acme AP, all 12 WebMCP capabilities have human UI paths backed by AP routes and services. Separately, the AR reference system provides human UI paths for each of its seven capabilities through its own routes and services.

## Document approval and writes

AP's three document-writing tools - batch submission, exception evidence, and corrected replacement - pause on an accessible portal approval panel. The page prepares a bounded metadata-only manifest and receives a short-lived opaque approval identifier after the signed-in user approves. The identifier is internal page state, not a WebMCP argument.

Postgres independently derives the final manifest, verifies tenant, user, action, idempotency key, expiry, filenames, hashes, and exact payload, then consumes approval in the same transaction as the business mutation. Approval records never store PDF bytes. Successful tool calls display an agent-labelled result and reload authoritative backend state; presentation events cannot authorize or persist data.

## Financial workflows

`submit_invoice_batch` derives the supplier from the caller, serializes the idempotency key, locks referenced POs, validates ownership, state, currency, balance, uniqueness, PDF structure, size, and checksum, then inserts receipts, updates balances, records audit data, and stores the immutable response in one transaction. All invoices commit or none do.

Exception responses enforce the stored owner, allowed action, and exact required evidence. Verified supplier evidence may resolve and accept an invoice only when no other blocker remains. Buyer-owned blockers remain blocked and use a tracked inquiry. Corrected revisions require an explicitly permitted replacement and atomically release and reallocate PO balance.

Every second committed synthetic invoice receives one immutable payment schedule for ten seconds later. Status reads expose matured state without mutating it. AR remittance writeback requires an existing portal receipt, matching currency, available balance, and an idempotent exact allocation.

AR and AP reset their deterministic synthetic data independently through human-only, tenant-scoped, audited transactions. Reset is not a WebMCP tool.

## Documents and transfer

AR produces complete synthetic invoice and evidence PDFs with authoritative business fields and valid catalog, page, cross-reference, trailer, and `startxref` structures. Before release, AR validates canonical base64, decoded size, structure, and SHA-256. After informed transfer approval, AP independently verifies the same properties before validation or submission.

The browser agent carries only the human-approved package into Acme AP. Each of Acme's 12 tools terminates inside the AP boundary. The independent AR reference system's seven tools terminate inside AR and cannot write Acme state.

## Performance

Authenticated workspace state is never cached. Server reads are concurrent where independent, each workspace refreshes through one same-origin endpoint after writes, indexes match tenant and workflow queries, and payment maturity uses one scheduled refresh rather than polling. These choices never weaken correctness or isolation.
