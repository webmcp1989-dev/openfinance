import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { getSubmissionPackage, recordDeliveryEvent, syncInvoicesFromErp } = await import("./invoice-service");

function packageClient(contentBase64: string) {
  const row = {
    invoice_number: "INV-10482",
    amount_minor: 1_842_000,
    currency: "USD",
    invoice_date: "2026-08-12",
    purchase_order_number: "PO-8821",
    status: "ready",
    portal_reference: null,
    portal_status: null,
    exception_code: null,
    exception_message: null,
    version: 1,
    customers: { name: "Acme Manufacturing" },
    document_name: "INV-10482.pdf",
    document_media_type: "application/pdf",
    document_content_base64: contentBase64,
    document_sha256: "0".repeat(64),
  };
  const chain = {
    select() { return chain; },
    in() { return chain; },
    eq() { return chain; },
    order() { return Promise.resolve({ data: [row], error: null }); },
  };
  return { from() { return chain; } };
}

describe("OpenFinance submission packages", () => {
  test("normalizes PostgreSQL line-wrapped base64 before cross-site transfer", async () => {
    const result = await getSubmissionPackage(packageClient("YWJj\nZA==") as never, ["INV-10482"]);
    expect(result[0]?.document.contentBase64).toBe("YWJjZA==");
  });

  test("fails closed when stored document content is not base64", async () => {
    await expect(getSubmissionPackage(packageClient("YWJj$A==") as never, ["INV-10482"]))
      .rejects.toMatchObject({ status: 500, code: "package_document_invalid" });
  });

  test("fails closed when stored base64 is not canonically padded", async () => {
    await expect(getSubmissionPackage(packageClient("AAAAAAAAA") as never, ["INV-10482"]))
      .rejects.toMatchObject({ status: 500, code: "package_document_invalid" });
  });
});

describe("OpenFinance delivery service errors", () => {
  test("returns actionable recovery when the database rejects a stale state transition", async () => {
    const client = {
      rpc() {
        return Promise.resolve({ data: null, error: { code: "23514" } });
      },
    };

    await expect(recordDeliveryEvent(client as never, {
      eventType: "portal_exception",
      idempotencyKey: "state-conflict-test-20260829",
      items: [{
        invoiceNumber: "INV-10482",
        exceptionCode: "po_balance",
        message: "PO balance changed.",
      }],
    })).rejects.toMatchObject({
      status: 409,
      code: "invoice_state_conflict",
      message: "Invoice state changed; reload the queue before recording the portal outcome",
    });
  });
});

describe("OpenFinance ERP synchronization", () => {
  test("returns the database-authored alternating sync result", async () => {
    const expected = {
      importedCount: 2,
      items: [{
        invoiceNumber: "ERP-000001",
        customerName: "Acme Manufacturing",
        amountMinor: 125_000,
        currency: "USD",
        purchaseOrderNumber: "PO-8821",
      }],
      syncedAt: "2026-08-29T17:00:00.000Z",
    };
    const calls: unknown[] = [];
    const client = {
      rpc(name: string, input: unknown) {
        calls.push({ name, input });
        return Promise.resolve({ data: expected, error: null });
      },
    };

    await expect(syncInvoicesFromErp(client as never, "erp-sync-request-20260829")).resolves.toEqual(expected);
    expect(calls).toEqual([{
      name: "sync_invoices_from_erp",
      input: { p_idempotency_key: "erp-sync-request-20260829" },
    }]);
  });

  test("does not leak database errors when sync is not configured", async () => {
    const client = {
      rpc() { return Promise.resolve({ data: null, error: { code: "P0002", message: "internal detail" } }); },
    };
    await expect(syncInvoicesFromErp(client as never, "erp-sync-request-20260829")).rejects.toMatchObject({
      status: 409,
      code: "erp_sync_not_configured",
      message: "ERP sync is not configured for this organization",
    });
  });
});
