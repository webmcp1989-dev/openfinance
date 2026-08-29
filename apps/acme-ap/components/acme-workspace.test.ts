import { describe, expect, test } from "bun:test";

import type { SubmissionRequirements } from "@/lib/domain/submissions";
import { fileDocument } from "./acme-workspace";

const requirements: SubmissionRequirements = {
  acceptedMediaTypes: ["application/pdf"],
  enforceRemainingBalance: true,
  maxDocumentBytes: 1_048_576,
  requireOpenPurchaseOrder: true,
  uniqueInvoiceNumberRequired: true,
};

describe("human invoice file preparation", () => {
  test("accepts a .pdf when the browser omits its MIME type", async () => {
    const file = new File(["%PDF-1.4\n%%EOF\n"], "INV-1.pdf", { type: "" });

    const document = await fileDocument(file, requirements);

    expect(document.fileName).toBe("INV-1.pdf");
    expect(document.mediaType).toBe("application/pdf");
    expect(document.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test("does not apply the MIME fallback to a non-PDF filename", async () => {
    const file = new File(["not a PDF"], "invoice.txt", { type: "" });

    await expect(fileDocument(file, requirements)).rejects.toThrow("Choose a PDF invoice document.");
  });
});
