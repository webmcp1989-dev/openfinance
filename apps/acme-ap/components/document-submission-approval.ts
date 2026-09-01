"use client";

import { apiRequest } from "@/lib/browser-api";
import type {
  DocumentSubmissionApprovalInitiator,
  DocumentSubmissionApprovalRequest,
  DocumentSubmissionManifest,
} from "@/lib/domain/document-approvals";

export const ACME_DOCUMENT_APPROVAL_EVENT = "acme:document-approval-requested";

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

  let decide!: (decision: "approved" | "denied") => void;
  const decision = new Promise<"approved" | "denied">((resolve) => { decide = resolve; });
  const timeout = window.setTimeout(() => decide("denied"), Math.max(0, Date.parse(prepared.expiresAt) - Date.now()));
  const abort = () => decide("denied");
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
    await apiRequest("/api/agent/document-approvals", {
      method: "PATCH",
      body: JSON.stringify({ approvalId: prepared.approvalId, decision: selectedDecision }),
    });
    if (selectedDecision === "denied") {
      throw cancellationError(signal?.aborted
        ? "Document submission was cancelled. Nothing was sent."
        : "Human approval was denied or expired. Nothing was sent.");
    }
    return prepared.approvalId;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    activeApprovalId = null;
  }
}
