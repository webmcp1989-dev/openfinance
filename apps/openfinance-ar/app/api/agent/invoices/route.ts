import { z } from "zod";

import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { listInvoiceQueue } from "@/lib/services/invoice-service";

const querySchema = z.object({
  customerName: z.string().min(1).max(160),
  readyOnly: z.enum(["true", "false"]).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    const supabase = await requireAuthenticatedClient();
    const items = await listInvoiceQueue(supabase, {
      customerName: query.customerName,
      readyOnly: query.readyOnly === "true",
    });
    return Response.json({ items, count: items.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: { code: "invalid_query", message: "Query parameters are invalid" } }, { status: 400 });
    }
    return apiError(error);
  }
}
