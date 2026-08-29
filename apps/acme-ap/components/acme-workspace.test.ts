import { describe, expect, test } from "bun:test";

import type { SubmissionRequirements } from "@/lib/domain/submissions";
import { fileDocument } from "./acme-workspace";

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
