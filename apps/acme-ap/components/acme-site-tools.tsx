"use client";

import { useEffect } from "react";

import { apiRequest } from "@/lib/browser-api";
import {
  DOCUMENT_APPROVAL_HEADER,
  exceptionResponseApprovalRequest,
  replacementApprovalRequest,
  submissionApprovalRequest,
} from "@/lib/domain/document-approvals";
import {
  exceptionResponseRequestSchema,
  replacementInvoiceRequestSchema,
  submitBatchRequestSchema,
} from "@/lib/domain/submissions";
import { MAX_TRANSFER_INVOICE_COUNT } from "@/lib/domain/transfer-limits";
import { obtainDocumentSubmissionApproval } from "./document-submission-approval";
import {
  buildAcmeSubmissionResult,
  dispatchAcmeAgentRead,
  dispatchAcmeDataChanged,
  submissionConfirmationMessage,
  type AcmeAgentReadSection,
} from "./workspace-events";

async function readForAgent<T>(section: AcmeAgentReadSection, request: Promise<T>) {
  const result = await request;
  dispatchAcmeAgentRead(section);
  return result;
}

const invoiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["invoiceNumber", "invoiceDate", "amountMinor", "currency", "purchaseOrderNumber", "document"],
  properties: {
    invoiceNumber: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" },
    invoiceDate: { type: "string", format: "date" },
    amountMinor: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    purchaseOrderNumber: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" },
    document: {
      type: "object", additionalProperties: false,
      required: ["fileName", "mediaType", "contentBase64", "sha256"],
      properties: {
        fileName: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$" },
        mediaType: { type: "string", const: "application/pdf" },
        contentBase64: {
          type: "string", minLength: 8, maxLength: 1400000,
          pattern: "^[A-Za-z0-9+/]+={0,2}$",
        },
        sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      },
    },
  },
} as const;

