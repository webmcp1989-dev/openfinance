import type { NextRequest } from "next/server";
import { z } from "zod";

import { paymentRemittanceRequestSchema } from "@/lib/domain/invoices";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { recordPaymentRemittance } from "@/lib/services/invoice-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = paymentRemittanceRequestSchema.parse(await request.json());
    const result = await recordPaymentRemittance(supabase, body);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Remittance fields are invalid" } }, { status: 400 });
    return apiError(error);
  }
}
