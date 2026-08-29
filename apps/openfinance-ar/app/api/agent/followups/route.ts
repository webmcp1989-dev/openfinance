import { z } from "zod";

import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { listPortalFollowups } from "@/lib/services/invoice-service";

const querySchema = z.object({
  customerName: z.string().min(1).max(160).optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const supabase = await requireAuthenticatedClient();
    const items = await listPortalFollowups(supabase, query.customerName);
    return Response.json({ items, count: items.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_query", message: "Query parameters are invalid" } }, { status: 400 });
    return apiError(error);
  }
}
