import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { listPurchaseOrders, listSubmissions } from "@/lib/services/submission-service";

export async function GET() {
  try {
    const supabase = await requireAuthenticatedClient();
    const [purchaseOrders, submissions] = await Promise.all([
      listPurchaseOrders(supabase), listSubmissions(supabase),
    ]);
    return Response.json({ purchaseOrders, submissions }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
