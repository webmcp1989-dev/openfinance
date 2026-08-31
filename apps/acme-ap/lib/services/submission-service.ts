import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  InvoiceCandidate,
  InvoiceException,
  InvoiceTimelineEvent,
  PurchaseOrder,
  SubmissionRequirements,
  ValidationIssue,
} from "@/lib/domain/submissions";
import { fingerprint, HttpError } from "@/lib/http-core";
import { hasStructuralPdf } from "@/lib/pdf-structure";

type PurchaseOrderRow = {
  purchase_order_number: string;
  description: string;
  currency: string;
  authorized_amount_minor: number;
  remaining_amount_minor: number;
  status: "open" | "closed";
  order_date: string;
  payment_terms: string;
  receipt_required: boolean;
  received_amount_minor: number;
  service_entry_required: boolean;
  service_entry_status: PurchaseOrder["serviceEntryStatus"];
  price_tolerance_basis_points: number;
  amount_tolerance_minor: number;
  required_attachment_kinds: string[];
  purchase_order_lines: Array<{
    line_number: number;
    description: string;
    unit_of_measure: string;
    ordered_quantity: number;
    received_quantity: number;
    unit_price_minor: number;
    line_amount_minor: number;
    invoiced_amount_minor: number;
  }>;
  version: number;
};

