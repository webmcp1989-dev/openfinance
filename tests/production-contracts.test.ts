import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import acmeConfig from "../apps/acme-ap/next.config";
import openFinanceConfig from "../apps/openfinance-ar/next.config";
import { MAX_TRANSFER_INVOICE_COUNT as ACME_TRANSFER_LIMIT } from "../apps/acme-ap/lib/domain/transfer-limits";
import { MAX_TRANSFER_INVOICE_COUNT as OPENFINANCE_TRANSFER_LIMIT } from "../apps/openfinance-ar/lib/domain/transfer-limits";

const root = join(import.meta.dir, "..");

describe("production security headers", () => {
  for (const [name, config] of [["OpenFinance AR", openFinanceConfig], ["Acme AP", acmeConfig]] as const) {
    test(`${name} denies framing and unnecessary browser capabilities`, async () => {
      expect(config.agentRules).toBe(false);
      expect(config.headers).toBeFunction();
      const rules = await config.headers!();
      const headers = Object.fromEntries(rules[0]!.headers.map((header) => [header.key, header.value]));
      expect(headers["X-Frame-Options"]).toBe("DENY");
      expect(headers["X-Content-Type-Options"]).toBe("nosniff");
      expect(headers["Permissions-Policy"]).toContain("payment=()");
      expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
      expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    });
  }
});

describe("responsive authentication controls", () => {
  test("both mobile workspaces keep identity and sign-out controls visible", async () => {
    const arStyles = await readFile(join(root, "apps/openfinance-ar/app/styles.css"), "utf8");
    const apStyles = await readFile(join(root, "apps/acme-ap/app/styles.css"), "utf8");
    expect(arStyles).not.toContain(".identity { display: none; }");
    expect(arStyles).toContain(".identity { width: 100%; min-width: 0; justify-content: space-between; }");
    expect(apStyles).not.toContain(".supplier { display: none; }");
    expect(apStyles).toContain(".supplier { justify-content: space-between;");
  });
});

describe("authentication recovery messages", () => {
  for (const loginPage of [
    "apps/openfinance-ar/app/login/page.tsx",
    "apps/acme-ap/app/login/page.tsx",
  ]) {
    test(`${loginPage} distinguishes missing workspace access from invalid credentials`, async () => {
      const source = await readFile(join(root, loginPage), "utf8");
      expect(source).toContain('error === "profile_missing"');
      expect(source).toContain("account is authenticated but is not assigned");
      expect(source).toContain("The email or password is incorrect.");
    });
  }
});

describe("API authorization ordering", () => {
  const writeRoutes = [
    "apps/openfinance-ar/app/api/agent/packages/route.ts",
    "apps/openfinance-ar/app/api/agent/delivery-events/route.ts",
    "apps/openfinance-ar/app/api/agent/erp-sync/route.ts",
    "apps/acme-ap/app/api/agent/purchase-orders/route.ts",
    "apps/acme-ap/app/api/agent/validate/route.ts",
    "apps/acme-ap/app/api/agent/submissions/route.ts",
    "apps/acme-ap/app/api/agent/status/route.ts",
  ];

  for (const route of writeRoutes) {
    test(`${route} authenticates before parsing an untrusted body`, async () => {
      const source = await readFile(join(root, route), "utf8");
      const authentication = source.indexOf("await requireAuthenticatedClient()");
      const bodyParsing = source.indexOf("await request.json()");
      expect(authentication).toBeGreaterThan(-1);
      expect(bodyParsing).toBeGreaterThan(authentication);
    });
  }
});

