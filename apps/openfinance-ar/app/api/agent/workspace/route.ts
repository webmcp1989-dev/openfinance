import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { loadAuditSnapshot } from "@/lib/services/audit-service";
import { listInvoiceQueue, listPortalFollowups } from "@/lib/services/invoice-service";

export async function GET() {
  try {
    const supabase = await requireAuthenticatedClient();
    const [invoices, followups, auditSnapshot] = await Promise.all([
      listInvoiceQueue(supabase),
      listPortalFollowups(supabase),
      loadAuditSnapshot(supabase),
    ]);
    return Response.json(
      { invoices, followups, ...auditSnapshot },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
