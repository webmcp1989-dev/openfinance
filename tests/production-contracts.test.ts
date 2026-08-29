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
  });

  test("both visible workspace endpoints are documented with audit events", async () => {
    const openApi = await readFile(join(root, "docs/openapi.yaml"), "utf8");
    expect(openApi).toContain("/api/agent/workspace:");
    expect(openApi).toContain("OpenFinanceWorkspaceState");
    expect(openApi).toContain("AcmeWorkspaceState");
    expect(openApi.match(/auditEvents:/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
