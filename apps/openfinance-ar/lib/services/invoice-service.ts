import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  DeliveryEventRequest,
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

  return rows.map((row) => ({
    ...mapQueueItem(row),
    document: {
      fileName: row.document_name,
      mediaType: row.document_media_type,
      contentBase64: row.document_content_base64,
      sha256: row.document_sha256,
    },
  }));
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
