import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { listAuditEvents } from "@/lib/services/audit-service";
import { listInvoiceQueue } from "@/lib/services/invoice-service";

export async function GET() {
  try {
    const supabase = await requireAuthenticatedClient();
    const [invoices, auditEvents] = await Promise.all([
      listInvoiceQueue(supabase),
      listAuditEvents(supabase),
    ]);
    return Response.json(
      { invoices, auditEvents },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
