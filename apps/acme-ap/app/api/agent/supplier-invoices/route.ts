import { z } from "zod";

import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { listSupplierInvoices } from "@/lib/services/submission-service";

const querySchema = z.object({
  status: z.enum(["received", "under_review", "accepted", "rejected", "disputed", "voided", "paid"]).optional(),
  purchaseOrderNumber: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/).optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const supabase = await requireAuthenticatedClient();
    const invoices = await listSupplierInvoices(supabase, query);
    return Response.json({ invoices, count: invoices.length }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: { code: "invalid_query", message: "Invoice filters are invalid" } }, { status: 400 });
    return apiError(error);
  }
}
