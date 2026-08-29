import type { NextRequest } from "next/server";
import { z } from "zod";

import { statusRequestSchema } from "@/lib/domain/submissions";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { getInvoiceStatus } from "@/lib/services/submission-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = statusRequestSchema.parse(await request.json());
    const submission = await getInvoiceStatus(supabase, body.invoiceNumber);
    return Response.json({ found: submission !== null, submission }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Request body is invalid" } }, { status: 400 });
    return apiError(error);
  }
}
