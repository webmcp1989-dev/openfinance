import { z } from "zod";

import { MAX_TRANSFER_INVOICE_COUNT } from "./transfer-limits";

const invoiceNumberSchema = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/);
const idempotencyKeySchema = z.string().min(16).max(128);
const paymentReferenceSchema = z.string().min(1).max(120);

export const invoiceDocumentParamsSchema = z.object({
  invoiceNumber: invoiceNumberSchema,
}).strict();

export const erpSyncRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const packageRequestSchema = z.object({
  invoiceNumbers: z.array(invoiceNumberSchema).min(1).max(MAX_TRANSFER_INVOICE_COUNT).refine(
    (numbers) => new Set(numbers).size === numbers.length,
    "Invoice numbers must be unique",
  ),
}).strict();

const portalResultItemSchema = z.object({
  invoiceNumber: invoiceNumberSchema,
  portalReference: z.string().min(1).max(120),
  portalStatus: z.enum(["received", "under_review", "accepted"]),
}).strict();

const portalExceptionItemSchema = z.object({
  invoiceNumber: invoiceNumberSchema,
  exceptionCode: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  message: z.string().min(1).max(500),
}).strict();

const portalResultItemsSchema = z.array(portalResultItemSchema).min(1).max(10).refine(
  (items) => new Set(items.map((item) => item.invoiceNumber)).size === items.length,
  "Invoice numbers must be unique",
);

const portalExceptionItemsSchema = z.array(portalExceptionItemSchema).min(1).max(10).refine(
  (items) => new Set(items.map((item) => item.invoiceNumber)).size === items.length,
  "Invoice numbers must be unique",
);

export const deliveryEventRequestSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("portal_result"),
    idempotencyKey: idempotencyKeySchema,
    items: portalResultItemsSchema,
  }).strict(),
  z.object({
    eventType: z.literal("portal_exception"),
    idempotencyKey: idempotencyKeySchema,
    items: portalExceptionItemsSchema,
  }).strict(),
]);

export const supportingDocumentsRequestSchema = z.object({
  invoiceNumber: invoiceNumberSchema,
}).strict();

export const paymentRemittanceRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  invoiceNumber: invoiceNumberSchema,
  paymentReference: paymentReferenceSchema,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/),
  paymentMethod: z.enum(["ach", "wire", "check", "card", "other"]),
  paidAt: z.iso.datetime({ offset: true }),
}).strict();

export type DeliveryEventRequest = z.infer<typeof deliveryEventRequestSchema>;
export type ErpSyncRequest = z.infer<typeof erpSyncRequestSchema>;

export type ErpSyncResult = Readonly<{
  importedCount: number;
  items: ReadonlyArray<Readonly<{
    invoiceNumber: string;
    customerName: string;
    amountMinor: number;
    currency: string;
    purchaseOrderNumber: string | null;
  }>>;
  syncedAt: string;
}>;

export type InvoiceQueueItem = Readonly<{
  invoiceNumber: string;
  customerName: string;
  amountMinor: number;
  currency: string;
  invoiceDate: string;
  purchaseOrderNumber: string | null;
  status: "ready" | "needs_attention" | "submitted" | "accepted" | "rejected";
  portalReference: string | null;
  portalStatus: string | null;
  exceptionCode: string | null;
  exceptionMessage: string | null;
  dueDate: string;
  lastPortalCheckedAt: string | null;
  paidAmountMinor: number;
  lastPaymentAt: string | null;
  lastPaymentReference: string | null;
  version: number;
}>;

export type InvoiceSupportingDocument = Readonly<{
  documentKind: "proof_of_delivery" | "service_acceptance" | "timesheet" |
    "tax_document" | "contract" | "other";
  fileName: string;
  mediaType: "application/pdf";
  contentBase64: string;
  sha256: string;
  sizeBytes: number;
}>;

export type SubmissionPackageItem = InvoiceQueueItem & Readonly<{
  document: Readonly<{
    fileName: string;
    mediaType: "application/pdf";
    contentBase64: string;
    sha256: string;
  }>;
}>;
