import type { NextRequest } from "next/server";
import { z } from "zod";

import { validateInvoiceRequestSchema } from "@/lib/domain/submissions";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { validateInvoice } from "@/lib/services/submission-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const body = validateInvoiceRequestSchema.parse(await request.json());
    const supabase = await requireAuthenticatedClient();
    const result = await validateInvoice(supabase, body);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Invoice fields are invalid" } }, { status: 400 });
    return apiError(error);
  }
}
