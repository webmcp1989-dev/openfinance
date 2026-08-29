import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { InvoiceCandidate, PurchaseOrder, SubmissionRequirements, ValidationIssue } from "@/lib/domain/submissions";
import { fingerprint, HttpError } from "@/lib/http-core";

type PurchaseOrderRow = {
  purchase_order_number: string;
  description: string;
  currency: string;
  authorized_amount_minor: number;
  remaining_amount_minor: number;
  status: "open" | "closed";
  version: number;
};

export type SubmissionRow = Readonly<{
  invoiceNumber: string;
  portalReference: string;
  purchaseOrderNumber: string;
  amountMinor: number;
  currency: string;
  status: "received" | "under_review" | "accepted" | "rejected" | "paid";
  createdAt: string;
  settlementExpectedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
}>;

type SubmissionDatabaseRow = {
  invoice_number: string;
  portal_reference: string;
  amount_minor: number;
  currency: string;
  status: SubmissionRow["status"];
  created_at: string;
  purchase_order_number: string;
  settlement_expected_at: string | null;
  paid_at: string | null;
  payment_reference: string | null;
};

function mapPurchaseOrder(row: PurchaseOrderRow): PurchaseOrder {
  return {
    purchaseOrderNumber: row.purchase_order_number,
    description: row.description,
    currency: row.currency,
    authorizedAmountMinor: Number(row.authorized_amount_minor),
    remainingAmountMinor: Number(row.remaining_amount_minor),
    status: row.status,
    version: row.version,
  };
}

function mapSubmission(row: SubmissionDatabaseRow): SubmissionRow {
  return {
    invoiceNumber: row.invoice_number,
    portalReference: row.portal_reference,
    purchaseOrderNumber: row.purchase_order_number,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    settlementExpectedAt: row.settlement_expected_at,
    paidAt: row.paid_at,
    paymentReference: row.payment_reference,
  };
}

export async function listPurchaseOrders(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("purchase_orders")
    .select("purchase_order_number, description, currency, authorized_amount_minor, remaining_amount_minor, status, version")
    .order("purchase_order_number", { ascending: true });
  if (error) throw new HttpError(500, "purchase_order_query_failed", "Purchase orders could not be loaded");
  return (data as PurchaseOrderRow[]).map(mapPurchaseOrder);
}

export async function findPurchaseOrder(supabase: SupabaseClient, number: string) {
  const { data, error } = await supabase.from("purchase_orders")
    .select("purchase_order_number, description, currency, authorized_amount_minor, remaining_amount_minor, status, version")
    .eq("purchase_order_number", number).maybeSingle();
  if (error) throw new HttpError(500, "purchase_order_query_failed", "Purchase order could not be loaded");
  return data ? mapPurchaseOrder(data as PurchaseOrderRow) : null;
}

export async function getRequirements(supabase: SupabaseClient): Promise<SubmissionRequirements> {
  const { data, error } = await supabase.from("submission_requirements")
    .select("accepted_media_types, max_document_bytes, require_open_purchase_order, enforce_remaining_balance")
    .single();
  if (error) throw new HttpError(500, "requirements_query_failed", "Submission requirements could not be loaded");
  return {
    acceptedMediaTypes: data.accepted_media_types,
    maxDocumentBytes: data.max_document_bytes,
    requireOpenPurchaseOrder: data.require_open_purchase_order,
    enforceRemainingBalance: data.enforce_remaining_balance,
    uniqueInvoiceNumberRequired: true,
  };
}

function inspectDocument(invoice: InvoiceCandidate): ValidationIssue | null {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(invoice.document.contentBase64, "base64");
  } catch {
    return { code: "invalid_document", message: "The invoice document is not valid base64." };
  }
  const canonical = bytes.toString("base64");
  const tail = bytes.subarray(Math.max(0, bytes.length - 1_024));
  if (canonical !== invoice.document.contentBase64
    || bytes.length > 1_048_576
    || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || tail.indexOf(Buffer.from("%%EOF")) === -1) {
    return { code: "invalid_document", message: "The invoice document must be a valid PDF no larger than 1 MB." };
  }
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== invoice.document.sha256) {
    return { code: "invalid_document", message: "The invoice document checksum does not match its content." };
  }
  return null;
}

export async function validateInvoice(supabase: SupabaseClient, invoice: InvoiceCandidate) {
  const [purchaseOrder, duplicateResult] = await Promise.all([
    findPurchaseOrder(supabase, invoice.purchaseOrderNumber),
    supabase.from("invoice_submissions").select("id").eq("invoice_number", invoice.invoiceNumber).maybeSingle(),
  ]);
  if (duplicateResult.error) throw new HttpError(500, "duplicate_check_failed", "Invoice uniqueness could not be checked");

  const issues: ValidationIssue[] = [];
  const documentIssue = inspectDocument(invoice);
  if (documentIssue) issues.push(documentIssue);
  if (!purchaseOrder) {
    issues.push({ code: "purchase_order_not_found", message: "The purchase order is not available to this supplier." });
  } else {
    if (purchaseOrder.status !== "open") issues.push({ code: "purchase_order_closed", message: "The purchase order is closed." });
    if (purchaseOrder.currency !== invoice.currency) issues.push({ code: "currency_mismatch", message: `The purchase order currency is ${purchaseOrder.currency}.` });
    if (purchaseOrder.remainingAmountMinor < invoice.amountMinor) {
      issues.push({
        code: "amount_exceeds_remaining_balance",
        message: `Invoice amount ${invoice.amountMinor} exceeds remaining balance ${purchaseOrder.remainingAmountMinor} ${purchaseOrder.currency}.`,
      });
    }
  }
  if (duplicateResult.data) issues.push({ code: "duplicate_invoice", message: "This invoice number was already submitted." });

  return { valid: issues.length === 0, invoiceNumber: invoice.invoiceNumber, purchaseOrder, issues };
}

export async function submitInvoiceBatch(supabase: SupabaseClient, idempotencyKey: string, invoices: InvoiceCandidate[]) {
  const { data, error } = await supabase.rpc("submit_invoice_batch", {
    p_idempotency_key: idempotencyKey,
    p_request_fingerprint: fingerprint(invoices),
    p_invoices: invoices,
  });
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "duplicate_or_idempotency_conflict", "Invoice or idempotency key conflicts with an earlier submission");
    if (error.code === "23514") throw new HttpError(409, "purchase_order_changed", "A purchase order changed; validate the batch again");
    throw new HttpError(422, "submission_rejected", "The batch was not accepted");
  }
  return data;
}

export async function listSubmissions(supabase: SupabaseClient): Promise<SubmissionRow[]> {
  const { data, error } = await supabase.rpc("get_invoice_submission_statuses", {
    p_invoice_number: null,
  });
  if (error) throw new HttpError(500, "submission_query_failed", "Invoice submissions could not be loaded");
  return (data as unknown as SubmissionDatabaseRow[]).map(mapSubmission);
}

export async function getInvoiceStatus(supabase: SupabaseClient, invoiceNumber: string) {
  const { data, error } = await supabase.rpc("get_invoice_submission_statuses", {
    p_invoice_number: invoiceNumber,
  });
  if (error) throw new HttpError(500, "submission_query_failed", "Invoice status could not be loaded");
  const row = (data as unknown as SubmissionDatabaseRow[])[0];
  return row ? mapSubmission(row) : null;
}
