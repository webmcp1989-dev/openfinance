import { describe, expect, mock, test } from "bun:test";
import type { AuthInfo } from "@modelcontextprotocol/server";

mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/bearer", () => ({ createBearerClient: () => ({}) }));
const [{ createMcpHandler }, { createOpenFinanceMcpServer }] = await Promise.all([
  import("@modelcontextprotocol/server"),
  import("./server"),
]);

const authInfo: AuthInfo = {
  token: "oauth-access-token",
  clientId: "oauth-client",
  scopes: ["email"],
  expiresAt: 2_000_000_000,
  resource: new URL("https://ar.example.com/mcp"),
  extra: {
    subject: "10000000-0000-4000-8000-000000000001",
    actor: {
      userId: "10000000-0000-4000-8000-000000000001",
      organizationId: "20000000-0000-4000-8000-000000000001",
      role: "operator",
      fullName: "AR Operator",
    },
  },
};
const subject = "10000000-0000-4000-8000-000000000001";
const organizationId = "20000000-0000-4000-8000-000000000001";

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    clientFactory: () => ({}),
    getWorkspaceContext: async () => ({
      userId: subject,
      fullName: "AR Operator",
      role: "operator",
      organizationId,
      organizationName: "OpenFinance Demo Supplier",
    }),
    listCustomers: async () => [],
    listInvoiceQueue: async () => [],
    getSubmissionPackage: async () => [],
    listPortalFollowups: async () => [],
    getInvoiceSupportingDocuments: async () => [],
    listAuditEvents: async () => [],
    syncInvoicesFromErp: async () => ({ importedCount: 0, items: [], syncedAt: "2026-08-29T12:00:00.000Z" }),
    recordDeliveryEvent: async () => ({}),
    recordPaymentRemittance: async () => ({}),
    ...overrides,
  };
}

function handler(deps = dependencies()) {
  return createMcpHandler(
    () => createOpenFinanceMcpServer(authInfo, deps as never),
    { legacy: "stateless", responseMode: "json" },
  );
}

type RpcBody = {
  result?: {
    tools?: Array<{ name: string; annotations?: Record<string, boolean> }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
};

async function rpc(method: string, params?: Record<string, unknown>, deps = dependencies()) {
  const response = await handler(deps).fetch(new Request("https://ar.example.com/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  }), { authInfo });
  const responseText = await response.text();
  const dataLine = responseText.split(/\r?\n/).find((line) => line.startsWith("data: "));
  const body = JSON.parse(dataLine ? dataLine.slice(6) : responseText) as RpcBody;
  return { response, body };
}

describe("OpenFinance AR remote MCP tools", () => {
  test("advertises the complete bounded tool inventory without demo reset", async () => {
    const { response, body } = await rpc("tools/list");
    expect(response.status).toBe(200);
    const tools = body.result?.tools ?? [];
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_ar_workspace",
      "list_customers",
      "list_invoices",
      "get_submission_package",
      "list_portal_followups",
      "get_invoice_supporting_documents",
      "list_audit_events",
      "sync_invoices_from_erp",
      "record_portal_result",
      "record_portal_exception",
      "record_payment_remittance",
    ]);
    expect(tools.some((tool) => tool.name.includes("reset"))).toBe(false);
    expect(tools.find((tool) => tool.name === "list_invoices")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === "record_portal_result")?.annotations?.idempotentHint).toBe(true);
  });

  test("passes validated invoice filters to the tenant-scoped service", async () => {
    const calls: unknown[] = [];
    const deps = dependencies({
      listInvoiceQueue: async (_client: unknown, filters: unknown) => { calls.push(filters); return []; },
    });
    const { body } = await rpc("tools/call", {
      name: "list_invoices",
      arguments: { customerName: "Acme Manufacturing", statuses: ["ready"] },
    }, deps);
    expect(body.result?.isError).not.toBe(true);
    expect(body.result?.structuredContent).toMatchObject({ count: 0 });
    expect(calls).toEqual([{ customerName: "Acme Manufacturing", statuses: ["ready"] }]);
  });

  test("rejects invalid write inputs before invoking business services", async () => {
    let writes = 0;
    const deps = dependencies({ recordDeliveryEvent: async () => { writes += 1; return {}; } });
    const { body } = await rpc("tools/call", {
      name: "record_portal_result",
      arguments: { idempotencyKey: "short", items: [] },
    }, deps);
    expect(body.result?.isError).toBe(true);
    expect(writes).toBe(0);
  });
});
