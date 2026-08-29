import type { NextRequest } from "next/server";
import { z } from "zod";

import { invoiceExceptionRequestSchema } from "@/lib/domain/submissions";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { getInvoiceExceptions } from "@/lib/services/submission-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = invoiceExceptionRequestSchema.parse(await request.json());
    const result = await getInvoiceExceptions(supabase, body.invoiceNumber);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Request body is invalid" } }, { status: 400 });
    return apiError(error);
  }
}
