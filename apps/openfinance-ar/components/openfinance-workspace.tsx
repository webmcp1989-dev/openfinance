"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { InvoiceQueueItem } from "@/lib/domain/invoices";
import type { AuditEvent } from "@/lib/services/audit-service";
import { OpenFinanceSiteTools } from "./openfinance-site-tools";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const timestamp = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

function statusLabel(invoice: InvoiceQueueItem) {
  const labels: Record<InvoiceQueueItem["status"], string> = {
    ready: "Ready", needs_attention: "Needs attention", submitted: "Submitted",
    accepted: "Accepted", rejected: "Rejected",
  };
  return labels[invoice.status];
}

function auditSummary(event: AuditEvent) {
  const eventType = typeof event.details.eventType === "string" ? event.details.eventType.replaceAll("_", " ") : "delivery update";
  const itemCount = typeof event.details.itemCount === "number" ? event.details.itemCount : 0;
  return `${eventType} · ${itemCount} invoice${itemCount === 1 ? "" : "s"}`;
}

export function OpenFinanceWorkspace({ initialInvoices, initialAuditEvents, fullName, organizationName, signOutAction }: {
  initialInvoices: InvoiceQueueItem[];
  initialAuditEvents: AuditEvent[];
  fullName: string;
  organizationName: string;
  signOutAction: () => Promise<void>;
}) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const [auditEvents, setAuditEvents] = useState(initialAuditEvents);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/agent/workspace", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { invoices: InvoiceQueueItem[]; auditEvents: AuditEvent[] };
    setInvoices(body.invoices);
    setAuditEvents(body.auditEvents);
  }, []);

  useEffect(() => {
    window.addEventListener("openfinance:data-changed", refresh);
    return () => window.removeEventListener("openfinance:data-changed", refresh);
  }, [refresh]);

  const metrics = useMemo(() => ({
    ready: invoices.filter((invoice) => invoice.status === "ready").length,
    exceptions: invoices.filter((invoice) => invoice.status === "needs_attention" || invoice.status === "rejected").length,
    delivered: invoices.filter((invoice) => invoice.status === "submitted" || invoice.status === "accepted").length,
  }), [invoices]);

  return (
    <main className="shell">
      <OpenFinanceSiteTools />
      <header className="topbar">
        <div><p className="eyebrow">OpenFinance</p><h1>Portal delivery</h1></div>
        <div className="identity" aria-label="Signed-in organization">
          <div><span>{fullName}</span><small>{organizationName}</small></div>
          <form action={signOutAction}><button className="text-button" type="submit">Sign out</button></form>
        </div>
      </header>

      <section className="summary" aria-labelledby="summary-title">
        <div><p className="eyebrow">Acme Manufacturing</p><h2 id="summary-title">Invoice delivery, ready for human + agent review</h2><p>The agent can prepare and validate the batch. You approve exactly what is submitted.</p></div>
        <div className="metric"><strong>{metrics.ready}</strong><span>Ready</span></div>
        <div className="metric attention"><strong>{metrics.exceptions}</strong><span>Exception</span></div>
        <div className="metric delivered"><strong>{metrics.delivered}</strong><span>Delivered</span></div>
      </section>

      <section className="agent-guide" aria-label="Suggested agent task">
        <span className="agent-dot" aria-hidden="true" />
        <div><strong>Try with your agent</strong><p>“Submit all Acme invoices that are ready for their AP portal.”</p></div>
        <span className="agent-ready">4 site tools</span>
      </section>

      <section className="panel" aria-labelledby="invoice-title">
        <div className="panel-heading"><div><p className="eyebrow">Invoice queue</p><h2 id="invoice-title">Customer portal submissions</h2></div><span className="agent-ready">WebMCP ready</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Invoice</th><th>Amount</th><th>Purchase order</th><th>Status</th><th>Portal result</th></tr></thead>
          <tbody>{invoices.map((invoice) => (
            <tr key={invoice.invoiceNumber}>
              <td><strong>{invoice.invoiceNumber}</strong><small>{invoice.invoiceDate}</small></td>
              <td>{money.format(invoice.amountMinor / 100)}</td>
              <td>{invoice.purchaseOrderNumber ?? "Missing"}</td>
              <td><span className={`badge ${invoice.status}`}>{statusLabel(invoice)}</span></td>
              <td className="result-cell">{invoice.portalReference ?? invoice.exceptionMessage ?? "Awaiting portal review"}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      <section className="panel" aria-labelledby="activity-title">
        <div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h2 id="activity-title">Recent delivery activity</h2></div><span>{auditEvents.length} events</span></div>
        {auditEvents.length === 0 ? <p>No portal activity recorded yet.</p> : <ol className="audit-list">
          {auditEvents.map((event) => <li key={event.id}>
            <strong>{event.action.replaceAll("_", " ")}</strong>
            <span>{auditSummary(event)}</span>
            <time dateTime={event.createdAt}>{timestamp.format(new Date(event.createdAt))}</time>
          </li>)}
        </ol>}
      </section>
    </main>
  );
}
