import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DeliveryEventRequest,
  ErpSyncResult,
  InvoiceQueueItem,
  InvoiceSupportingDocument,
  SubmissionPackageItem,
} from "@/lib/domain/invoices";
import { HttpError, fingerprint } from "@/lib/http-core";

type CustomerRelation = { name: string } | { name: string }[];

type InvoiceRow = {
  invoice_number: string;
  amount_minor: number;
  currency: string;
  invoice_date: string;
  purchase_order_number: string | null;
  status: InvoiceQueueItem["status"];
  portal_reference: string | null;
  portal_status: string | null;
  exception_code: string | null;
  exception_message: string | null;
  due_date: string;
  last_portal_checked_at: string | null;
  paid_amount_minor: number;
  last_payment_at: string | null;
  last_payment_reference: string | null;
  version: number;
  customers: CustomerRelation;
};

type PackageRow = InvoiceRow & {
  document_name: string;
  document_media_type: "application/pdf";
  document_content_base64: string;
  document_sha256: string;
};

type DocumentRow = Pick<PackageRow,
  "document_name" | "document_media_type" | "document_content_base64" | "document_sha256"
>;

export type InvoiceDocumentDownload = Readonly<{
  fileName: string;
  mediaType: "application/pdf";
  sha256: string;
  bytes: Uint8Array;
}>;

const MAX_DOCUMENT_BYTES = 1_048_576;

function customerName(relation: CustomerRelation) {
  return Array.isArray(relation) ? relation[0]?.name ?? "" : relation.name;
}

function mapQueueItem(row: InvoiceRow): InvoiceQueueItem {
  return {
    invoiceNumber: row.invoice_number,
    customerName: customerName(row.customers),
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    invoiceDate: row.invoice_date,
    purchaseOrderNumber: row.purchase_order_number,
    status: row.status,
    portalReference: row.portal_reference,
    portalStatus: row.portal_status,
    exceptionCode: row.exception_code,
    exceptionMessage: row.exception_message,
    dueDate: row.due_date,
    lastPortalCheckedAt: row.last_portal_checked_at,
    paidAmountMinor: Number(row.paid_amount_minor),
    lastPaymentAt: row.last_payment_at,
    lastPaymentReference: row.last_payment_reference,
    version: row.version,
  };
}

const queueColumns = `
  invoice_number, amount_minor, currency, invoice_date, purchase_order_number,
  status, portal_reference, portal_status, exception_code, exception_message,
  due_date, last_portal_checked_at, paid_amount_minor, last_payment_at, last_payment_reference,
  version, customers!inner(name)
`;

function canonicalDocumentBase64(
  value: string,
  error: { code: string; message: string } = {
    code: "package_document_invalid",
    message: "Stored invoice document is invalid",
  },
) {
  const canonical = value.replace(/[\t\n\r ]/g, "");
  const isCanonical = canonical.length >= 8
    && canonical.length <= 1_400_000
    && /^[A-Za-z0-9+/]+={0,2}$/.test(canonical)
    && Buffer.from(canonical, "base64").toString("base64") === canonical;
  if (!isCanonical) {
    throw new HttpError(500, error.code, error.message);
  }
  return canonical;
}

function validatedStoredDocument(
  row: DocumentRow,
  error: { code: string; message: string } = {
    code: "package_document_invalid",
    message: "Stored invoice document is invalid",
  },
) {
  const contentBase64 = canonicalDocumentBase64(row.document_content_base64, error);
  const bytes = Buffer.from(contentBase64, "base64");
  const tail = bytes.subarray(Math.max(0, bytes.length - 1_024));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const documentText = bytes.toString("latin1");
  const startXrefMatch = /startxref[\x00\t\n\f\r ]+(\d+)[\x00\t\n\f\r ]+%%EOF[\x00\t\n\f\r ]*$/.exec(documentText);
  const xrefOffset = startXrefMatch ? Number(startXrefMatch[1]) : -1;
  const hasCoherentStructure = Number.isSafeInteger(xrefOffset)
    && xrefOffset >= 0
    && bytes.subarray(xrefOffset, xrefOffset + 4).equals(Buffer.from("xref"))
    && documentText.includes("/Type /Catalog")
    && documentText.includes("/Type /Page");
  const validMetadata = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(row.document_name)
    && row.document_media_type === "application/pdf"
    && /^[a-f0-9]{64}$/.test(row.document_sha256);

  if (!validMetadata
    || bytes.length === 0
    || bytes.length > MAX_DOCUMENT_BYTES
    || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || tail.indexOf(Buffer.from("%%EOF")) === -1
    || !hasCoherentStructure
    || sha256 !== row.document_sha256) {
    throw new HttpError(500, error.code, error.message);
  }

  return { contentBase64, bytes: Uint8Array.from(bytes) };
}

