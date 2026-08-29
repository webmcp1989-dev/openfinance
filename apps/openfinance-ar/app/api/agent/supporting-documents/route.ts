import type { NextRequest } from "next/server";
import { z } from "zod";

import { supportingDocumentsRequestSchema } from "@/lib/domain/invoices";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { getInvoiceSupportingDocuments } from "@/lib/services/invoice-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = supportingDocumentsRequestSchema.parse(await request.json());
    const documents = await getInvoiceSupportingDocuments(supabase, body.invoiceNumber);
    return Response.json({ invoiceNumber: body.invoiceNumber, documents, count: documents.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Request body is invalid" } }, { status: 400 });
    return apiError(error);
  }
}
