import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import acmeConfig from "../apps/acme-ap/next.config";
import openFinanceConfig from "../apps/openfinance-ar/next.config";

const root = join(import.meta.dir, "..");

describe("production security headers", () => {
  for (const [name, config] of [["OpenFinance AR", openFinanceConfig], ["Acme AP", acmeConfig]] as const) {
    test(`${name} denies framing and unnecessary browser capabilities`, async () => {
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
    expect(setup).toContain("202608290002_harden_submission_wrapper.sql");
  });
});

describe("WebMCP safety contracts", () => {
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

  test("both visible workspace endpoints are documented with audit events", async () => {
    const openApi = await readFile(join(root, "docs/openapi.yaml"), "utf8");
    expect(openApi).toContain("/api/agent/workspace:");
    expect(openApi).toContain("OpenFinanceWorkspaceState");
    expect(openApi).toContain("AcmeWorkspaceState");
    expect(openApi.match(/auditEvents:/g)?.length).toBeGreaterThanOrEqual(2);
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