export async function listInvoiceQueue(
  supabase: SupabaseClient,
  options: {
    customerName?: string;
    invoiceNumber?: string;
    readyOnly?: boolean;
    statuses?: InvoiceQueueItem["status"][];
  } = {},
) {
  let query = supabase
    .from("invoices")
    .select(queueColumns)
    .order("invoice_date", { ascending: true })
    .order("invoice_number", { ascending: true });

  if (options.customerName) query = query.eq("customers.name", options.customerName);
  if (options.invoiceNumber) query = query.eq("invoice_number", options.invoiceNumber);
  if (options.readyOnly) query = query.eq("status", "ready");
  else if (options.statuses?.length) query = query.in("status", options.statuses);

  const { data, error } = await query;
  if (error) throw new HttpError(500, "invoice_query_failed", "Invoice queue could not be loaded");
  return (data as unknown as InvoiceRow[]).map(mapQueueItem);
}

export async function getSubmissionPackage(
  supabase: SupabaseClient,
  invoiceNumbers: string[],
): Promise<SubmissionPackageItem[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select(`${queueColumns}, document_name, document_media_type, document_content_base64, document_sha256`)
    .in("invoice_number", invoiceNumbers)
    .eq("status", "ready")
    .order("invoice_number", { ascending: true });

  if (error) throw new HttpError(500, "package_query_failed", "Submission package could not be prepared");
  const rows = data as unknown as PackageRow[];
  const found = new Set(rows.map((row) => row.invoice_number));
  const missing = invoiceNumbers.filter((number) => !found.has(number));
  if (missing.length > 0) {
    throw new HttpError(409, "invoice_not_ready", `Not ready or not found: ${missing.join(", ")}`);
  }

  return rows.map((row) => {
    const document = validatedStoredDocument(row);
    return {
      ...mapQueueItem(row),
      document: {
        fileName: row.document_name,
        mediaType: row.document_media_type,
        contentBase64: document.contentBase64,
        sha256: row.document_sha256,
      },
    };
  });
}

export async function getInvoiceDocument(
  supabase: SupabaseClient,
  invoiceNumber: string,
): Promise<InvoiceDocumentDownload> {
  const { data, error } = await supabase
    .from("invoices")
    .select("document_name, document_media_type, document_content_base64, document_sha256")
    .eq("invoice_number", invoiceNumber)
    .single();

  if (error?.code === "PGRST116" || !data) {
    throw new HttpError(404, "invoice_document_not_found", "Invoice document was not found");
  }
  if (error) {
    throw new HttpError(500, "invoice_document_query_failed", "Invoice document could not be loaded");
  }

  const row = data as unknown as DocumentRow;
  const document = validatedStoredDocument(row);
  return {
    fileName: row.document_name,
    mediaType: row.document_media_type,
    sha256: row.document_sha256,
    bytes: document.bytes,
  };
}

export type PortalFollowup = InvoiceQueueItem & Readonly<{
  followupReason: "needs_attention" | "rejected" | "status_stale" | "overdue" | "partially_paid";
  suggestedAction: string;
  remainingDueMinor: number;
}>;

export async function listPortalFollowups(
  supabase: SupabaseClient,
  customerName?: string,
): Promise<PortalFollowup[]> {
  const invoices = await listInvoiceQueue(supabase, {
    customerName,
    statuses: ["needs_attention", "submitted", "accepted", "rejected"],
  });
  const now = Date.now();
  return invoices.flatMap((invoice) => {
    const remainingDueMinor = invoice.amountMinor - invoice.paidAmountMinor;
    let followupReason: PortalFollowup["followupReason"] | null = null;
    let suggestedAction = "";
    if (invoice.status === "needs_attention") {
      followupReason = "needs_attention";
      suggestedAction = invoice.exceptionMessage ?? "Correct the local invoice before submission.";
    } else if (invoice.status === "rejected") {
      followupReason = "rejected";
      suggestedAction = invoice.exceptionMessage ?? "Read the portal exception and prepare a correction.";
    } else if (invoice.paidAmountMinor > 0 && remainingDueMinor > 0) {
      followupReason = "partially_paid";
      suggestedAction = "Reconcile the remaining balance against portal remittance or deductions.";
    } else if (Date.parse(invoice.dueDate) < now && remainingDueMinor > 0) {
      followupReason = "overdue";
      suggestedAction = "Check payment status or open a buyer inquiry.";
    } else {
      const checkedAt = invoice.lastPortalCheckedAt ? Date.parse(invoice.lastPortalCheckedAt) : 0;
      if (checkedAt > 0 && now - checkedAt <= 24 * 60 * 60 * 1000) return [];
      followupReason = "status_stale";
      suggestedAction = "Refresh the buyer portal status and record the verified result.";
    }
    return [{ ...invoice, followupReason, suggestedAction, remainingDueMinor }];
  });
}

