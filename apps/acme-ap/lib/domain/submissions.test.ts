import { describe, expect, test } from "bun:test";

import { invoiceCandidateSchema, submitBatchRequestSchema } from "./submissions";

const candidate = {
  invoiceNumber: "INV-10482",
  invoiceDate: "2026-08-12",
  amountMinor: 1_842_000,
  currency: "USD",
  purchaseOrderNumber: "PO-8821",
  document: {
    fileName: "INV-10482.pdf",
    mediaType: "application/pdf",
    contentBase64: "JVBERi0xLjQK",
    sha256: "a".repeat(64),
  },
} as const;

describe("Acme submission request contracts", () => {
  test("rejects duplicate invoice numbers before business processing", () => {
    const parsed = submitBatchRequestSchema.safeParse({
      idempotencyKey: "batch-20260829-0001",
      invoices: [candidate, { ...candidate, purchaseOrderNumber: "PO-8844" }],
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects extra fields and malformed business identifiers", () => {
    expect(invoiceCandidateSchema.safeParse({ ...candidate, supplierId: "caller-controlled" }).success).toBe(false);
    expect(invoiceCandidateSchema.safeParse({ ...candidate, purchaseOrderNumber: "../../PO" }).success).toBe(false);
  });

  test("bounds encoded document size at the process boundary", () => {
    const oversized = { ...candidate, document: { ...candidate.document, contentBase64: "A".repeat(1_400_001) } };
    expect(invoiceCandidateSchema.safeParse(oversized).success).toBe(false);
  });

  test("bounds a submission request below the deployment payload limit", () => {
    const invoices = [1, 2, 3, 4].map((index) => ({
      ...candidate,
      invoiceNumber: `INV-${index}`,
    }));
    expect(submitBatchRequestSchema.safeParse({
      idempotencyKey: "batch-20260829-limit",
      invoices,
    }).success).toBe(false);
  });
});
