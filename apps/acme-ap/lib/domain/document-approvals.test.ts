import { describe, expect, test } from "bun:test";

import {
  documentSubmissionManifestSchema,
  exceptionResponseApprovalRequest,
  replacementApprovalRequest,
  submissionApprovalRequest,
} from "./document-approvals";

const document = {
  fileName: "INV-10482.pdf",
  mediaType: "application/pdf" as const,
  contentBase64: "JVBERi0xLjQK",
  sha256: "a".repeat(64),
};
const invoice = {
  invoiceNumber: "INV-10482",
  invoiceDate: "2026-08-12",
  amountMinor: 1_842_000,
  currency: "USD",
  purchaseOrderNumber: "PO-8821",
  document,
};

describe("AP document approval manifests", () => {
  test("binds batch consent to exact invoice metadata without copying PDF bytes", () => {
    const request = submissionApprovalRequest({
      idempotencyKey: "approval-batch-20260901",
      invoices: [invoice],
    }, "agent");

    expect(request.manifest).toEqual({
      action: "submit_invoice_batch",
      invoices: [{
        ...invoice,
        document: {
          fileName: document.fileName,
          mediaType: document.mediaType,
          sha256: document.sha256,
        },
      }],
    });
    expect(JSON.stringify(request)).not.toContain("contentBase64");
  });

  test("binds exception consent to the exact message and attachment kinds", () => {
    const request = exceptionResponseApprovalRequest({
      idempotencyKey: "approval-response-20260901",
      invoiceNumber: "INV-10417",
      exceptionCode: "missing_delivery_proof",
      message: "Verified delivery proof attached.",
      attachments: [{ ...document, documentKind: "proof_of_delivery" }],
    }, "agent");

    expect(request.manifest).toEqual(expect.objectContaining({
      action: "respond_to_invoice_exception",
      invoiceNumber: "INV-10417",
      message: "Verified delivery proof attached.",
      attachments: [expect.objectContaining({ documentKind: "proof_of_delivery", sha256: document.sha256 })],
    }));
    expect(JSON.stringify(request)).not.toContain("contentBase64");
  });

  test("binds replacement consent to the complete corrected invoice", () => {
    const request = replacementApprovalRequest({
      idempotencyKey: "approval-replacement-20260901",
      invoice,
    }, "human");

    expect(request.manifest).toEqual(expect.objectContaining({
      action: "replace_rejected_invoice",
      invoice: expect.objectContaining({ invoiceNumber: "INV-10482", amountMinor: 1_842_000 }),
    }));
    expect(JSON.stringify(request)).not.toContain("contentBase64");
  });

  test("rejects a manifest that attempts to smuggle document bytes or extra authority fields", () => {
    expect(documentSubmissionManifestSchema.safeParse({
      action: "replace_rejected_invoice",
      invoice: {
        ...invoice,
        supplierId: "caller-controlled",
      },
    }).success).toBe(false);
  });
});