describe("database mutation boundaries", () => {
  test("AR and AP serialize retries at the tenant-scoped public wrappers", async () => {
    const ar = await readFile(join(root, "services/openfinance/supabase/migrations/202608290002_reject_duplicate_delivery_items.sql"), "utf8");
    const ap = await readFile(join(root, "services/acme/supabase/migrations/202608290002_harden_submission_wrapper.sql"), "utf8");
    expect(ar).toContain("pg_advisory_xact_lock");
    expect(ar).toContain("v_organization_id::text");
    expect(ap).toContain("pg_advisory_xact_lock");
    expect(ap).toContain("v_supplier_id::text");
  });

  test("AR enforces direct-RPC fields and legal state transitions in Postgres", async () => {
    const migration = await readFile(join(root, "services/openfinance/supabase/migrations/202608290003_enforce_delivery_event_contract.sql"), "utf8");
    expect(migration).toContain("Invalid portal result fields");
    expect(migration).toContain("Invalid portal exception fields");
    expect(migration).toContain("A purchase order is required before recording a portal result");
    expect(migration).toContain("Invoice state does not allow a portal result");
    expect(migration).toContain("Portal status cannot move backwards");
  });

  test("setup documentation includes every ordered hardening migration", async () => {
    const setup = await readFile(join(root, "docs/SETUP.md"), "utf8");
    expect(setup).toContain("202608290003_enforce_delivery_event_contract.sql");
    expect(setup).toContain("202608290004_bound_json_money.sql");
    expect(setup).toContain("202608290005_canonicalize_delivery_requests.sql");
    expect(setup).toContain("202608290006_simulate_erp_invoice_sync.sql");
    expect(setup).toContain("202608290007_repair_renderable_invoice_pdfs.sql");
    expect(setup).toContain("202608290002_harden_submission_wrapper.sql");
    expect(setup).toContain("202608290003_bound_json_money.sql");
    expect(setup).toContain("202608290004_align_submission_policy.sql");
    expect(setup).toContain("202608290005_canonicalize_submission_requests.sql");
    expect(setup).toContain("202608290006_validate_pdf_structure.sql");
    expect(setup).toContain("202608290007_simulate_payment_settlement.sql");
  });

  test("money stays within JSON's exact-integer range at every boundary", async () => {
    const webmcp = await readFile(join(root, "apps/acme-ap/components/acme-site-tools.tsx"), "utf8");
    const openApi = await readFile(join(root, "docs/openapi.yaml"), "utf8");
    const arMigration = await readFile(join(root, "services/openfinance/supabase/migrations/202608290004_bound_json_money.sql"), "utf8");
    const apMigration = await readFile(join(root, "services/acme/supabase/migrations/202608290003_bound_json_money.sql"), "utf8");
    expect(webmcp).toContain("maximum: Number.MAX_SAFE_INTEGER");
    expect(openApi).toContain("maximum: 9007199254740991");
    expect(arMigration).toContain("amount_minor <= 9007199254740991");
    expect(apMigration.match(/<= 9007199254740991/g)).toHaveLength(2);
  });

  test("Acme's stored policy cannot diverge from its deployed document contract", async () => {
    const migration = await readFile(join(root, "services/acme/supabase/migrations/202608290004_align_submission_policy.sql"), "utf8");
    const openApi = await readFile(join(root, "docs/openapi.yaml"), "utf8");
    expect(migration).toContain("accepted_media_types = array['application/pdf']::text[]");
    expect(migration).toContain("max_document_bytes = 1048576");
    expect(migration).toContain("require_open_purchase_order");
    expect(migration).toContain("enforce_remaining_balance");
    expect(openApi).toContain("items: { type: string, const: application/pdf }");
    expect(openApi).toContain("maxDocumentBytes: { type: integer, const: 1048576 }");
  });

  test("AP derives idempotency identity and canonicalizes direct RPC input in Postgres", async () => {
    const migration = await readFile(join(root, "services/acme/supabase/migrations/202608290005_canonicalize_submission_requests.sql"), "utf8");
    expect(migration).toContain("jsonb_array_length(p_invoices) not between 1 and 3");
    expect(migration).toContain("Invalid invoice fields");
    expect(migration).toContain("Invalid document fields");
    expect(migration).toContain("Document is not canonical base64");
    expect(migration).toContain("extensions.digest(pg_catalog.convert_to(p_invoices::text");
  });

  test("AP verifies PDF structure and checksum before the submission transaction", async () => {
    const migration = await readFile(join(root, "services/acme/supabase/migrations/202608290006_validate_pdf_structure.sql"), "utf8");
    expect(migration).toContain("pg_catalog.convert_to('%PDF-', 'UTF8')");
    expect(migration).toContain("pg_catalog.convert_to('%%EOF', 'UTF8')");
    expect(migration).toContain("Document checksum mismatch");
  });

  test("AP payment discovery is deterministic, scoped, immutable, and read-only", async () => {
    const migration = await readFile(join(root, "services/acme/supabase/migrations/202608290007_simulate_payment_settlement.sql"), "utf8");
    const testSuite = await readFile(join(root, "services/acme/supabase/tests/payment-settlement.test.sql"), "utf8");
    expect(migration).toContain("next_sequence = private.payment_simulator_state.next_sequence + 1");
    expect(migration).toContain("mod(v_sequence_number, 2) = 0");
    expect(migration).toContain("interval '10 seconds'");
    expect(migration).toContain("demo_payment_scheduled");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("submission.supplier_id = (select private.current_supplier_id())");
    expect(migration).toContain("revoke all on public.payment_settlements from public, anon, authenticated");
    expect(testSuite).toContain("exactly one of each committed invoice pair receives a settlement schedule");
    expect(testSuite).toContain("the read-only status function advances only the eligible second invoice to paid");
  });

  test("AR derives idempotency identity and compares canonical retry content in Postgres", async () => {
    const migration = await readFile(join(root, "services/openfinance/supabase/migrations/202608290005_canonicalize_delivery_requests.sql"), "utf8");
    expect(migration).toContain("v_existing_payload is distinct from p_payload");
    expect(migration).toContain("v_existing_event_type is distinct from p_event_type");
    expect(migration).toContain("extensions.digest(");
    expect(migration).toContain("v_existing_fingerprint");
  });

  test("AR ERP sync is tenant-scoped, serialized, idempotent, and deterministic", async () => {
    const migration = await readFile(join(root, "services/openfinance/supabase/migrations/202608290006_simulate_erp_invoice_sync.sql"), "utf8");
    const testSuite = await readFile(join(root, "services/openfinance/supabase/tests/erp-sync.test.sql"), "utf8");
    expect(migration).toContain("p.role in ('admin', 'operator')");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("for update");
    expect(migration).toContain("next_sync_has_invoices = not v_state.next_sync_has_invoices");
    expect(migration).toContain("unique (organization_id, idempotency_key)");
    expect(migration).toContain("erp_invoice_sync_completed");
    expect(testSuite).toContain("first sync imports two invoices");
    expect(testSuite).toContain("second sync reports no new invoices");
    expect(testSuite).toContain("third sync imports the next two invoices");
    expect(testSuite).toContain("idempotent replay inserts nothing");
  });

  test("AR synthetic invoice documents have a complete renderable PDF structure", async () => {
    const migration = await readFile(join(root, "services/openfinance/supabase/migrations/202608290007_repair_renderable_invoice_pdfs.sql"), "utf8");
    const testSuite = await readFile(join(root, "services/openfinance/supabase/tests/renderable-pdfs.test.sql"), "utf8");
    const service = await readFile(join(root, "apps/openfinance-ar/lib/services/invoice-service.ts"), "utf8");
    expect(migration).toContain("/Type /Catalog /Pages 2 0 R");
    expect(migration).toContain("/Type /Page /Parent 2 0 R");
    expect(migration).toContain("v_xref_offset := octet_length");
    expect(migration).toContain("startxref");
    expect(migration).toContain("ensure_renderable_erp_invoice_pdf_before_insert");
    expect(testSuite).toContain("startxref points to the exact byte offset of the xref table");
    expect(service).toContain("bytes.subarray(xrefOffset, xrefOffset + 4).equals(Buffer.from(\"xref\"))");
  });

  test("demo resets are scoped, transactional, and assert their fixed row counts", async () => {
    const arReset = await readFile(join(root, "services/openfinance/supabase/demo/reset.sql"), "utf8");
    const apReset = await readFile(join(root, "services/acme/supabase/demo/reset.sql"), "utf8");
    for (const reset of [arReset, apReset]) {
      expect(reset).toStartWith("-- Administrative demo reset");
      expect(reset).toContain("begin;");
      expect(reset).toContain("pg_advisory_xact_lock");
      expect(reset).toContain("get diagnostics v_updated = row_count");
      expect(reset).toContain("raise exception");
      expect(reset).toContain("commit;");
    }
    expect(arReset).toContain("v_updated <> 4");
    expect(apReset).toContain("v_updated <> 3");
  });

  test("RLS suites exercise real cross-tenant read and mutation denials", async () => {
    const ar = await readFile(join(root, "services/openfinance/supabase/tests/rls.test.sql"), "utf8");
    const ap = await readFile(join(root, "services/acme/supabase/tests/rls.test.sql"), "utf8");
    expect(ar).toContain("Foreign Test Organization");
    expect(ar).toContain("foreign organization invoices are hidden by RLS");
    expect(ar).toContain("delivery writeback cannot mutate a foreign organization invoice");
    expect(ap).toContain("Foreign Test Supplier");
    expect(ap).toContain("foreign supplier purchase orders are hidden by RLS");
    expect(ap).toContain("submission cannot consume a foreign supplier purchase order");
  });
});

