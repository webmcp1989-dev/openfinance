import { describe, expect, mock, test } from "bun:test";

const pdfBytes = new TextEncoder().encode("%PDF-1.4\nverified download\n%%EOF");
let authenticatedCalls = 0;
let documentCalls: string[] = [];

mock.module("@/lib/http", () => ({
  requireAuthenticatedClient: async () => {
    authenticatedCalls += 1;
    return { authenticated: true };
  },
  apiError: () => Response.json(
    { error: { code: "internal_error", message: "The request could not be completed" } },
    { status: 500 },
  ),
}));

mock.module("@/lib/services/invoice-service", () => ({
  getInvoiceDocument: async (_client: unknown, invoiceNumber: string) => {
    documentCalls.push(invoiceNumber);
    return {
      fileName: `${invoiceNumber}.pdf`,
      mediaType: "application/pdf",
      sha256: "a".repeat(64),
      bytes: pdfBytes,
    };
  },
}));

const { GET } = await import("./route");

describe("authenticated invoice PDF download", () => {
  test("returns exact verified bytes with private download headers", async () => {
    authenticatedCalls = 0;
    documentCalls = [];

    const response = await GET(
      new Request("https://openfinance-ar.vercel.app/api/agent/invoices/INV-10482/document"),
      { params: Promise.resolve({ invoiceNumber: "INV-10482" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="INV-10482.pdf"');
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-invoice-document-sha256")).toBe("a".repeat(64));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdfBytes);
    expect(authenticatedCalls).toBe(1);
    expect(documentCalls).toEqual(["INV-10482"]);
  });

  test("authenticates before rejecting a malformed invoice number", async () => {
    authenticatedCalls = 0;
    documentCalls = [];

    const response = await GET(
      new Request("https://openfinance-ar.vercel.app/api/agent/invoices/invalid/document"),
      { params: Promise.resolve({ invoiceNumber: "invalid" }) },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(authenticatedCalls).toBe(1);
    expect(documentCalls).toEqual([]);
  });
});
