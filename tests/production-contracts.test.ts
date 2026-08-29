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
