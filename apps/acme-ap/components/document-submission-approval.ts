"use client";

import { apiRequest } from "@/lib/browser-api";
import type {
  DocumentSubmissionApprovalInitiator,
  DocumentSubmissionApprovalRequest,
  DocumentSubmissionManifest,
} from "@/lib/domain/document-approvals";

export const ACME_DOCUMENT_APPROVAL_EVENT = "acme:document-approval-requested";
export const ACME_DOCUMENT_APPROVAL_SETTLED_EVENT = "acme:document-approval-settled";

export type PendingDocumentSubmissionApproval = Readonly<{
  approvalId: string;
  expiresAt: string;
  initiatedBy: DocumentSubmissionApprovalInitiator;
  manifest: DocumentSubmissionManifest;
  decide: (decision: "approved" | "denied") => void;
}>;

type PreparedApproval = Readonly<{
  approvalId: string;
  status: "pending";
  expiresAt: string;
}>;

type ApprovalOutcome = "approved" | "denied" | "expired" | "cancelled";

let activeApprovalId: string | null = null;

function cancellationError(message: string) {
  return new DOMException(message, "AbortError");
}

export async function obtainDocumentSubmissionApproval(
  request: DocumentSubmissionApprovalRequest,
  signal?: AbortSignal,
) {
  if (activeApprovalId) throw new Error("Another document approval is already waiting for review.");
  if (signal?.aborted) throw cancellationError("Document submission was cancelled before approval.");

  const prepared = await apiRequest<PreparedApproval>("/api/agent/document-approvals", {
    method: "POST",
    body: JSON.stringify(request),
    signal,
  });
  activeApprovalId = prepared.approvalId;

  let decide!: (decision: ApprovalOutcome) => void;
  const decision = new Promise<ApprovalOutcome>((resolve) => { decide = resolve; });
  const timeout = window.setTimeout(() => decide("expired"), Math.max(0, Date.parse(prepared.expiresAt) - Date.now()));
  const abort = () => decide("cancelled");
  signal?.addEventListener("abort", abort, { once: true });

  window.dispatchEvent(new CustomEvent<PendingDocumentSubmissionApproval>(ACME_DOCUMENT_APPROVAL_EVENT, {
    detail: {
      approvalId: prepared.approvalId,
      expiresAt: prepared.expiresAt,
      initiatedBy: request.initiatedBy,
      manifest: request.manifest,
      decide,
    },
  }));

  try {
    const selectedDecision = await decision;
    if (selectedDecision === "approved" || selectedDecision === "denied") {
      await apiRequest("/api/agent/document-approvals", {
        method: "PATCH",
        body: JSON.stringify({ approvalId: prepared.approvalId, decision: selectedDecision }),
      });
    }
    if (selectedDecision !== "approved") {
      const message = selectedDecision === "expired"
        ? "Human approval expired. Nothing was sent."
        : selectedDecision === "cancelled"
          ? "Document submission was cancelled. Nothing was sent."
          : "Human approval was denied. Nothing was sent.";
      throw cancellationError(message);
    }
    return prepared.approvalId;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    window.dispatchEvent(new CustomEvent(ACME_DOCUMENT_APPROVAL_SETTLED_EVENT, {
      detail: { approvalId: prepared.approvalId },
    }));
    activeApprovalId = null;
  }
}
