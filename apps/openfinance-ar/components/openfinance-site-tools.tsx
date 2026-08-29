"use client";

import { useEffect } from "react";

import { MAX_TRANSFER_INVOICE_COUNT } from "@/lib/domain/transfer-limits";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const body = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "OpenFinance request failed");
  return body;
}

const invoiceNumberArray = {
  type: "array", minItems: 1, maxItems: MAX_TRANSFER_INVOICE_COUNT, uniqueItems: true,
  items: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" },
} as const;

const portalResultItem = {
  type: "object", additionalProperties: false,
  required: ["invoiceNumber", "portalReference", "portalStatus"],
  properties: {
    invoiceNumber: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" },
    portalReference: { type: "string", minLength: 1, maxLength: 120 },
    portalStatus: { type: "string", enum: ["received", "under_review", "accepted"] },
  },
} as const;

const portalExceptionItem = {
  type: "object", additionalProperties: false,
  required: ["invoiceNumber", "exceptionCode", "message"],
  properties: {
    invoiceNumber: { type: "string", pattern: "^[A-Z0-9][A-Z0-9-]{1,39}$" },
    exceptionCode: { type: "string", pattern: "^[a-z][a-z0-9_]{1,63}$" },
    message: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;

export function OpenFinanceSiteTools() {
  useEffect(() => {
    const context = document.modelContext;
    if (typeof context?.registerTool !== "function") return;

    const tools: WebMcpTool[] = [
      {
        name: "list_ready_invoices",
        title: "List ready invoices",
        description: "List AR invoices for a named customer that are locally ready for portal validation. This reads the signed-in supplier's live queue and does not submit or modify anything.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["customerName"],
          properties: { customerName: { type: "string", minLength: 1, maxLength: 160 } },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => {
          const customerName = (input as { customerName?: unknown }).customerName;
          const query = new URLSearchParams({ readyOnly: "true" });
          if (typeof customerName === "string") query.set("customerName", customerName);
          return api(`/api/agent/invoices?${query}`, { signal: options?.signal });
        },
      },
      {
        name: "get_submission_package",
        title: "Get submission package",
        description: "Read up to three complete, checksum-protected invoice packages for specific locally ready invoices. Returns only invoices authorized for the signed-in supplier and includes each PDF payload needed for AP validation.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["invoiceNumbers"],
          properties: { invoiceNumbers: invoiceNumberArray },
        },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: (input, options) => api("/api/agent/packages", {
          method: "POST", body: JSON.stringify(input), signal: options?.signal,
        }),
      },
      {
        name: "record_portal_result",
        title: "Record portal results",
        description: "Record portal references and receipt statuses returned by Acme AP for invoices that were actually submitted. This changes the OpenFinance queue; use only after verifying the AP result.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["idempotencyKey", "items"],
          properties: {
            idempotencyKey: { type: "string", minLength: 16, maxLength: 128 },
            items: { type: "array", minItems: 1, maxItems: 10, items: portalResultItem },
          },
        },
        annotations: { readOnlyHint: false },
        execute: async (input, options) => {
          const result = await api("/api/agent/delivery-events", {
            method: "POST",
            body: JSON.stringify({ eventType: "portal_result", ...(input as object) }),
            signal: options?.signal,
          });
          window.dispatchEvent(new Event("openfinance:data-changed"));
          return result;
        },
      },
      {
        name: "record_portal_exception",
        title: "Record portal exception",
        description: "Record a precise AP validation exception on invoices without submitting them. This changes their OpenFinance status to needs attention and creates an audit event.",
        inputSchema: {
          type: "object", additionalProperties: false, required: ["idempotencyKey", "items"],
          properties: {
            idempotencyKey: { type: "string", minLength: 16, maxLength: 128 },
            items: { type: "array", minItems: 1, maxItems: 10, items: portalExceptionItem },
          },
        },
        annotations: { readOnlyHint: false },
        execute: async (input, options) => {
          const result = await api("/api/agent/delivery-events", {
            method: "POST",
            body: JSON.stringify({ eventType: "portal_exception", ...(input as object) }),
            signal: options?.signal,
          });
          window.dispatchEvent(new Event("openfinance:data-changed"));
          return result;
        },
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
