import type { NextRequest } from "next/server";
import { z } from "zod";

import { erpSyncRequestSchema } from "@/lib/domain/invoices";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { syncInvoicesFromErp } from "@/lib/services/invoice-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = erpSyncRequestSchema.parse(await request.json());
    const result = await syncInvoicesFromErp(supabase, body.idempotencyKey);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: { code: "invalid_request", message: "Sync request is invalid" } },
        { status: 400 },
      );
    }
    return apiError(error);
  }
}
