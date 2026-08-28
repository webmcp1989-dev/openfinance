import { apiError, requireAuthenticatedClient } from "@/lib/http";
import { getRequirements } from "@/lib/services/submission-service";

export async function GET() {
  try {
    const supabase = await requireAuthenticatedClient();
    const requirements = await getRequirements(supabase);
    return Response.json(requirements, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
