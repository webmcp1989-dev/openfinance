import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";

mock.module("server-only", () => ({}));
const {
  getInvoiceDocument,
  getInvoiceSupportingDocuments,
  getSubmissionPackage,
  recordDeliveryEvent,
  syncInvoicesFromErp,
} = await import("./invoice-service");

function renderTestPdf(label: string) {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${label}) Tj\nET\n`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  const object = (content: string) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += content;
  };
  object("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  object("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  object("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n");
  object(`4 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream\nendobj\n`);
  object("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

const validDocumentBytes = renderTestPdf("OpenFinance invoice");
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

  test("fails closed when stored bytes only imitate a PDF header and EOF marker", async () => {
    const pseudoPdf = Buffer.from("%PDF-1.4\nOpenFinance invoice\n%%EOF", "utf8");
    const client = packageClient(
      pseudoPdf.toString("base64"),
      createHash("sha256").update(pseudoPdf).digest("hex"),
    );

    await expect(getSubmissionPackage(client as never, ["INV-10482"]))
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

describe("OpenFinance supporting documents", () => {
  function supportingDocumentClient(overrides: Record<string, unknown> = {}) {
    const invoiceLookup = {
      select() { return invoiceLookup; },
      eq() { return invoiceLookup; },
      maybeSingle() { return Promise.resolve({ data: { id: "invoice-id" }, error: null }); },
    };
    const documentLookup = {
      select() { return documentLookup; },
      eq() { return documentLookup; },
      order() {
        return Promise.resolve({
          data: [{
            document_kind: "proof_of_delivery",
            file_name: "INV-10482-proof.pdf",
            media_type: "application/pdf",
            content_base64: validDocumentBase64,
            sha256: validDocumentSha256,
            size_bytes: validDocumentBytes.length,
            ...overrides,
          }],
          error: null,
        });
      },
    };
    return {
      from(table: string) { return table === "invoices" ? invoiceLookup : documentLookup; },
    };
  }

  test("returns only integrity-verified supporting PDFs", async () => {
    const result = await getInvoiceSupportingDocuments(supportingDocumentClient() as never, "INV-10482");
    expect(result[0]).toMatchObject({
      documentKind: "proof_of_delivery",
      sha256: validDocumentSha256,
      sizeBytes: validDocumentBytes.length,
    });
  });

  test("fails closed when stored supporting-document metadata is inconsistent", async () => {
    await expect(getInvoiceSupportingDocuments(
      supportingDocumentClient({ size_bytes: validDocumentBytes.length + 1 }) as never,
      "INV-10482",
    )).rejects.toMatchObject({ status: 500, code: "supporting_document_invalid" });
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
