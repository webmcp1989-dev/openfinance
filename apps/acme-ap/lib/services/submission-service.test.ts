import { createHash } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";

import type { InvoiceCandidate } from "@/lib/domain/submissions";

mock.module("server-only", () => ({}));
const { getInvoiceStatus, submitInvoiceBatch, validateInvoice } = await import("./submission-service");

const documentBytes = Buffer.from("%PDF-1.4\nOpenFinance test\n%%EOF", "utf8");

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
        select() { return chain; }, eq() { return chain; },
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
  return { client, calls };
}

describe("Acme invoice validation", () => {
  test("accepts a valid checksum-protected PDF within the PO balance", async () => {
    const { client } = fakeSupabase();
    const result = await validateInvoice(client as never, invoice());
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
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
          ? { data: { id: "submission-1", revision: 1 }, error: null }
          : { data: [], error: null };
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          order() { return chain; },
          maybeSingle() { return Promise.resolve(response); },
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
      revision: 1,
      timeline: [{
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
  });
});
