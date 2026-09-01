import type { NextRequest } from "next/server";
import { z } from "zod";

import { submitBatchRequestSchema } from "@/lib/domain/submissions";
import { apiError, requireAuthenticatedClient, requireDocumentApprovalId, requireSameOriginJson } from "@/lib/http";
import { submitInvoiceBatch } from "@/lib/services/submission-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const approvalId = requireDocumentApprovalId(request);
    const body = submitBatchRequestSchema.parse(await request.json());
    const result = await submitInvoiceBatch(supabase, body.idempotencyKey, body.invoices, approvalId);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Submission fields are invalid" } }, { status: 400 });
    return apiError(error);
  }
}
