import { createHash } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";

import type { InvoiceCandidate } from "@/lib/domain/submissions";

mock.module("server-only", () => ({}));
const {
  describeExceptionAuthority,
  getInvoiceStatus,
  listOpenBuyerCases,
  listInvoiceWorkflows,
  replaceRejectedInvoice,
  respondToInvoiceException,
  submitInvoiceBatch,
  validateInvoice,
} = await import("./submission-service");

function renderStructuralPdf() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n",
  ];
  const prefix = `%PDF-1.4\n${objects.join("")}`;
  const xrefOffset = Buffer.byteLength(prefix, "utf8");
  return Buffer.from(`${prefix}xref\n0 4\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "utf8");
}

const documentBytes = renderStructuralPdf();

function invoice(overrides: Partial<InvoiceCandidate> = {}): InvoiceCandidate {
  return {
    invoiceNumber: "INV-10482",
    invoiceDate: "2026-08-12",
    amountMinor: 1_842_000,
    currency: "USD",
    purchaseOrderNumber: "PO-8821",
    document: {
      fileName: "INV-10482.pdf",
      mediaType: "application/pdf",
      contentBase64: documentBytes.toString("base64"),
      sha256: createHash("sha256").update(documentBytes).digest("hex"),
    },
    ...overrides,
  };
}

function fakeSupabase(options: {
  remainingAmountMinor?: number;
  duplicate?: boolean;
  rpcResult?: unknown;
} = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const purchaseOrder = {
    purchase_order_number: "PO-8821",
    description: "Product implementation",
    currency: "USD",
    authorized_amount_minor: 2_400_000,
    remaining_amount_minor: options.remainingAmountMinor ?? 2_400_000,
    status: "open",
    version: 1,
  };
  const client = {
    from(table: string) {
      const chain = {
        select() { return chain; },
        eq(column: string, value: unknown) {
          filters.push({ table, column, value });
          return chain;
        },
        maybeSingle() {
          if (table === "purchase_orders") return Promise.resolve({ data: purchaseOrder, error: null });
          return Promise.resolve({ data: options.duplicate ? { id: "existing" } : null, error: null });
        },
      };
      return chain;
    },
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({ data: options.rpcResult ?? { batchId: "batch-1", items: [] }, error: null });
    },
  };
  return { client, calls, filters };
}

describe("Acme invoice validation", () => {
  test("states the supplier authority boundary for buyer-owned receiving work", () => {
    expect(describeExceptionAuthority("buyer_receiving")).toEqual({
      supplierCanResolve: false,
      authorityBoundary: "This isn't mine to fix. Acme receiving owns this blocker; I can open a tracked AP case.",
    });
    expect(describeExceptionAuthority("supplier_ar")).toEqual(expect.objectContaining({
      supplierCanResolve: true,
    }));
  });

  test("maps the tenant-scoped workflow read model without client-side authority guesses", async () => {
    const client = {
      rpc(name: string) {
        expect(name).toBe("get_invoice_workflow_items");
        return Promise.resolve({ data: [{
          invoice_number: "INV-10463",
          portal_reference: "ACME-20260820-A1046301",
          amount_minor: 1_100_000,
          currency: "USD",
          invoice_status: "disputed",
          exception_code: "missing_goods_receipt",
          exception_category: "receiving",
          exception_owner: "buyer_receiving",
          exception_status: "open",
          exception_message: "The purchase order has no posted goods receipt.",
          resolution_guidance: "Open a tracked buyer case.",
          allowed_actions: ["create_invoice_inquiry"],
          required_document_kind: null,
          exception_created_at: "2026-08-20T00:00:00.000Z",
          exception_updated_at: "2026-08-21T00:00:00.000Z",
          case_reference: "CASE-20260831-ABCDEF12",
          case_status: "open",
          case_subject: "Missing receipt follow-up",
          case_created_at: "2026-08-31T00:00:00.000Z",
        }], error: null });
      },
    };

    await expect(listInvoiceWorkflows(client as never)).resolves.toEqual([expect.objectContaining({
      invoiceNumber: "INV-10463",
      invoiceStatus: "disputed",
      exception: expect.objectContaining({
        owner: "buyer_receiving",
        supplierCanResolve: false,
        status: "open",
      }),
      latestInquiry: {
        caseReference: "CASE-20260831-ABCDEF12",
        status: "open",
        subject: "Missing receipt follow-up",
        createdAt: "2026-08-31T00:00:00.000Z",
      },
    })]);
  });

  test("maps open buyer cases from the tenant-scoped UI read model", async () => {
    const client = {
      rpc(name: string) {
        expect(name).toBe("get_open_buyer_cases");
        return Promise.resolve({ data: [{
          case_reference: "CASE-20260901-ABCDEF12",
          invoice_number: "INV-10463",
          inquiry_type: "invoice_inquiry",
          owner: "buyer_receiving",
          status: "open",
          subject: "Missing receipt follow-up",
          opened_at: "2026-09-01T10:00:00.000Z",
        }], error: null });
      },
    };
    await expect(listOpenBuyerCases(client as never)).resolves.toEqual([{
      caseReference: "CASE-20260901-ABCDEF12",
      invoiceNumber: "INV-10463",
      inquiryType: "invoice_inquiry",
      owner: "buyer_receiving",
      status: "open",
      subject: "Missing receipt follow-up",
      openedAt: "2026-09-01T10:00:00.000Z",
    }]);
  });

  test("returns an actionable conflict when AP rejects a buyer-owned response", async () => {
    const client = {
      rpc() {
        return Promise.resolve({
          data: null,
          error: {
            code: "P0001",
            message: "This isn't mine to fix. The buyer owns this blocker; open a tracked AP inquiry instead.",
          },
        });
      },
    };

    await expect(respondToInvoiceException(client as never, {
      idempotencyKey: "buyer-owner-test-20260830",
      invoiceNumber: "INV-10463",
      exceptionCode: "missing_goods_receipt",
      message: "Resolved.",
      attachments: [],
    })).rejects.toMatchObject({
      status: 409,
      code: "buyer_owned_exception",
    });
  });

  test("returns the authoritative resolved invoice state after verified evidence", async () => {
    const { client, calls } = fakeSupabase({
      rpcResult: {
        invoiceNumber: "INV-10417",
        exceptionCode: "missing_delivery_proof",
        exceptionStatus: "resolved",
        invoiceStatus: "accepted",
        resolution: "required_evidence_verified",
      },
    });
    const request = {
      idempotencyKey: "supplier-evidence-test-20260831",
      invoiceNumber: "INV-10417",
      exceptionCode: "missing_delivery_proof",
      message: "Verified proof of delivery attached.",
      attachments: [{ documentKind: "proof_of_delivery" }],
    };

    await expect(respondToInvoiceException(client as never, request)).resolves.toEqual({
      invoiceNumber: "INV-10417",
      exceptionCode: "missing_delivery_proof",
      exceptionStatus: "resolved",
      invoiceStatus: "accepted",
      resolution: "required_evidence_verified",
    });
    expect(calls).toEqual([expect.objectContaining({
      name: "respond_to_invoice_exception",
      args: expect.objectContaining({
        p_idempotency_key: request.idempotencyKey,
        p_payload: expect.objectContaining({ invoiceNumber: "INV-10417" }),
      }),
    })]);
  });

  test("does not expose database details when a replacement conflicts", async () => {
    const client = {
      rpc() {
        return Promise.resolve({
          data: null,
          error: {
            code: "23514",
            message: "new row violates check constraint private_internal_state",
          },
        });
      },
    };

    await expect(replaceRejectedInvoice(
      client as never,
      "replacement-error-test-20260831",
      invoice(),
    )).rejects.toMatchObject({
      status: 409,
      code: "replacement_conflict",
      message: "The invoice cannot be replaced in its current state",
    });
  });

  test("accepts a valid checksum-protected PDF within the PO balance", async () => {
    const { client, filters } = fakeSupabase();
    const result = await validateInvoice(client as never, invoice());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(filters).toContainEqual({
      table: "invoice_submissions",
      column: "is_current",
      value: true,
    });
  });

  test("reports the deliberate remaining-balance exception without mutating", async () => {
    const { client } = fakeSupabase({ remainingAmountMinor: 1_000_000 });
    const result = await validateInvoice(client as never, invoice({ amountMinor: 1_290_000 }));
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "amount_exceeds_remaining_balance" }));
  });

  test("rejects a duplicate invoice and a checksum mismatch", async () => {
    const { client } = fakeSupabase({ duplicate: true });
    const candidate = invoice({ document: { ...invoice().document, sha256: "0".repeat(64) } });
    const result = await validateInvoice(client as never, candidate);
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code).sort()).toEqual(["duplicate_invoice", "invalid_document"]);
  });

  test("rejects non-canonical base64 even when it decodes to the same PDF", async () => {
    const { client } = fakeSupabase();
    const canonical = invoice().document.contentBase64;
    const candidate = invoice({
      document: { ...invoice().document, contentBase64: canonical.replace(/=+$/, "") },
    });

    const result = await validateInvoice(client as never, candidate);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_document" }));
  });

  test("rejects a PDF signature without an end-of-file marker", async () => {
    const { client } = fakeSupabase();
    const incompleteBytes = Buffer.from("%PDF-1.4\nincomplete", "utf8");
    const candidate = invoice({
      document: {
        fileName: "INV-10482.pdf",
        mediaType: "application/pdf",
        contentBase64: incompleteBytes.toString("base64"),
        sha256: createHash("sha256").update(incompleteBytes).digest("hex"),
      },
    });

    const result = await validateInvoice(client as never, candidate);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_document" }));
  });

  test("rejects a header-and-EOF pseudo-PDF that has no renderable structure", async () => {
    const { client } = fakeSupabase();
    const pseudoBytes = Buffer.from("%PDF-1.4\nThis is not a PDF object graph.\n%%EOF", "utf8");
    const candidate = invoice({
      document: {
        fileName: "INV-10482.pdf",
        mediaType: "application/pdf",
        contentBase64: pseudoBytes.toString("base64"),
        sha256: createHash("sha256").update(pseudoBytes).digest("hex"),
      },
    });

    const result = await validateInvoice(client as never, candidate);

    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "invalid_document" }));
  });

  test("submits a fully valid batch through one transactional RPC", async () => {
    const { client, calls } = fakeSupabase();
    const result = await submitInvoiceBatch(client as never, "demo-batch-20260829", [invoice()]);
    expect(result).toEqual({ batchId: "batch-1", items: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({ name: "submit_invoice_batch" }));
  });

  test("lets an identical retry reach the idempotent transaction without duplicate preflight", async () => {
    const existing = {
      batchId: "batch-existing",
      items: [{ invoiceNumber: "INV-10482", portalReference: "ACME-20260829-ABCDEF12" }],
    };
    const calls: Array<{ name: string; args: unknown }> = [];
    const client = {
      from() {
        throw new Error("Submission retries must not run a duplicate preflight query");
      },
      rpc(name: string, args: unknown) {
        calls.push({ name, args });
        return Promise.resolve({ data: existing, error: null });
      },
    };

    const result = await submitInvoiceBatch(client as never, "demo-batch-20260829", [invoice()]);

    expect(result).toEqual(existing);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({ name: "submit_invoice_batch" }));
  });

  test("loads one invoice status through the supplier-scoped read function", async () => {
    const calls: string[] = [];
    const eventScopes: unknown[][] = [];
    const row = {
      invoice_number: "INV-10482",
      portal_reference: "ACME-20260829-ABCDEF12",
      amount_minor: 1_842_000,
      currency: "USD",
      status: "paid",
      created_at: "2026-08-29T07:00:00.000Z",
      purchase_order_number: "PO-8821",
      settlement_expected_at: "2026-08-29T07:00:10.000Z",
      paid_at: "2026-08-29T07:00:10.000Z",
      payment_reference: "PAY-20260829-1234ABCD",
    };
    const client = {
      rpc(name: string, args: unknown) {
        calls.push(`rpc:${name}:${JSON.stringify(args)}`);
        return Promise.resolve({ data: [row], error: null });
      },
      from(table: string) {
        const response = table === "invoice_submissions"
          ? { data: [
            { id: "submission-1", revision: 1, is_current: false },
            { id: "submission-2", revision: 2, is_current: true },
          ], error: null }
          : table === "invoice_status_events"
            ? { data: [{
              status: "voided",
              event_code: "invoice_replaced",
              message: "Invoice was superseded by revision 2.",
              actor_kind: "supplier",
              created_at: "2026-08-29T07:00:05.000Z",
            }], error: null }
            : { data: [], error: null };
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          in(_column: string, values: unknown[]) { eventScopes.push(values); return chain; },
          order() { return chain; },
          then(resolve: (value: typeof response) => unknown) { return Promise.resolve(response).then(resolve); },
        };
        return chain;
      },
    };

    const result = await getInvoiceStatus(client as never, "INV-10482");
    expect(result).toEqual({
      invoiceNumber: "INV-10482",
      portalReference: "ACME-20260829-ABCDEF12",
      purchaseOrderNumber: "PO-8821",
      amountMinor: 1_842_000,
      currency: "USD",
      status: "paid",
      createdAt: "2026-08-29T07:00:00.000Z",
      settlementExpectedAt: "2026-08-29T07:00:10.000Z",
      paidAt: "2026-08-29T07:00:10.000Z",
      paymentReference: "PAY-20260829-1234ABCD",
      revision: 2,
      timeline: [{
        status: "voided",
        eventCode: "invoice_replaced",
        message: "Invoice was superseded by revision 2.",
        actorKind: "supplier",
        createdAt: "2026-08-29T07:00:05.000Z",
      }, {
        status: "paid",
        eventCode: "payment_completed",
        message: "Payment completed with reference PAY-20260829-1234ABCD.",
        actorKind: "system",
        createdAt: "2026-08-29T07:00:10.000Z",
      }],
      exceptions: [],
      inquiries: [],
    });
    expect(calls).toEqual([
      'rpc:get_invoice_submission_statuses:{"p_invoice_number":"INV-10482"}',
    ]);
    expect(eventScopes).toEqual([["submission-1", "submission-2"]]);
  });
});
