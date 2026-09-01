import { z } from "zod";

import {
  exceptionResponseRequestSchema,
  invoiceCandidateSchema,
  replacementInvoiceRequestSchema,
  submitBatchRequestSchema,
} from "./submissions";

export const DOCUMENT_APPROVAL_HEADER = "X-OpenFinance-Document-Approval";

const idempotencyKeySchema = z.string().min(16).max(128);
const documentMetadataSchema = z.object({
  fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/),
  mediaType: z.literal("application/pdf"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const invoiceMetadataSchema = invoiceCandidateSchema.omit({ document: true }).extend({
  document: documentMetadataSchema,
}).strict();
const supportingDocumentMetadataSchema = documentMetadataSchema.extend({
  documentKind: z.enum(["proof_of_delivery", "service_acceptance", "timesheet", "tax_document", "contract", "other"]),
}).strict();

export const documentSubmissionManifestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit_invoice_batch"),
    invoices: z.array(invoiceMetadataSchema).min(1).max(3),
  }).strict(),
  z.object({
    action: z.literal("respond_to_invoice_exception"),
    invoiceNumber: z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/),
    exceptionCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
    message: z.string().min(1).max(1000),
    attachments: z.array(supportingDocumentMetadataSchema).max(3),
  }).strict(),
  z.object({
    action: z.literal("replace_rejected_invoice"),
    invoice: invoiceMetadataSchema,
  }).strict(),
]);

export const requestDocumentSubmissionApprovalSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  initiatedBy: z.enum(["agent", "human"]),
  manifest: documentSubmissionManifestSchema,
}).strict();

export const decideDocumentSubmissionApprovalSchema = z.object({
  approvalId: z.uuid(),
  decision: z.enum(["approved", "denied"]),
}).strict();

export type DocumentSubmissionManifest = z.infer<typeof documentSubmissionManifestSchema>;
export type DocumentSubmissionApprovalRequest = z.infer<typeof requestDocumentSubmissionApprovalSchema>;
export type DocumentSubmissionApprovalInitiator = DocumentSubmissionApprovalRequest["initiatedBy"];

function documentMetadata(document: {
  fileName: string;
  mediaType: "application/pdf";
  sha256: string;
}) {
  return {
    fileName: document.fileName,
    mediaType: document.mediaType,
    sha256: document.sha256,
  };
}

function invoiceMetadata(invoice: z.infer<typeof invoiceCandidateSchema>) {
  return {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    amountMinor: invoice.amountMinor,
    currency: invoice.currency,
    purchaseOrderNumber: invoice.purchaseOrderNumber,
    document: documentMetadata(invoice.document),
  };
}

export function submissionApprovalRequest(
  input: z.infer<typeof submitBatchRequestSchema>,
  initiatedBy: DocumentSubmissionApprovalInitiator,
): DocumentSubmissionApprovalRequest {
  return {
    idempotencyKey: input.idempotencyKey,
    initiatedBy,
    manifest: {
      action: "submit_invoice_batch",
      invoices: input.invoices.map(invoiceMetadata),
    },
  };
}

export function exceptionResponseApprovalRequest(
  input: z.infer<typeof exceptionResponseRequestSchema>,
  initiatedBy: DocumentSubmissionApprovalInitiator,
): DocumentSubmissionApprovalRequest {
  return {
    idempotencyKey: input.idempotencyKey,
    initiatedBy,
    manifest: {
      action: "respond_to_invoice_exception",
      invoiceNumber: input.invoiceNumber,
      exceptionCode: input.exceptionCode,
      message: input.message,
      attachments: input.attachments.map((attachment) => ({
        documentKind: attachment.documentKind,
        ...documentMetadata(attachment),
      })),
    },
  };
}

export function replacementApprovalRequest(
  input: z.infer<typeof replacementInvoiceRequestSchema>,
  initiatedBy: DocumentSubmissionApprovalInitiator,
): DocumentSubmissionApprovalRequest {
  return {
    idempotencyKey: input.idempotencyKey,
    initiatedBy,
    manifest: {
      action: "replace_rejected_invoice",
      invoice: invoiceMetadata(input.invoice),
    },
  };
}
