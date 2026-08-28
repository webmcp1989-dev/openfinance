import { createHash } from "node:crypto";
import { describe, expect, mock, test } from "bun:test";

import type { InvoiceCandidate } from "@/lib/domain/submissions";

mock.module("server-only", () => ({}));
const { submitInvoiceBatch, validateInvoice } = await import("./submission-service");

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

  test("submits a fully valid batch through one transactional RPC", async () => {
    const { client, calls } = fakeSupabase();
    const result = await submitInvoiceBatch(client as never, "demo-batch-20260829", [invoice()]);
    expect(result).toEqual({ batchId: "batch-1", items: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.objectContaining({ name: "submit_invoice_batch" }));
  });
});
