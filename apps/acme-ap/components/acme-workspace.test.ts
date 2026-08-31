import { describe, expect, test } from "bun:test";

import type { SubmissionRequirements } from "@/lib/domain/submissions";
import type { InvoiceWorkflowItem, SubmissionRow } from "@/lib/services/submission-service";
import { AP_AGENT_STARTER_PROMPT, fileDocument, filterSubmissionRows, workflowPresentation } from "./acme-workspace";

function renderStructuralPdf() {
  const prefix = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n";
  return `${prefix}xref\n0 4\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n${new TextEncoder().encode(prefix).length}\n%%EOF\n`;
}

const requirements: SubmissionRequirements = {
  acceptedMediaTypes: ["application/pdf"],
  enforceRemainingBalance: true,
  maxDocumentBytes: 1_048_576,
  requireOpenPurchaseOrder: true,
  uniqueInvoiceNumberRequired: true,
};

describe("human invoice file preparation", () => {
  test("accepts a .pdf when the browser omits its MIME type", async () => {
    const file = new File([renderStructuralPdf()], "INV-1.pdf", { type: "" });

    const document = await fileDocument(file, requirements);

    expect(document.fileName).toBe("INV-1.pdf");
    expect(document.mediaType).toBe("application/pdf");
    expect(document.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("rejects a non-renderable PDF-looking upload before preflight", async () => {
    const file = new File(["%PDF-1.4\nnot a document\n%%EOF\n"], "INV-1.pdf", { type: "application/pdf" });

    await expect(fileDocument(file, requirements)).rejects.toThrow("structurally valid PDF");
  });

  test("does not apply the MIME fallback to a non-PDF filename", async () => {
    const file = new File(["not a PDF"], "invoice.txt", { type: "" });

    await expect(fileDocument(file, requirements)).rejects.toThrow("Choose a PDF invoice document.");
  });
});

describe("human invoice portfolio filters", () => {
  const submissions = [
    { invoiceNumber: "INV-1", purchaseOrderNumber: "PO-100", status: "received" },
    { invoiceNumber: "INV-2", purchaseOrderNumber: "PO-200", status: "paid" },
  ] as SubmissionRow[];

  test("combines status and normalized purchase-order filters", () => {
    expect(filterSubmissionRows(submissions, "paid", "po-2").map((item) => item.invoiceNumber)).toEqual(["INV-2"]);
  });

  test("returns the full supplier portfolio when filters are empty", () => {
    expect(filterSubmissionRows(submissions, "all", "")).toHaveLength(2);
  });
});

function workflow(overrides: Partial<InvoiceWorkflowItem> = {}): InvoiceWorkflowItem {
  return {
    invoiceNumber: "INV-10417",
    portalReference: "ACME-20260820-A1041701",
    amountMinor: 640_000,
    currency: "USD",
    invoiceStatus: "disputed",
    exception: {
      exceptionCode: "missing_delivery_proof",
      category: "document",
      owner: "supplier_ar",
      status: "open",
      message: "Proof of delivery is required.",
      resolutionGuidance: "Attach the verified proof of delivery.",
      allowedActions: ["respond_to_exception"],
      requiredDocumentKind: "proof_of_delivery",
      supplierCanResolve: true,
      authorityBoundary: "Supplier owns this blocker.",
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    },
    latestInquiry: null,
    ...overrides,
  };
}

describe("visible exception workflow states", () => {
  test("shows an unresolved supplier blocker as action required", () => {
    expect(workflowPresentation(workflow())).toEqual(expect.objectContaining({
      label: "Action required",
      owner: "Supplier",
      tone: "action-required",
    }));
  });

  test("shows a verified resolved exception as approved", () => {
    expect(workflowPresentation(workflow({
      invoiceStatus: "accepted",
      exception: { ...workflow().exception, status: "resolved" },
    }))).toEqual(expect.objectContaining({
      label: "Approved",
      title: "Required evidence verified",
      tone: "approved",
    }));
  });

  test("keeps a buyer-owned blocker on hold while showing its real case", () => {
    expect(workflowPresentation(workflow({
      invoiceNumber: "INV-10463",
      exception: {
        ...workflow().exception,
        owner: "buyer_receiving",
        exceptionCode: "missing_goods_receipt",
        supplierCanResolve: false,
      },
      latestInquiry: {
        caseReference: "CASE-20260831-ABCDEF12",
        status: "open",
        subject: "Missing receipt follow-up",
        createdAt: "2026-08-31T00:00:00.000Z",
      },
    }))).toEqual(expect.objectContaining({
      label: "Case open",
      owner: "Acme receiving",
      title: "CASE-20260831-ABCDEF12 · Awaiting buyer action",
      tone: "case-open",
    }));
  });
});

test("presents the canonical short instruction for starting the agent workflow", () => {
  expect(AP_AGENT_STARTER_PROMPT).toBe(
    "Use the Acme Supplier Portal at https://openfinance-ap.vercel.app to review and process my invoices.",
  );
  expect(AP_AGENT_STARTER_PROMPT).not.toContain("OpenFinance AR");
});
