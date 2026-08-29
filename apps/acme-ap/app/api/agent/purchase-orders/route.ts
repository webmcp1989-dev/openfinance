import type { NextRequest } from "next/server";
import { z } from "zod";

import { purchaseOrderRequestSchema } from "@/lib/domain/submissions";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { findPurchaseOrder, listPurchaseOrders } from "@/lib/services/submission-service";

export async function GET() {
  try {
    const supabase = await requireAuthenticatedClient();
    const purchaseOrders = (await listPurchaseOrders(supabase)).filter((order) => order.status === "open");
    return Response.json({ purchaseOrders, count: purchaseOrders.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = purchaseOrderRequestSchema.parse(await request.json());
    const purchaseOrder = await findPurchaseOrder(supabase, body.purchaseOrderNumber);
    return Response.json({ found: purchaseOrder !== null, purchaseOrder }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_request", message: "Request body is invalid" } }, { status: 400 });
    return apiError(error);
  }
}
