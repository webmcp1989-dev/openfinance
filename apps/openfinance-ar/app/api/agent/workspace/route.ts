import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { loadAuditSnapshot } from "@/lib/services/audit-service";
import {
  listInvoicePaymentSummaries,
  listInvoiceQueue,
  listPortalFollowups,
  listRecentPortalResolutions,
  listRecordedBuyerCases,
} from "@/lib/services/invoice-service";

export async function GET() {
  try {
    const supabase = await requireAuthenticatedClient();
    const [invoices, followups, buyerCases, recentResolutions, paymentSummaries, auditSnapshot] = await Promise.all([
      listInvoiceQueue(supabase),
      listPortalFollowups(supabase),
      listRecordedBuyerCases(supabase),
      listRecentPortalResolutions(supabase),
      listInvoicePaymentSummaries(supabase),
      loadAuditSnapshot(supabase),
    ]);
    return Response.json(
      { invoices, followups, buyerCases, recentResolutions, paymentSummaries, ...auditSnapshot },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
