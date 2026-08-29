import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { remoteMcpToolNames } = await import("./page");

test("the remote MCP information page advertises every live AR tool except reset", () => {
  expect(remoteMcpToolNames).toEqual([
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
  expect(remoteMcpToolNames.some((name) => name.includes("reset"))).toBe(false);
});
