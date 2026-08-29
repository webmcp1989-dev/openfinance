"use client";

import { useEffect } from "react";

import { apiRequest } from "@/lib/browser-api";
import { MAX_TRANSFER_INVOICE_COUNT } from "@/lib/domain/transfer-limits";

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
        execute: (_input, options) => apiRequest("/api/agent/requirements", { signal: options?.signal }),
      },
      {
        name: "find_purchase_order",
        title: "Find purchase order",
        description: "Find one purchase order visible to the signed-in supplier and return its live status and remaining balance. This does not reserve funds or modify the order.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["purchaseOrderNumber"],
          properties: { purchaseOrderNumber: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" } },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => apiRequest("/api/agent/purchase-orders", {
          method: "POST", body: JSON.stringify(input), signal: options?.signal,
        }),
      },
      {
        name: "validate_invoice",
        title: "Validate invoice",
        description: "Validate one complete invoice package against Acme's live PO balance, currency, uniqueness, and PDF rules. Call only after the human approves transferring that exact package to Acme. This read-only preflight does not reserve balance or submit the invoice.",
        inputSchema: invoiceSchema,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => apiRequest("/api/agent/validate", {
          method: "POST", body: JSON.stringify(input), signal: options?.signal,
        }),
      },
      {
        name: "submit_invoice_batch",
        title: "Submit confirmed invoice batch",
        description: "CONSEQUENTIAL WRITE: atomically submit up to three previously validated invoices, reserve each PO balance, and create portal references. Call only after showing the exact valid invoice numbers, amounts, and exceptions to the user and receiving explicit confirmation. Never include invalid invoices.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["idempotencyKey", "invoices"],
          properties: {
            idempotencyKey: { type: "string", minLength: 16, maxLength: 128 },
            invoices: { type: "array", minItems: 1, maxItems: MAX_TRANSFER_INVOICE_COUNT, uniqueItems: true, items: invoiceSchema },
          },
        },
        annotations: { readOnlyHint: false },
        execute: async (input, options) => {
          const result = await apiRequest("/api/agent/submissions", {
            method: "POST", body: JSON.stringify(input), signal: options?.signal,
          });
          window.dispatchEvent(new Event("acme:data-changed"));
          return result;
        },
      },
      {
        name: "get_invoice_status",
        title: "Get invoice status",
        description: "Read Acme's receipt, current AP status, and any completed synthetic payment reference for one invoice belonging to the signed-in supplier. This is a read-only status check.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["invoiceNumber"],
          properties: { invoiceNumber: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" } },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => apiRequest("/api/agent/status", {
          method: "POST", body: JSON.stringify(input), signal: options?.signal,
        }),
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
