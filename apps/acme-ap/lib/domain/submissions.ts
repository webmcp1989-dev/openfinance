import { z } from "zod";

import { MAX_TRANSFER_INVOICE_COUNT } from "./transfer-limits";

const invoiceNumber = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/);
const purchaseOrderNumber = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

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
  idempotencyKey: z.string().min(16).max(128),
  invoices: z.array(invoiceCandidateSchema).min(1).max(MAX_TRANSFER_INVOICE_COUNT).refine(
    (items) => new Set(items.map((item) => item.invoiceNumber)).size === items.length,
    "Invoice numbers must be unique",
  ),
}).strict();

export const purchaseOrderRequestSchema = z.object({ purchaseOrderNumber }).strict();
export const statusRequestSchema = z.object({ invoiceNumber }).strict();

export type InvoiceCandidate = z.infer<typeof invoiceCandidateSchema>;

export type PurchaseOrder = Readonly<{
  purchaseOrderNumber: string;
  description: string;
  currency: string;
  authorizedAmountMinor: number;
  remainingAmountMinor: number;
  status: "open" | "closed";
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
    "amount_exceeds_remaining_balance" | "duplicate_invoice" | "invalid_document";
  message: string;
}>;
