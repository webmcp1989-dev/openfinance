import { z } from "zod";

import { MAX_TRANSFER_INVOICE_COUNT } from "./transfer-limits";

const invoiceNumber = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/);
const purchaseOrderNumber = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const idempotencyKey = z.string().min(16).max(128);

export const documentSchema = z.object({
  fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/),
  mediaType: z.literal("application/pdf"),
  contentBase64: z.string().min(8).max(1_400_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  sha256,
}).strict();

export const invoiceCandidateSchema = z.object({
  invoiceNumber,
  invoiceDate: z.iso.date(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  purchaseOrderNumber,
  document: documentSchema,
}).strict();

export const validateInvoiceRequestSchema = invoiceCandidateSchema;

export const submitBatchRequestSchema = z.object({
  idempotencyKey,
  invoices: z.array(invoiceCandidateSchema).min(1).max(MAX_TRANSFER_INVOICE_COUNT).refine(
    (items) => new Set(items.map((item) => item.invoiceNumber)).size === items.length,
    "Invoice numbers must be unique",
  ),
}).strict();

export const purchaseOrderRequestSchema = z.object({ purchaseOrderNumber }).strict();
export const statusRequestSchema = z.object({ invoiceNumber }).strict();

export const invoiceExceptionRequestSchema = z.object({ invoiceNumber }).strict();

const supportingDocumentSchema = documentSchema.extend({
  documentKind: z.enum(["proof_of_delivery", "service_acceptance", "timesheet", "tax_document", "contract", "other"]),
}).strict();

export const exceptionResponseRequestSchema = z.object({
  idempotencyKey,
  invoiceNumber,
  exceptionCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  message: z.string().min(1).max(1000),
  attachments: z.array(supportingDocumentSchema).max(3).default([]),
}).strict();

export const replacementInvoiceRequestSchema = z.object({
  idempotencyKey,
  invoice: invoiceCandidateSchema,
}).strict();

export const invoiceInquiryRequestSchema = z.object({
  idempotencyKey,
  invoiceNumber,
  inquiryType: z.enum(["payment_inquiry", "invoice_inquiry", "expedite_payment", "payment_terms", "invoice_entry_assistance"]),
  subject: z.string().min(1).max(160),
  message: z.string().min(1).max(1000),
}).strict();

export const paymentRemittanceRequestSchema = z.object({ invoiceNumber }).strict();

export type InvoiceCandidate = z.infer<typeof invoiceCandidateSchema>;

export type PurchaseOrder = Readonly<{
  purchaseOrderNumber: string;
  description: string;
  currency: string;
  authorizedAmountMinor: number;
  remainingAmountMinor: number;
  status: "open" | "closed";
  orderDate: string;
  paymentTerms: string;
  receiptRequired: boolean;
  receivedAmountMinor: number;
  serviceEntryRequired: boolean;
  serviceEntryStatus: "not_required" | "missing" | "pending" | "accepted" | "rejected";
  priceToleranceBasisPoints: number;
  amountToleranceMinor: number;
  requiredAttachmentKinds: string[];
  lines: ReadonlyArray<Readonly<{
    lineNumber: number;
    description: string;
    unitOfMeasure: string;
    orderedQuantity: number;
    receivedQuantity: number;
    unitPriceMinor: number;
    lineAmountMinor: number;
    invoicedAmountMinor: number;
  }>>;
  version: number;
}>;

export type SubmissionRequirements = Readonly<{
  acceptedMediaTypes: string[];
  maxDocumentBytes: number;
  requireOpenPurchaseOrder: boolean;
  enforceRemainingBalance: boolean;
  uniqueInvoiceNumberRequired: boolean;
}>;

export type ValidationIssue = Readonly<{
  code: "purchase_order_not_found" | "purchase_order_closed" | "currency_mismatch" |
    "amount_exceeds_remaining_balance" | "duplicate_invoice" | "invalid_document" |
    "missing_receipt" | "service_entry_not_accepted";
  message: string;
}>;

export type InvoiceException = Readonly<{
  exceptionCode: string;
  category: "supplier_data" | "purchase_order" | "receiving" | "tax" | "document" | "duplicate" | "payment" | "other";
  owner: "supplier_ar" | "buyer_ap" | "buyer_procurement" | "buyer_receiving" | "shared";
  status: "open" | "responded" | "resolved" | "cancelled";
  message: string;
  resolutionGuidance: string;
  allowedActions: string[];
  requiredDocumentKind: string | null;
  supplierCanResolve: boolean;
  authorityBoundary: string;
  createdAt: string;
  updatedAt: string;
}>;

export type InvoiceTimelineEvent = Readonly<{
  status: string;
  eventCode: string;
  message: string;
  actorKind: "supplier" | "buyer" | "system";
  createdAt: string;
}>;