export async function getInvoiceSupportingDocuments(
  supabase: SupabaseClient,
  invoiceNumber: string,
): Promise<InvoiceSupportingDocument[]> {
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices").select("id").eq("invoice_number", invoiceNumber).maybeSingle();
  if (invoiceError) throw new HttpError(500, "supporting_document_query_failed", "Supporting documents could not be loaded");
  if (!invoice) throw new HttpError(404, "invoice_not_found", "Invoice was not found");
  const { data, error } = await supabase.from("invoice_supporting_documents")
    .select("document_kind, file_name, media_type, content_base64, sha256, size_bytes")
    .eq("invoice_id", invoice.id).order("created_at", { ascending: true });
  if (error) throw new HttpError(500, "supporting_document_query_failed", "Supporting documents could not be loaded");
  return data.map((row) => {
    const document = validatedStoredDocument({
      document_name: row.file_name,
      document_media_type: row.media_type,
      document_content_base64: row.content_base64,
      document_sha256: row.sha256,
    } as DocumentRow, {
      code: "supporting_document_invalid",
      message: "Stored supporting document is invalid",
    });
    if (document.bytes.length !== Number(row.size_bytes)) {
      throw new HttpError(500, "supporting_document_invalid", "Stored supporting document is invalid");
    }
    return {
      documentKind: row.document_kind as InvoiceSupportingDocument["documentKind"],
      fileName: row.file_name,
      mediaType: row.media_type as "application/pdf",
      contentBase64: document.contentBase64,
      sha256: row.sha256,
      sizeBytes: document.bytes.length,
    };
  });
}

export async function recordPaymentRemittance(
  supabase: SupabaseClient,
  request: {
    idempotencyKey: string;
    invoiceNumber: string;
    paymentReference: string;
    amountMinor: number;
    currency: string;
    paymentMethod: "ach" | "wire" | "check" | "card" | "other";
    paidAt: string;
  },
) {
  const { idempotencyKey, ...payload } = request;
  const { data, error } = await supabase.rpc("record_payment_remittance", {
    p_idempotency_key: idempotencyKey,
    p_request_fingerprint: fingerprint(payload),
    p_payload: payload,
  });
  if (error?.code === "42501") throw new HttpError(403, "operator_access_required", "Operator access is required to record remittance");
  if (error?.code === "23505") throw new HttpError(409, "idempotency_conflict", "Idempotency key or payment reference conflicts with an earlier record");
  if (error?.code === "23514") throw new HttpError(409, "remittance_conflict", "Remittance does not match the current invoice balance or currency");
  if (error?.code === "P0002") throw new HttpError(404, "invoice_not_found", "Invoice was not found");
  if (error) throw new HttpError(422, "remittance_rejected", "Payment remittance could not be recorded");
  return data;
}

export async function recordDeliveryEvent(
  supabase: SupabaseClient,
  request: DeliveryEventRequest,
) {
  const payload = { items: request.items };
  const { data, error } = await supabase.rpc("record_delivery_event", {
    p_event_type: request.eventType,
    p_idempotency_key: request.idempotencyKey,
    p_request_fingerprint: fingerprint({ eventType: request.eventType, ...payload }),
    p_payload: payload,
  });

  if (error) {
    if (error.code === "42501") {
      throw new HttpError(403, "operator_access_required", "Operator access is required to record portal outcomes");
    }
    if (error.code === "23505") {
      throw new HttpError(409, "idempotency_conflict", "Idempotency key conflicts with an earlier request");
    }
    if (error.code === "23514") {
      throw new HttpError(409, "invoice_state_conflict", "Invoice state changed; reload the queue before recording the portal outcome");
    }
    if (error.code === "P0002") {
      throw new HttpError(404, "invoice_not_found", "An invoice was not found");
    }
    throw new HttpError(422, "delivery_event_rejected", "Delivery result could not be recorded");
  }
  return data;
}

export async function syncInvoicesFromErp(
  supabase: SupabaseClient,
  idempotencyKey: string,
): Promise<ErpSyncResult> {
  const { data, error } = await supabase.rpc("sync_invoices_from_erp", {
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    if (error.code === "23505") {
      throw new HttpError(409, "idempotency_conflict", "Sync key conflicts with an earlier request");
    }
    if (error.code === "P0002") {
      throw new HttpError(409, "erp_sync_not_configured", "ERP sync is not configured for this organization");
    }
    if (error.code === "42501") {
      throw new HttpError(403, "operator_access_required", "Operator access is required to sync invoices");
    }
    throw new HttpError(422, "erp_sync_failed", "Invoices could not be synchronized from the ERP");
  }

  return data as ErpSyncResult;
}

export type DemoResetResult = Readonly<{
  restoredInvoiceCount: number;
  readyInvoiceCount: number;
  deletedDeliveryEventCount: number;
  deletedRemittanceEventCount: number;
  deletedErpEventCount: number;
  deletedErpInvoiceCount: number;
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
