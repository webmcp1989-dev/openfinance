import { z } from "zod";

import { invoiceDocumentParamsSchema } from "@/lib/domain/invoices";
import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { getInvoiceDocument } from "@/lib/services/invoice-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ invoiceNumber: string }> },
) {
  try {
    const supabase = await requireAuthenticatedClient();
    const { invoiceNumber } = invoiceDocumentParamsSchema.parse(await context.params);
    const document = await getInvoiceDocument(supabase, invoiceNumber);
    const ownedBytes = new Uint8Array(document.bytes.byteLength);
    ownedBytes.set(document.bytes);
    const body = new Blob([ownedBytes.buffer], { type: document.mediaType });

    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${document.fileName}"`,
        "Content-Length": String(document.bytes.byteLength),
        "Content-Type": document.mediaType,
        "X-Invoice-Document-SHA256": document.sha256,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: { code: "invalid_request", message: "Invoice number is invalid" } },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
