import type { NextRequest } from "next/server";
import { z } from "zod";

import { packageRequestSchema } from "@/lib/domain/invoices";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { getSubmissionPackage } from "@/lib/services/invoice-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const body = packageRequestSchema.parse(await request.json());
    const supabase = await requireAuthenticatedClient();
    const items = await getSubmissionPackage(supabase, body.invoiceNumbers);
    return Response.json({ items, count: items.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: { code: "invalid_request", message: "Request body is invalid" } }, { status: 400 });
    }
    return apiError(error);
  }
}