const invoiceNumberInputSchema = {
  type: "object", additionalProperties: false, required: ["invoiceNumber"],
  properties: { invoiceNumber: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" } },
} as const;

const supportingDocumentSchema = {
  ...invoiceSchema.properties.document,
  required: ["documentKind", "fileName", "mediaType", "contentBase64", "sha256"],
  properties: {
    documentKind: { type: "string", enum: ["proof_of_delivery", "service_acceptance", "timesheet", "tax_document", "contract", "other"] },
    ...invoiceSchema.properties.document.properties,
  },
} as const;

export function AcmeSiteTools() {
  useEffect(() => {
    const context = document.modelContext;
    if (typeof context?.registerTool !== "function") return;

    const tools: WebMcpTool[] = [
      {
        name: "get_invoice_requirements",
        title: "Get invoice requirements",
        description: "Read Acme's current invoice submission policy for the signed-in supplier. This does not modify the portal.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        execute: (_input, options) => readForAgent(
          "requirements",
          apiRequest("/api/agent/requirements", { signal: options?.signal }),
        ),
      },
      {
        name: "list_open_purchase_orders",
        title: "List open purchase orders",
        description: "List every open purchase order visible to the signed-in supplier, including line, receipt, service-entry, tolerance, attachment, and balance context. This does not reserve funds or modify an order.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (_input, options) => readForAgent(
          "orders",
          apiRequest("/api/agent/purchase-orders", { signal: options?.signal }),
        ),
      },
      {
        name: "get_purchase_order_details",
        title: "Get purchase order details",
        description: "Read one supplier-authorized purchase order with live line amounts, invoiced and received quantities, service-entry state, tolerances, payment terms, required evidence, and remaining balance. This does not reserve funds or modify the order.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["purchaseOrderNumber"],
          properties: { purchaseOrderNumber: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" } },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => readForAgent(
          "orders",
          apiRequest("/api/agent/purchase-orders", {
            method: "POST", body: JSON.stringify(input), signal: options?.signal,
          }),
        ),
      },
      {
        name: "list_supplier_invoices",
        title: "List supplier invoices",
        description: "List the signed-in supplier's portal invoices and effective statuses. Optionally filter by status or purchase order. This is read-only and supports batch follow-up without guessing invoice identifiers.",
        inputSchema: {
          type: "object", additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["received", "under_review", "accepted", "rejected", "disputed", "voided", "paid"] },
            purchaseOrderNumber: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" },
          },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => {
          const query = new URLSearchParams();
          const filters = input as { status?: unknown; purchaseOrderNumber?: unknown };
          if (typeof filters.status === "string") query.set("status", filters.status);
          if (typeof filters.purchaseOrderNumber === "string") query.set("purchaseOrderNumber", filters.purchaseOrderNumber);
          return readForAgent(
            "submissions",
            apiRequest(`/api/agent/supplier-invoices?${query}`, { signal: options?.signal }),
          );
        },
      },
      {
        name: "validate_invoice",
        title: "Validate invoice",
        description: "Validate one complete invoice package against Acme's live PO balance, currency, uniqueness, and PDF rules. Call only after the human approves transferring that exact package to Acme. This read-only preflight does not reserve balance or submit the invoice.",
        inputSchema: invoiceSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => readForAgent(
          "requirements",
          apiRequest("/api/agent/validate", {
            method: "POST", body: JSON.stringify(input), signal: options?.signal,
          }),
        ),
      },
      {
        name: "submit_invoice_batch",
        title: "Submit confirmed invoice batch",
        description: "CONSEQUENTIAL DOCUMENT WRITE: atomically submit up to three previously validated invoices, reserve each PO balance, and create portal references. The portal opens a mandatory approval panel showing the exact invoices, amounts, POs, documents, and total; submission cannot continue unless the signed-in human explicitly approves it. Never include invalid invoices.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["idempotencyKey", "invoices"],
          properties: {
            idempotencyKey: { type: "string", minLength: 16, maxLength: 128 },
            invoices: { type: "array", minItems: 1, maxItems: MAX_TRANSFER_INVOICE_COUNT, uniqueItems: true, items: invoiceSchema },
          },
        },
        annotations: { readOnlyHint: false },
        execute: async (input, options) => {
          const request = submitBatchRequestSchema.parse(input);
          const approvalId = await obtainDocumentSubmissionApproval(
            submissionApprovalRequest(request, "agent"),
            options?.signal,
          );
          const result = await apiRequest<{ items: Array<{ invoiceNumber: string; portalReference: string }> }>("/api/agent/submissions", {
            method: "POST",
            body: JSON.stringify(request),
            headers: { [DOCUMENT_APPROVAL_HEADER]: approvalId },
            signal: options?.signal,
          });
          dispatchAcmeDataChanged({
            actor: "agent",
            message: submissionConfirmationMessage(result.items.length),
            affectedInvoiceNumbers: result.items.map((item) => item.invoiceNumber),
            submissionResult: buildAcmeSubmissionResult("agent", request.invoices, result.items),
          });
          return result;
        },
      },
      {
        name: "get_invoice_status",
        title: "Get invoice status",
        description: "Read one supplier invoice's current receipt, revision, complete timestamped AP timeline across revisions, current structured exceptions, current inquiries, and any completed synthetic payment reference. This is a read-only status check.",
        inputSchema: invoiceNumberInputSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => readForAgent(
          "submissions",
          apiRequest("/api/agent/status", {
            method: "POST", body: JSON.stringify(input), signal: options?.signal,
          }),
        ),
      },
      {
        name: "get_invoice_exception",
        title: "Get invoice exception",
        description: "Read structured exceptions for one supplier invoice, including owner, whether supplier AR has authority to resolve it, an explicit authority-boundary statement, permitted actions, and required evidence. For a buyer-owned blocker, state plainly that it is not yours to fix and offer to open a tracked AP case. This does not change the exception.",
        inputSchema: invoiceNumberInputSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => readForAgent(
          "exceptions",
          apiRequest("/api/agent/exceptions", {
            method: "POST", body: JSON.stringify(input), signal: options?.signal,
          }),
        ),
      },
      {
        name: "respond_to_invoice_exception",
        title: "Respond to invoice exception",
        description: "CONSEQUENTIAL DOCUMENT WRITE: add a supplier response and up to three verified supporting PDFs to one actionable portal exception. The portal opens a mandatory approval panel showing the exact invoice, exception, message, and attachments; the response cannot be sent unless the signed-in human explicitly approves it. When the portal requested a specific evidence kind, exact validated evidence resolves that exception and approves the disputed invoice only if no other actionable blocker remains. The result returns both exceptionStatus and invoiceStatus. This does not replace or resubmit the invoice.",
        inputSchema: {
          type: "object", additionalProperties: false,
          required: ["idempotencyKey", "invoiceNumber", "exceptionCode", "message", "attachments"],
          properties: {
            idempotencyKey: { type: "string", minLength: 16, maxLength: 128 },
            invoiceNumber: invoiceNumberInputSchema.properties.invoiceNumber,
            exceptionCode: { type: "string", pattern: "^[a-z][a-z0-9_]{1,63}$" },
            message: { type: "string", minLength: 1, maxLength: 1000 },
            attachments: { type: "array", minItems: 0, maxItems: 3, items: supportingDocumentSchema },
          },
        },
        annotations: { readOnlyHint: false },
        execute: async (input, options) => {
          const request = exceptionResponseRequestSchema.parse(input);
          const approvalId = await obtainDocumentSubmissionApproval(
            exceptionResponseApprovalRequest(request, "agent"),
            options?.signal,
          );
          const result = await apiRequest<{ exceptionStatus: string; invoiceStatus: string }>("/api/agent/exception-responses", {
            method: "POST",
            body: JSON.stringify(request),
            headers: { [DOCUMENT_APPROVAL_HEADER]: approvalId },
            signal: options?.signal,
          });
          const message = result.exceptionStatus === "resolved" && result.invoiceStatus === "accepted"
            ? `${request.invoiceNumber} evidence was verified, the exception cleared, and the invoice was approved.`
            : `${request.invoiceNumber} exception response was sent with ${request.attachments.length} supporting document${request.attachments.length === 1 ? "" : "s"}.`;
          dispatchAcmeDataChanged({
            actor: "agent",
            message,
            affectedInvoiceNumbers: [request.invoiceNumber],
          });
          return result;
        },
      },
      {
        name: "replace_rejected_invoice",
        title: "Replace rejected invoice",
        description: "CONSEQUENTIAL DOCUMENT WRITE: atomically supersede the current rejected or disputed invoice with a corrected revision, revalidate its PDF and PO, and adjust PO balances. The portal opens a mandatory approval panel showing the exact corrected invoice, amount, PO, and PDF; replacement cannot continue unless the signed-in human explicitly approves it. Call only when the portal exception permits replacement.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["idempotencyKey", "invoice"],
          properties: {
            idempotencyKey: { type: "string", minLength: 16, maxLength: 128 },
            invoice: invoiceSchema,
          },
        },
        annotations: { readOnlyHint: false },
        execute: async (input, options) => {
          const request = replacementInvoiceRequestSchema.parse(input);
          const approvalId = await obtainDocumentSubmissionApproval(
            replacementApprovalRequest(request, "agent"),
            options?.signal,
          );
          const result = await apiRequest("/api/agent/replacements", {
            method: "POST",
            body: JSON.stringify(request),
            headers: { [DOCUMENT_APPROVAL_HEADER]: approvalId },
            signal: options?.signal,
          });
          dispatchAcmeDataChanged({
            actor: "agent",
            message: `${request.invoice.invoiceNumber} was replaced by a corrected, newly validated revision.`,
            affectedInvoiceNumbers: [request.invoice.invoiceNumber],
          });
          return result;
        },
      },
      {
        name: "create_invoice_inquiry",
        title: "Create invoice inquiry",
        description: "CONSEQUENTIAL WRITE: open a persistent tracked buyer AP case and return its CASE reference and open status for a payment question, invoice question, expedite request, payment-terms issue, invoice-entry assistance, or buyer-owned blocker. When exception ownership is buyer_receiving, buyer_procurement, or buyer_ap, say 'This isn't mine to fix', name the buyer owner, then show the exact case type, subject, and message and obtain human approval first. Opening a case never falsely resolves the buyer-owned exception or approves the invoice.",
        inputSchema: {
          type: "object", additionalProperties: false,
          required: ["idempotencyKey", "invoiceNumber", "inquiryType", "subject", "message"],
          properties: {
            idempotencyKey: { type: "string", minLength: 16, maxLength: 128 },
            invoiceNumber: invoiceNumberInputSchema.properties.invoiceNumber,
            inquiryType: { type: "string", enum: ["payment_inquiry", "invoice_inquiry", "expedite_payment", "payment_terms", "invoice_entry_assistance"] },
            subject: { type: "string", minLength: 1, maxLength: 160 },
            message: { type: "string", minLength: 1, maxLength: 1000 },
          },
        },
        annotations: { readOnlyHint: false },
        execute: async (input, options) => {
          const request = input as { invoiceNumber: string };
          const result = await apiRequest<{ caseReference: string }>("/api/agent/inquiries", {
            method: "POST", body: JSON.stringify(input), signal: options?.signal,
          });
          dispatchAcmeDataChanged({
            actor: "agent",
            message: `${result.caseReference} was opened for ${request.invoiceNumber}.`,
            affectedInvoiceNumbers: [request.invoiceNumber],
          });
          return result;
        },
      },
      {
        name: "get_payment_remittance",
        title: "Get payment remittance",
        description: "Read the payment schedule and, once paid, the exact payment reference, method, amount, currency, and invoice allocation for one supplier invoice. Use the completed allocation to finish the workflow by proposing an approved record_payment_remittance write in AR. This AP read does not trigger payment and cannot write to AR.",
        inputSchema: invoiceNumberInputSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => readForAgent(
          "submissions",
          apiRequest("/api/agent/remittance", {
            method: "POST", body: JSON.stringify(input), signal: options?.signal,
          }),
        ),
      },
    ];

    const registrationController = new AbortController();
    let disposed = false;
    const removeTools = () => {
      registrationController.abort();
      if (typeof context.unregisterTool === "function") {
        for (const tool of tools) void context.unregisterTool(tool.name);
      }
    };

    void Promise.allSettled(tools.map(async (tool) => {
      await context.registerTool(tool, { signal: registrationController.signal });
    })).then((results) => {
      if (disposed || results.some((result) => result.status === "rejected")) removeTools();
    });

    return () => {
      disposed = true;
      removeTools();
    };
  }, []);

  return null;
}
