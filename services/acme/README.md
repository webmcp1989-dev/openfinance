# Acme Supabase boundary

This directory belongs only to the independent Acme AP Supabase project.

- `supabase/migrations/202608290001_initial.sql` creates supplier-scoped PO and submission data, seeds the challenge state, enables RLS, and installs the atomic idempotent submission transaction.
- `supabase/migrations/202608290002_harden_submission_wrapper.sql` serializes retries for a supplier-scoped idempotency key and rejects duplicate invoice numbers before submission processing.
- `supabase/migrations/202608290003_bound_json_money.sql` keeps purchase-order and submitted-invoice amounts inside JSON's exact-integer range.
- `supabase/migrations/202608290004_align_submission_policy.sql` prevents the stored AP policy from advertising document or PO behavior outside the deployed WebMCP and transaction contract.
- `supabase/migrations/202608290005_canonicalize_submission_requests.sql` makes the authenticated wrapper enforce the exact payload shape and canonical PDF encoding, cap transfer batches, and derive the idempotency fingerprint inside Postgres.
- `supabase/migrations/202608290006_validate_pdf_structure.sql` requires the PDF signature and an end-of-file marker near the document tail, rechecks the one-megabyte bound, and verifies SHA-256 before entering the submission transaction.
- `supabase/migrations/202608290007_simulate_payment_settlement.sql` assigns a serialized per-supplier invoice sequence, schedules every second committed invoice for synthetic settlement after 10 seconds, and exposes a session-scoped read function without direct settlement-table grants.
- `supabase/migrations/202608290008_add_authorized_demo_reset.sql` adds the explicitly confirmed, submitter-scoped human reset used to make the synthetic challenge repeatable; it is audited and intentionally absent from WebMCP.
- `supabase/migrations/202608300001_expand_exception_to_cash.sql` adds line/receipt/service-entry PO context, status events, structured exceptions, evidence-backed responses, tracked inquiries, revision support, and supplier-scoped RLS.
- `supabase/migrations/202608300002_replace_rejected_invoice.sql` adds the transactional, idempotent corrected-invoice revision workflow with atomic PO balance reallocation.
- `supabase/migrations/202608300003_align_simulator_and_reset.sql` keeps payment scheduling and the synthetic reset correct for the expanded schema.
- `supabase/migrations/202608300004_current_invoice_statuses.sql` limits effective status reads to the current invoice revision.
- `supabase/migrations/202608300005_validate_attachment_pdfs.sql` adds the supplier-evidence PDF constraint, which is strengthened by the later structural-PDF migration.
- `supabase/migrations/202608300006_serialize_invoice_inquiries.sql` serializes supplier-scoped inquiry retries.
- `supabase/migrations/202608300007_serialize_exception_responses.sql` serializes supplier-scoped exception-response retries and requires a complete PDF marker for every attached document.
- `supabase/migrations/202608300008_name_postgrest_rpc_arguments.sql` gives every new public mutation wrapper stable named arguments for PostgREST RPC discovery.
- `supabase/migrations/202608300009_enforce_structural_pdf_contract.sql` makes the AP UI, service, public submission wrapper, corrected-invoice transaction, and evidence constraint reject canonical PDF-looking placeholders unless they have the accepted classic catalog/page/cross-reference structure. Apply `202608300010_repair_binary_pdf_inspection.sql` immediately afterward; it preserves that contract while making binary inspection executable on PostgreSQL's actual bytea functions.
- `supabase/migrations/202608300011_seed_exception_portfolio.sql` adds six independent buyer POs, two historical disputed submissions, a supplier-owned missing-delivery-proof exception, and a buyer-receiving missing-receipt exception. It guards exception responses by stored owner/action and exact required evidence while preserving tracked inquiries for buyer-owned work.
- `supabase/migrations/202608300014_seed_replacement_exception.sql` adds rejected `INV-10479` as a third independently persisted AP fixture with a supplier-owned `tax_total_mismatch` exception permitting only `replace_invoice`; it updates both the live additive seed and the canonical human reset without disturbing the next payment pair.
- `supabase/migrations/202608310001_complete_exception_workflow.sql` atomically resolves an exact evidence-backed supplier exception and accepts the disputed invoice only when no other blocker remains. It also exposes one tenant-scoped workflow read model joining the current invoice, exception, and latest buyer case for the live-updating human queue.
- `supabase/tests/rls.test.sql` asserts grants, policy and privileged-function hardening, then creates a foreign supplier and proves its purchase orders cannot be read or consumed.
- `supabase/tests/submission-wrapper.test.sql` verifies policy alignment, exact request enforcement, PDF structure, wrapper execution mode, retry serialization, identical-response replay, single balance decrement, changed-payload rejection, and duplicate rejection.
- `supabase/tests/payment-settlement.test.sql` verifies payment-state isolation, view security, deterministic pair behavior, paid-status maturity, references, and audit creation.
- `supabase/tests/exception-to-cash.test.sql` verifies exception/inquiry/revision data boundaries, idempotent serialization, PDF evidence integrity, the accepted evidence transition, buyer-case non-resolution, the workflow read model, and a complete authorized replacement transition.
- `supabase/demo/reset.sql` is the reviewed administrative fallback for only the fixed synthetic challenge supplier.

Do not point these migrations at the OpenFinance project. Runtime access uses only the Acme publishable key and the authenticated Acme supplier session.