export type SubmissionRow = Readonly<{
  invoiceNumber: string;
  portalReference: string;
  purchaseOrderNumber: string;
  amountMinor: number;
  currency: string;
  status: "received" | "under_review" | "accepted" | "rejected" | "disputed" | "voided" | "paid";
  createdAt: string;
  settlementExpectedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  revision?: number;
  timeline?: InvoiceTimelineEvent[];
  exceptions?: InvoiceException[];
  inquiries?: ReadonlyArray<Readonly<{
    caseReference: string;
    inquiryType: string;
    subject: string;
    status: string;
    createdAt: string;
  }>>;
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
    orderDate: row.order_date,
    paymentTerms: row.payment_terms,
    receiptRequired: row.receipt_required,
    receivedAmountMinor: Number(row.received_amount_minor),
    serviceEntryRequired: row.service_entry_required,
    serviceEntryStatus: row.service_entry_status,
    priceToleranceBasisPoints: row.price_tolerance_basis_points,
    amountToleranceMinor: Number(row.amount_tolerance_minor),
    requiredAttachmentKinds: row.required_attachment_kinds,
    lines: (row.purchase_order_lines ?? []).map((line) => ({
      lineNumber: line.line_number,
      description: line.description,
      unitOfMeasure: line.unit_of_measure,
      orderedQuantity: Number(line.ordered_quantity),
      receivedQuantity: Number(line.received_quantity),
      unitPriceMinor: Number(line.unit_price_minor),
      lineAmountMinor: Number(line.line_amount_minor),
      invoicedAmountMinor: Number(line.invoiced_amount_minor),
    })),
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

export function describeExceptionAuthority(owner: InvoiceException["owner"]) {
  if (owner === "supplier_ar" || owner === "shared") {
    return {
      supplierCanResolve: true,
      authorityBoundary: owner === "shared"
        ? "Supplier AR can contribute to this shared resolution."
        : "Supplier AR owns this blocker and can resolve it with the permitted action.",
    } as const;
  }
  const ownerLabel = owner === "buyer_receiving"
    ? "Acme receiving"
    : owner === "buyer_procurement"
      ? "Acme procurement"
      : "Acme AP";
  return {
    supplierCanResolve: false,
    authorityBoundary: `This isn't mine to fix. ${ownerLabel} owns this blocker; I can open a tracked AP case.`,
  } as const;
}

export async function listPurchaseOrders(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("purchase_orders")
    .select(`purchase_order_number, description, currency, authorized_amount_minor,
      remaining_amount_minor, status, order_date, payment_terms, receipt_required,
      received_amount_minor, service_entry_required, service_entry_status,
      price_tolerance_basis_points, amount_tolerance_minor, required_attachment_kinds,
      version, purchase_order_lines(line_number, description, unit_of_measure,
        ordered_quantity, received_quantity, unit_price_minor, line_amount_minor,
        invoiced_amount_minor)`)
    .order("purchase_order_number", { ascending: true });
  if (error) throw new HttpError(500, "purchase_order_query_failed", "Purchase orders could not be loaded");
  return (data as PurchaseOrderRow[]).map(mapPurchaseOrder);
}

export async function findPurchaseOrder(supabase: SupabaseClient, number: string) {
  const { data, error } = await supabase.from("purchase_orders")
    .select(`purchase_order_number, description, currency, authorized_amount_minor,
      remaining_amount_minor, status, order_date, payment_terms, receipt_required,
      received_amount_minor, service_entry_required, service_entry_status,
      price_tolerance_basis_points, amount_tolerance_minor, required_attachment_kinds,
      version, purchase_order_lines(line_number, description, unit_of_measure,
        ordered_quantity, received_quantity, unit_price_minor, line_amount_minor,
        invoiced_amount_minor)`)
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
  if (canonical !== invoice.document.contentBase64
    || bytes.length > 1_048_576
    || !hasStructuralPdf(bytes)) {
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
    if (purchaseOrder.receiptRequired && purchaseOrder.receivedAmountMinor < invoice.amountMinor) {
      issues.push({
        code: "missing_receipt",
        message: `Only ${purchaseOrder.receivedAmountMinor} ${purchaseOrder.currency} has been received against this purchase order.`,
      });
    }
    if (purchaseOrder.serviceEntryRequired && purchaseOrder.serviceEntryStatus !== "accepted") {
      issues.push({
        code: "service_entry_not_accepted",
        message: `The required service entry is ${purchaseOrder.serviceEntryStatus}. Buyer receiving must accept it before invoicing.`,
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

export async function getInvoiceStatus(supabase: SupabaseClient, invoiceNumber: string): Promise<SubmissionRow | null> {
  const { data, error } = await supabase.rpc("get_invoice_submission_statuses", {
    p_invoice_number: invoiceNumber,
  });
  if (error) throw new HttpError(500, "submission_query_failed", "Invoice status could not be loaded");
  const row = (data as unknown as SubmissionDatabaseRow[])[0];
  if (!row) return null;
  const submission = mapSubmission(row);
  const { data: identity, error: identityError } = await supabase.from("invoice_submissions")
    .select("id, revision").eq("invoice_number", invoiceNumber).eq("is_current", true).maybeSingle();
  if (identityError) throw new HttpError(500, "submission_query_failed", "Invoice status could not be loaded");
  if (!identity) return null;
  const [timelineResult, exceptionResult, inquiryResult] = await Promise.all([
    supabase.from("invoice_status_events")
      .select("status, event_code, message, actor_kind, created_at")
      .eq("invoice_submission_id", identity.id).order("created_at", { ascending: true }).order("id", { ascending: true }),
    supabase.from("invoice_exceptions")
      .select("exception_code, category, owner, status, message, resolution_guidance, allowed_actions, required_document_kind, created_at, updated_at")
      .eq("invoice_submission_id", identity.id).order("created_at", { ascending: true }),
    supabase.from("invoice_inquiries")
      .select("case_reference, inquiry_type, subject, status, created_at")
      .eq("invoice_submission_id", identity.id).order("created_at", { ascending: false }),
  ]);
  if (timelineResult.error || exceptionResult.error || inquiryResult.error) {
    throw new HttpError(500, "submission_detail_query_failed", "Invoice workflow details could not be loaded");
  }
  const timeline: InvoiceTimelineEvent[] = timelineResult.data.map((event) => ({
    status: event.status,
    eventCode: event.event_code,
    message: event.message,
    actorKind: event.actor_kind as InvoiceTimelineEvent["actorKind"],
    createdAt: event.created_at,
  }));
  if (submission.status === "paid" && submission.paidAt && !timeline.some((event) => event.status === "paid")) {
    timeline.push({
      status: "paid", eventCode: "payment_completed",
      message: `Payment completed with reference ${submission.paymentReference}.`,
      actorKind: "system", createdAt: submission.paidAt,
    });
  }
  const exceptions: InvoiceException[] = exceptionResult.data.map((exception) => {
    const owner = exception.owner as InvoiceException["owner"];
    return {
      exceptionCode: exception.exception_code,
      category: exception.category as InvoiceException["category"],
      owner,
      status: exception.status as InvoiceException["status"],
      message: exception.message,
      resolutionGuidance: exception.resolution_guidance,
      allowedActions: exception.allowed_actions,
      requiredDocumentKind: exception.required_document_kind,
      ...describeExceptionAuthority(owner),
      createdAt: exception.created_at,
      updatedAt: exception.updated_at,
    };
  });
  return {
    ...submission,
    revision: identity.revision,
    timeline: timeline.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)),
    exceptions,
    inquiries: inquiryResult.data.map((inquiry) => ({
      caseReference: inquiry.case_reference,
      inquiryType: inquiry.inquiry_type,
      subject: inquiry.subject,
      status: inquiry.status,
      createdAt: inquiry.created_at,
    })),
  };
}

export async function listSupplierInvoices(
  supabase: SupabaseClient,
  filters: { status?: SubmissionRow["status"]; purchaseOrderNumber?: string } = {},
) {
  const submissions = await listSubmissions(supabase);
  return submissions.filter((submission) =>
    (!filters.status || submission.status === filters.status)
      && (!filters.purchaseOrderNumber || submission.purchaseOrderNumber === filters.purchaseOrderNumber));
}

export async function getInvoiceExceptions(supabase: SupabaseClient, invoiceNumber: string) {
  const detail = await getInvoiceStatus(supabase, invoiceNumber);
  if (!detail) throw new HttpError(404, "invoice_not_found", "Invoice submission was not found");
  return { invoiceNumber, portalReference: detail.portalReference, exceptions: detail.exceptions };
}

export async function respondToInvoiceException(
  supabase: SupabaseClient,
  request: { idempotencyKey: string; invoiceNumber: string; exceptionCode: string; message: string; attachments: unknown[] },
) {
  const { idempotencyKey, ...payload } = request;
  const { data, error } = await supabase.rpc("respond_to_invoice_exception", {
    p_idempotency_key: idempotencyKey,
    p_request_fingerprint: fingerprint(payload),
    p_payload: payload,
  });
  if (error?.code === "42501") throw new HttpError(403, "submitter_access_required", "Submitter access is required");
  if (error?.code === "P0001" && error.message?.startsWith("This isn't mine to fix.")) {
    throw new HttpError(409, "buyer_owned_exception", error.message);
  }
  if (error?.code === "23505") throw new HttpError(409, "idempotency_conflict", "Idempotency key conflicts with an earlier response");
  if (error?.code === "23514" && error.message?.startsWith("The required supporting document")) {
    throw new HttpError(409, "required_evidence_missing", error.message);
  }
  if (error?.code === "23514") throw new HttpError(409, "exception_not_actionable", "The exception is no longer actionable");
  if (error?.code === "P0002") throw new HttpError(404, "exception_not_found", "Open invoice exception was not found");
  if (error) throw new HttpError(422, "exception_response_rejected", "Exception response could not be recorded");
  return data;
}

export async function replaceRejectedInvoice(
  supabase: SupabaseClient,
  idempotencyKey: string,
  invoice: InvoiceCandidate,
) {
  const { data, error } = await supabase.rpc("replace_rejected_invoice", {
    p_idempotency_key: idempotencyKey,
    p_request_fingerprint: fingerprint(invoice),
    p_invoice: invoice,
  });
  if (error?.code === "42501") throw new HttpError(403, "submitter_access_required", "Submitter access is required");
  if (error?.code === "23505") throw new HttpError(409, "idempotency_conflict", "Idempotency key conflicts with an earlier replacement");
  if (error?.code === "23514") {
    throw new HttpError(409, "replacement_conflict", "The invoice cannot be replaced in its current state");
  }
  if (error?.code === "P0002") throw new HttpError(404, "invoice_not_found", "Current invoice submission was not found");
  if (error) throw new HttpError(422, "replacement_rejected", "Replacement invoice was not accepted");
  return data;
}

export async function createInvoiceInquiry(
  supabase: SupabaseClient,
  request: { idempotencyKey: string; invoiceNumber: string; inquiryType: string; subject: string; message: string },
) {
  const { idempotencyKey, ...payload } = request;
  const { data, error } = await supabase.rpc("create_invoice_inquiry", {
    p_idempotency_key: idempotencyKey,
    p_request_fingerprint: fingerprint(payload),
    p_payload: payload,
  });
  if (error?.code === "42501") throw new HttpError(403, "submitter_access_required", "Submitter access is required");
  if (error?.code === "23505") throw new HttpError(409, "idempotency_conflict", "Idempotency key conflicts with an earlier inquiry");
  if (error?.code === "P0002") throw new HttpError(404, "invoice_not_found", "Invoice submission was not found");
  if (error) throw new HttpError(422, "inquiry_rejected", "Invoice inquiry could not be created");
  return data;
}

export async function getPaymentRemittance(supabase: SupabaseClient, invoiceNumber: string) {
  const { data: submission, error: submissionError } = await supabase.from("invoice_submissions")
    .select("id, invoice_number, portal_reference, amount_minor, currency")
    .eq("invoice_number", invoiceNumber).eq("is_current", true).maybeSingle();
  if (submissionError) throw new HttpError(500, "remittance_query_failed", "Payment remittance could not be loaded");
  if (!submission) throw new HttpError(404, "invoice_not_found", "Invoice submission was not found");
  const { data: settlement, error } = await supabase.from("payment_settlements")
    .select("scheduled_for, payment_reference, amount_minor, currency, payment_method")
    .eq("invoice_submission_id", submission.id).maybeSingle();
  if (error) throw new HttpError(500, "remittance_query_failed", "Payment remittance could not be loaded");
  const paid = Boolean(settlement && Date.parse(settlement.scheduled_for) <= Date.now());
  return {
    invoiceNumber: submission.invoice_number,
    portalReference: submission.portal_reference,
    paymentStatus: paid ? "paid" : settlement ? "scheduled" : "not_scheduled",
    scheduledFor: settlement?.scheduled_for ?? null,
    paidAt: paid ? settlement?.scheduled_for ?? null : null,
    paymentReference: paid ? settlement?.payment_reference ?? null : null,
    amountMinor: paid ? Number(settlement?.amount_minor) : null,
    currency: paid ? settlement?.currency ?? null : submission.currency,
    paymentMethod: paid ? settlement?.payment_method ?? null : null,
    allocations: paid ? [{ invoiceNumber, amountMinor: Number(settlement?.amount_minor), currency: settlement?.currency }] : [],
  };
}

export type DemoResetResult = Readonly<{
  restoredPurchaseOrderCount: number;
  seededSubmissionCount: number;
  seededExceptionCount: number;
  deletedSubmissionCount: number;
  deletedBatchCount: number;
  resetAt: string;
}>;

export async function resetDemoState(supabase: SupabaseClient): Promise<DemoResetResult> {
  const { data, error } = await supabase.rpc("reset_demo_state");

  if (error) {
    if (error.code === "42501") {
      throw new HttpError(403, "demo_reset_forbidden", "This account cannot restore the synthetic demo");
    }
    if (error.code === "P0002") {
      throw new HttpError(409, "demo_baseline_incomplete", "The synthetic demo baseline is incomplete");
    }
    throw new HttpError(422, "demo_reset_failed", "The synthetic demo could not be restored");
  }

  return data as DemoResetResult;
}
