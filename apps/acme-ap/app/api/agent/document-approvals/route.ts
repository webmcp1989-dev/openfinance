import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  decideDocumentSubmissionApprovalSchema,
  requestDocumentSubmissionApprovalSchema,
} from "@/lib/domain/document-approvals";
import { apiError, requireAuthenticatedClient, requireSameOriginJson } from "@/lib/http";
import {
  decideDocumentSubmissionApproval,
  requestDocumentSubmissionApproval,
} from "@/lib/services/submission-service";

export async function POST(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = requestDocumentSubmissionApprovalSchema.parse(await request.json());
    const result = await requestDocumentSubmissionApproval(supabase, body);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: { code: "invalid_request", message: "Document approval fields are invalid" } }, { status: 400 });
    }
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    requireSameOriginJson(request);
    const supabase = await requireAuthenticatedClient();
    const body = decideDocumentSubmissionApprovalSchema.parse(await request.json());
    const result = await decideDocumentSubmissionApproval(supabase, body.approvalId, body.decision);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: { code: "invalid_request", message: "Document approval decision is invalid" } }, { status: 400 });
    }
    return apiError(error);
  }
}
