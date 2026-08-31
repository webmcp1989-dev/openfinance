import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { loadAuditSnapshot } from "@/lib/services/audit-service";
import { listInvoiceWorkflows, listOpenBuyerCases, listPurchaseOrders, listSubmissions } from "@/lib/services/submission-service";

export async function GET() {
  try {
    const supabase = await requireAuthenticatedClient();
    const [purchaseOrders, submissions, workflows, buyerCases, auditSnapshot] = await Promise.all([
      listPurchaseOrders(supabase),
      listSubmissions(supabase),
      listInvoiceWorkflows(supabase),
      listOpenBuyerCases(supabase),
      loadAuditSnapshot(supabase),
    ]);
    return Response.json(
      { purchaseOrders, submissions, workflows, buyerCases, ...auditSnapshot },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
