import { describe, expect, test } from "bun:test";

import { hasStructuralPdf } from "./pdf-structure";

function renderStructuralPdf() {
  const prefix = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n";
  return new TextEncoder().encode(`${prefix}xref\n0 4\n0000000000 65535 f \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n${new TextEncoder().encode(prefix).length}\n%%EOF\n`);
}

describe("structural PDF validation", () => {
  test("accepts OpenFinance's bounded classic PDF profile", () => {
    expect(hasStructuralPdf(renderStructuralPdf())).toBe(true);
  });

  test("rejects the former header-and-EOF-only pseudo-PDF", () => {
    expect(hasStructuralPdf(new TextEncoder().encode("%PDF-1.4\nplaceholder\n%%EOF\n"))).toBe(false);
  });

  test("rejects a startxref offset that does not point to an xref table", () => {
    const bytes = renderStructuralPdf();
    const text = new TextDecoder().decode(bytes).replace(/startxref\n\d+/, "startxref\n0");
    expect(hasStructuralPdf(new TextEncoder().encode(text))).toBe(false);
  });

  test("does not treat a page tree as a renderable page", () => {
    const bytes = renderStructuralPdf();
    const text = new TextDecoder().decode(bytes).replace("/Type /Page /Parent", "/Type /Pages /Parent");
    expect(hasStructuralPdf(new TextEncoder().encode(text))).toBe(false);
  });
});
