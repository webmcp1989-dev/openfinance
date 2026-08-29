import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";

mock.module("server-only", () => ({}));
const { getInvoiceDocument, getSubmissionPackage, recordDeliveryEvent, syncInvoicesFromErp } = await import("./invoice-service");

const validDocumentBytes = Buffer.from("%PDF-1.4\nOpenFinance invoice\n%%EOF", "utf8");
const validDocumentBase64 = validDocumentBytes.toString("base64");
const validDocumentSha256 = createHash("sha256").update(validDocumentBytes).digest("hex");

function packageClient(contentBase64: string, sha256 = validDocumentSha256) {
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
    document_sha256: sha256,
  };
  const chain = {
    select() { return chain; },
    in() { return chain; },
    eq() { return chain; },
    order() { return Promise.resolve({ data: [row], error: null }); },
  };
  return { from() { return chain; } };
}

function documentClient(options: { data?: Record<string, unknown> | null; error?: { code: string } | null } = {}) {
  const calls: string[] = [];
  const row = options.data === undefined ? {
    document_name: "INV-10482.pdf",
    document_media_type: "application/pdf",
    document_content_base64: validDocumentBase64,
    document_sha256: validDocumentSha256,
  } : options.data;
  const chain = {
    select() { calls.push("select"); return chain; },
    eq(column: string, value: string) { calls.push(`${column}:${value}`); return chain; },
    single() { calls.push("single"); return Promise.resolve({ data: row, error: options.error ?? null }); },
  };
  return { client: { from() { calls.push("invoices"); return chain; } }, calls };
}

describe("OpenFinance submission packages", () => {
  test("normalizes PostgreSQL line-wrapped base64 before cross-site transfer", async () => {
    const wrapped = `${validDocumentBase64.slice(0, 12)}\n${validDocumentBase64.slice(12)}`;
    const result = await getSubmissionPackage(packageClient(wrapped) as never, ["INV-10482"]);
    expect(result[0]?.document.contentBase64).toBe(validDocumentBase64);
  });

  test("fails closed when stored document content is not base64", async () => {
    await expect(getSubmissionPackage(packageClient("YWJj$A==") as never, ["INV-10482"]))
      .rejects.toMatchObject({ status: 500, code: "package_document_invalid" });
  });

  test("fails closed when stored base64 is not canonically padded", async () => {
    await expect(getSubmissionPackage(packageClient("AAAAAAAAA") as never, ["INV-10482"]))
      .rejects.toMatchObject({ status: 500, code: "package_document_invalid" });
  });

  test("fails closed when the stored checksum does not match the PDF", async () => {
    await expect(getSubmissionPackage(packageClient(validDocumentBase64, "0".repeat(64)) as never, ["INV-10482"]))
      .rejects.toMatchObject({ status: 500, code: "package_document_invalid" });
  });
});

describe("OpenFinance human invoice downloads", () => {
  test("returns the verified tenant-scoped PDF bytes and metadata", async () => {
    const { client, calls } = documentClient();
    const result = await getInvoiceDocument(client as never, "INV-10482");

    expect(Buffer.from(result.bytes)).toEqual(validDocumentBytes);
    expect(result).toMatchObject({
      fileName: "INV-10482.pdf",
      mediaType: "application/pdf",
      sha256: validDocumentSha256,
    });
    expect(calls).toEqual(["invoices", "select", "invoice_number:INV-10482", "single"]);
  });

  test("does not reveal a missing or unauthorized invoice document", async () => {
    const { client } = documentClient({ data: null, error: { code: "PGRST116" } });
    await expect(getInvoiceDocument(client as never, "INV-FOREIGN"))
      .rejects.toMatchObject({
        status: 404,
        code: "invoice_document_not_found",
        message: "Invoice document was not found",
      });
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
