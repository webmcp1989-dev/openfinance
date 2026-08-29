import type { NextRequest } from "next/server";
import { z } from "zod";

import { replacementInvoiceRequestSchema } from "@/lib/domain/submissions";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { replaceRejectedInvoice } from "@/lib/services/submission-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = replacementInvoiceRequestSchema.parse(await request.json());
    const result = await replaceRejectedInvoice(supabase, body.idempotencyKey, body.invoice);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Replacement invoice fields are invalid" } }, { status: 400 });
    return apiError(error);
  }
}
