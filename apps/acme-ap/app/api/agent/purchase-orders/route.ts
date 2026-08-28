import type { NextRequest } from "next/server";
import { z } from "zod";

import { purchaseOrderRequestSchema } from "@/lib/domain/submissions";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { findPurchaseOrder } from "@/lib/services/submission-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const body = purchaseOrderRequestSchema.parse(await request.json());
    const supabase = await requireAuthenticatedClient();
    const purchaseOrder = await findPurchaseOrder(supabase, body.purchaseOrderNumber);
    return Response.json({ found: purchaseOrder !== null, purchaseOrder }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Request body is invalid" } }, { status: 400 });
    return apiError(error);
  }
}