describe("WebMCP safety contracts", () => {
  test("tool registrations are scoped to the authenticated page lifetime", async () => {
    for (const app of ["openfinance-ar", "acme-ap"]) {
      const component = app === "openfinance-ar" ? "openfinance" : "acme";
      const source = await readFile(join(root, `apps/${app}/components/${component}-site-tools.tsx`), "utf8");
      const types = await readFile(join(root, `apps/${app}/types/webmcp.d.ts`), "utf8");
      expect(source).toContain("const registrationController = new AbortController()");
      expect(source).toContain("{ signal: registrationController.signal }");
      expect(source).toContain("registrationController.abort()");
      expect(source).toContain('if (disposed || results.some((result) => result.status === "rejected")) removeTools()');
      expect(types).toContain("options?: Readonly<{ signal?: AbortSignal }>");
    }
  });

  test("browser-facing package transfers stay below the deployed payload boundary", async () => {
    const ar = await readFile(join(root, "apps/openfinance-ar/components/openfinance-site-tools.tsx"), "utf8");
    const ap = await readFile(join(root, "apps/acme-ap/components/acme-site-tools.tsx"), "utf8");
    const openApi = await readFile(join(root, "docs/openapi.yaml"), "utf8");
    expect(OPENFINANCE_TRANSFER_LIMIT).toBe(3);
    expect(ACME_TRANSFER_LIMIT).toBe(3);
    expect(ar).toContain("maxItems: MAX_TRANSFER_INVOICE_COUNT");
    expect(ap).toContain("maxItems: MAX_TRANSFER_INVOICE_COUNT");
    expect(openApi.match(/maxItems: 3/g)).toHaveLength(2);
  });

  test("business-data reads are marked untrusted and all requests are cancellable", async () => {
    const ar = await readFile(join(root, "apps/openfinance-ar/components/openfinance-site-tools.tsx"), "utf8");
    const ap = await readFile(join(root, "apps/acme-ap/components/acme-site-tools.tsx"), "utf8");
    expect(ar.match(/untrustedContentHint: true/g)).toHaveLength(2);
    expect(ap.match(/untrustedContentHint: true/g)).toHaveLength(3);
    expect(ar.match(/signal: options\?\.signal/g)).toHaveLength(4);
    expect(ap.match(/signal: options\?\.signal/g)).toHaveLength(5);
    expect(ar.match(/title: "/g)).toHaveLength(4);
    expect(ap.match(/title: "/g)).toHaveLength(5);
    expect(ap).toContain('pattern: "^[A-Za-z0-9+/]+={0,2}$"');
    expect(ap).toContain("human approves transferring that exact package to Acme");
  });

  test("the AR discovery tool takes customer context from intent instead of executable demo constants", async () => {
    const ar = await readFile(join(root, "apps/openfinance-ar/components/openfinance-site-tools.tsx"), "utf8");
    const route = await readFile(join(root, "apps/openfinance-ar/app/api/agent/invoices/route.ts"), "utf8");
    const openApi = await readFile(join(root, "docs/openapi.yaml"), "utf8");
    expect(ar).not.toContain("customerName=Acme%20Manufacturing");
    expect(ar).toContain('required: ["customerName"]');
    expect(ar).toContain('new URLSearchParams({ readyOnly: "true" })');
    expect(ar).toContain('if (typeof customerName === "string") query.set("customerName", customerName)');
    expect(route).toContain("customerName: z.string().min(1).max(160),");
    expect(route).not.toContain("customerName: z.string().min(1).max(160).optional()");
    const document = Bun.YAML.parse(openApi) as {
      paths: Record<string, { get?: { parameters?: Array<{ name: string; required?: boolean }> } }>;
    };
    expect(document.paths["/api/agent/invoices"]?.get?.parameters).toContainEqual({
      in: "query",
      name: "customerName",
      required: true,
      schema: { type: "string", minLength: 1, maxLength: 160 },
    });
  });

  test("both visible workspace endpoints are documented with audit events", async () => {
    const openApi = await readFile(join(root, "docs/openapi.yaml"), "utf8");
    expect(openApi).toContain("/api/agent/workspace:");
    expect(openApi).toContain("OpenFinanceWorkspaceState");
    expect(openApi).toContain("AcmeWorkspaceState");
    expect(openApi.match(/auditEvents:/g)?.length).toBeGreaterThanOrEqual(2);
    expect(openApi.match(/auditAvailable:/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("every WebMCP capability has an equivalent human UI path", async () => {
    const ar = await readFile(join(root, "apps/openfinance-ar/components/openfinance-workspace.tsx"), "utf8");
    const ap = await readFile(join(root, "apps/acme-ap/components/acme-workspace.tsx"), "utf8");
    const apPage = await readFile(join(root, "apps/acme-ap/app/page.tsx"), "utf8");

    expect(ar).toContain("statusFilter");
    expect(ar).toContain('"/api/agent/packages"');
    expect(ar.match(/"\/api\/agent\/delivery-events"/g)).toHaveLength(1);
    expect(ar).toContain("Record portal outcome");
    expect(apPage).toContain("getRequirements(supabase)");
    expect(ap).toContain('"/api/agent/purchase-orders"');
    expect(ap).toContain('"/api/agent/validate"');
    expect(ap).toContain('"/api/agent/submissions"');
    expect(ap).toContain('"/api/agent/status"');
    expect(ap).toContain("approve submission to Acme AP");
  });

  test("the demo runbook requires separate transfer and submission confirmations", async () => {
    const demo = await readFile(join(root, "docs/DEMO.md"), "utf8");
    expect(demo).toContain("informed transfer confirmation");
    expect(demo).toContain("separate submission confirmation");
  });
});

describe("OpenAPI contract coverage", () => {
  test("documents every same-origin write rejection and structured result", async () => {
    const source = await readFile(join(root, "docs/openapi.yaml"), "utf8");
    const document = Bun.YAML.parse(source) as {
      paths: Record<string, {
        get?: { responses: Record<string, unknown> };
        post?: { responses: Record<string, unknown> };
      }>;
      components: { schemas: Record<string, unknown>; responses: Record<string, unknown> };
    };
    const writePaths = [
      "/api/agent/packages",
      "/api/agent/delivery-events",
      "/api/agent/erp-sync",
      "/api/agent/purchase-orders",
      "/api/agent/validate",
      "/api/agent/submissions",
      "/api/agent/status",
    ];

    for (const path of writePaths) {
      const responses = document.paths[path]?.post?.responses;
      expect(responses).toBeDefined();
      expect(responses).toHaveProperty("400");
      expect(responses).toHaveProperty("401");
      expect(responses).toHaveProperty("403");
      expect(responses).toHaveProperty("415");
    }

    expect(document.paths["/api/agent/invoices"]?.get?.responses).toHaveProperty("400");
    expect(document.components.responses).toHaveProperty("Forbidden");
    expect(document.components.responses).toHaveProperty("UnsupportedMediaType");
    expect(document.components.schemas).toHaveProperty("DeliveryEventResult");
    expect(document.components.schemas).toHaveProperty("InvoiceStatusResult");
  });
});
