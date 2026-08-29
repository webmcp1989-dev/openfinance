import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DeliveryEventRequest,
  ErpSyncResult,
  InvoiceQueueItem,
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
    version: row.version,
  };
}

const queueColumns = `
  invoice_number, amount_minor, currency, invoice_date, purchase_order_number,
  status, portal_reference, portal_status, exception_code, exception_message,
  version, customers!inner(name)
`;

function canonicalDocumentBase64(value: string) {
  const canonical = value.replace(/[\t\n\r ]/g, "");
  const isCanonical = canonical.length >= 8
    && canonical.length <= 1_400_000
    && /^[A-Za-z0-9+/]+={0,2}$/.test(canonical)
    && Buffer.from(canonical, "base64").toString("base64") === canonical;
  if (!isCanonical) {
    throw new HttpError(500, "package_document_invalid", "Stored invoice document is invalid");
  }
  return canonical;
}

function validatedStoredDocument(row: DocumentRow) {
  const contentBase64 = canonicalDocumentBase64(row.document_content_base64);
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
    throw new HttpError(500, "package_document_invalid", "Stored invoice document is invalid");
  }

  return { contentBase64, bytes: Uint8Array.from(bytes) };
}

export async function listInvoiceQueue(
  supabase: SupabaseClient,
  options: { customerName?: string; readyOnly?: boolean } = {},
) {
  let query = supabase
    .from("invoices")
    .select(queueColumns)
    .order("invoice_date", { ascending: true })
    .order("invoice_number", { ascending: true });

  if (options.customerName) query = query.eq("customers.name", options.customerName);
  if (options.readyOnly) query = query.eq("status", "ready");

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
  deletedDeliveryEventCount: number;
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
