import { z } from "zod";

const invoiceNumberSchema = z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,39}$/);
const idempotencyKeySchema = z.string().min(16).max(128);

export const packageRequestSchema = z.object({
  invoiceNumbers: z.array(invoiceNumberSchema).min(1).max(10).refine(
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

export const deliveryEventRequestSchema = z.discriminatedUnion("eventType", [
  z.object({
    eventType: z.literal("portal_result"),
    idempotencyKey: idempotencyKeySchema,
    items: z.array(portalResultItemSchema).min(1).max(10),
  }).strict(),
  z.object({
    eventType: z.literal("portal_exception"),
    idempotencyKey: idempotencyKeySchema,
    items: z.array(portalExceptionItemSchema).min(1).max(10),
  }).strict(),
]);

export type DeliveryEventRequest = z.infer<typeof deliveryEventRequestSchema>;

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
  version: number;
}>;

export type SubmissionPackageItem = InvoiceQueueItem & Readonly<{
  document: Readonly<{
    fileName: string;
    mediaType: "application/pdf";
    contentBase64: string;
    sha256: string;
  }>;
}>;
