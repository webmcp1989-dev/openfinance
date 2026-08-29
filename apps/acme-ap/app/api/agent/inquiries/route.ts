import type { NextRequest } from "next/server";
import { z } from "zod";

import { invoiceInquiryRequestSchema } from "@/lib/domain/submissions";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { createInvoiceInquiry } from "@/lib/services/submission-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = invoiceInquiryRequestSchema.parse(await request.json());
    const result = await createInvoiceInquiry(supabase, body);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Inquiry fields are invalid" } }, { status: 400 });
    return apiError(error);
  }
}
