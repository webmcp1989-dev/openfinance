import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import { resetDemoState } from "@/lib/services/invoice-service";

const requestSchema = z.object({
  confirmation: z.literal("restore-canonical-demo"),
}).strict();

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    requestSchema.parse(await request.json());
    const result = await resetDemoState(supabase);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: { code: "invalid_confirmation", message: "Explicit demo reset confirmation is required" } },
        { status: 400 },
      );
    }
    return apiError(error);
  }
}
