const PDF_HEADER = new TextEncoder().encode("%PDF-");
const XREF = new TextEncoder().encode("xref");
const decoder = new TextDecoder("latin1");

function startsWith(bytes: Uint8Array, expected: Uint8Array) {
  return bytes.length >= expected.length && expected.every((value, index) => bytes[index] === value);
}

/**
 * Performs a bounded structural check for the classic PDF 1.x profile that
 * OpenFinance generates and accepts. This is deliberately not a PDF parser:
 * authoritative SQL checks the same invariants before persistence.
 */
export function hasStructuralPdf(bytes: Uint8Array) {
  if (!startsWith(bytes, PDF_HEADER)) return false;

  const text = decoder.decode(bytes);
  if (!/\/Type\s*\/Catalog\b/.test(text) || !/\/Type\s*\/Page\b/.test(text)) return false;

  const match = /startxref\s+(\d{1,7})\s+%%EOF\s*$/.exec(text);
  if (!match) return false;

  const xrefOffset = Number(match[1]);
  return Number.isSafeInteger(xrefOffset)
    && xrefOffset >= 0
    && xrefOffset + XREF.length <= bytes.length
    && XREF.every((value, index) => bytes[xrefOffset + index] === value);
}
