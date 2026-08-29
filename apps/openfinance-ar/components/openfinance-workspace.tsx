"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/browser-api";
import type { ErpSyncResult, InvoiceQueueItem, SubmissionPackageItem } from "@/lib/domain/invoices";
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
  const eventType = typeof event.details.eventType === "string"
    ? event.details.eventType.replaceAll("_", " ")
    : event.action === "erp_invoice_sync_completed" ? "ERP invoice sync" : "delivery update";
  const itemCount = typeof event.details.itemCount === "number" ? event.details.itemCount : 0;
  return `${eventType} · ${itemCount} invoice${itemCount === 1 ? "" : "s"}`;
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

type OutcomeMode = "result" | "exception";

export function OpenFinanceWorkspace({ initialInvoices, initialAuditEvents, initialAuditAvailable, fullName, organizationName, signOutAction }: {
  initialInvoices: InvoiceQueueItem[];
  initialAuditEvents: AuditEvent[];
  initialAuditAvailable: boolean;
  fullName: string;
  organizationName: string;
  signOutAction: () => Promise<void>;
}) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const [auditEvents, setAuditEvents] = useState(initialAuditEvents);
  const [auditAvailable, setAuditAvailable] = useState(initialAuditAvailable);
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceQueueItem["status"]>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [packages, setPackages] = useState<SubmissionPackageItem[]>([]);
  const [outcomeMode, setOutcomeMode] = useState<OutcomeMode>("result");
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const body = await apiRequest<{
      invoices: InvoiceQueueItem[];
      auditEvents: AuditEvent[];
      auditAvailable: boolean;
    }>("/api/agent/workspace", { cache: "no-store" });
    setInvoices(body.invoices);
    setAuditEvents(body.auditEvents);
    setAuditAvailable(body.auditAvailable);
  }, []);

  useEffect(() => {
    const handleDataChanged = () => void refresh().catch(() => undefined);
    window.addEventListener("openfinance:data-changed", handleDataChanged);
    return () => window.removeEventListener("openfinance:data-changed", handleDataChanged);
  }, [refresh]);

  const metrics = useMemo(() => ({
    ready: invoices.filter((invoice) => invoice.status === "ready").length,
    exceptions: invoices.filter((invoice) => invoice.status === "needs_attention" || invoice.status === "rejected").length,
    delivered: invoices.filter((invoice) => invoice.status === "submitted" || invoice.status === "accepted").length,
  }), [invoices]);

  const filteredInvoices = useMemo(() => invoices.filter((invoice) => {
    const customerMatches = invoice.customerName.toLowerCase().includes(customerFilter.trim().toLowerCase());
    return customerMatches && (statusFilter === "all" || invoice.status === statusFilter);
  }), [customerFilter, invoices, statusFilter]);

  const selectedReady = selected.filter((number) => invoices.some(
    (invoice) => invoice.invoiceNumber === number && invoice.status === "ready",
  ));

  function clearFeedback() {
    setNotice(null);
    setError(null);
  }

  function toggleSelected(invoiceNumber: string) {
    clearFeedback();
    setSelected((current) => current.includes(invoiceNumber)
      ? current.filter((number) => number !== invoiceNumber)
      : current.length < 3 ? [...current, invoiceNumber] : current);
  }

  async function syncInvoices() {
    clearFeedback();
    setPendingAction("sync");
    try {
      const result = await apiRequest<ErpSyncResult>("/api/agent/erp-sync", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: idempotencyKey("ui-erp-sync") }),
      });
      await refresh();
      setNotice(result.importedCount === 0
        ? "ERP is current. No new invoices were available."
        : `${result.importedCount} new invoices were imported from the ERP.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ERP sync failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function reviewPackages() {
    clearFeedback();
    if (selectedReady.length === 0) {
      setError("Select at least one ready invoice to review.");
      return;
    }
    setPendingAction("package");
    try {
      const result = await apiRequest<{ items: SubmissionPackageItem[] }>("/api/agent/packages", {
        method: "POST",
        body: JSON.stringify({ invoiceNumbers: selectedReady }),
      });
      setPackages(result.items);
      setWorkbenchOpen(true);
      setNotice(`${result.items.length} submission package${result.items.length === 1 ? " is" : "s are"} ready for review.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Submission packages could not be prepared");
    } finally {
      setPendingAction(null);
    }
  }

  async function recordOutcome(formData: FormData) {
    clearFeedback();
    const invoiceNumber = String(formData.get("invoiceNumber") ?? "");
    if (!invoiceNumber) {
      setError("Choose an invoice before recording an outcome.");
      return;
    }
    setPendingAction("outcome");
    try {
      const request = outcomeMode === "result" ? {
        eventType: "portal_result",
        idempotencyKey: idempotencyKey("ui-portal-result"),
        items: [{
          invoiceNumber,
          portalReference: String(formData.get("portalReference") ?? ""),
          portalStatus: String(formData.get("portalStatus") ?? "received"),
        }],
      } : {
        eventType: "portal_exception",
        idempotencyKey: idempotencyKey("ui-portal-exception"),
        items: [{
          invoiceNumber,
          exceptionCode: String(formData.get("exceptionCode") ?? ""),
          message: String(formData.get("message") ?? ""),
        }],
      };
      await apiRequest("/api/agent/delivery-events", {
        method: "POST",
        body: JSON.stringify(request),
      });
      await refresh();
      setSelected((current) => current.filter((number) => number !== invoiceNumber));
      setPackages((current) => current.filter((item) => item.invoiceNumber !== invoiceNumber));
      setNotice(`${invoiceNumber} was updated and added to the audit trail.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The portal outcome could not be recorded");
    } finally {
      setPendingAction(null);
    }
  }

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
        <div><p className="eyebrow">Acme Manufacturing</p><h2 id="summary-title">Invoice delivery, ready for human + agent review</h2><p>Prepare, inspect, and record every portal delivery from the same live workspace.</p></div>
        <div className="metric"><strong>{metrics.ready}</strong><span>Ready</span></div>
        <div className="metric attention"><strong>{metrics.exceptions}</strong><span>Exception</span></div>
        <div className="metric delivered"><strong>{metrics.delivered}</strong><span>Delivered</span></div>
      </section>

      <section className="action-bar" aria-labelledby="actions-title">
        <div className="action-copy"><p className="eyebrow">Human workspace</p><h2 id="actions-title">Invoice operations</h2><p>Use the same governed capabilities available to your agent.</p></div>
        <div className="action-buttons">
          <button className="button secondary" type="button" onClick={() => void syncInvoices()} disabled={pendingAction !== null}>
            {pendingAction === "sync" ? "Syncing…" : "Sync invoices now"}
          </button>
          <button className="button primary" type="button" onClick={() => void reviewPackages()} disabled={selectedReady.length === 0 || pendingAction !== null}>
            Review package {selectedReady.length > 0 ? `(${selectedReady.length})` : ""}
          </button>
          <button className="button quiet" type="button" onClick={() => setWorkbenchOpen((open) => !open)}>
            {workbenchOpen ? "Close workbench" : "Record portal outcome"}
          </button>
        </div>
      </section>

      {(notice || error) && <div className={`notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error ?? notice}</div>}

      <section className="agent-guide" aria-label="Suggested agent task">
        <span className="agent-dot" aria-hidden="true" />
        <div><strong>Prefer delegation?</strong><p>Ask: “Submit all Acme invoices that are ready for their AP portal.”</p></div>
        <span className="agent-ready">4 site tools</span>
      </section>

      <section className="panel" aria-labelledby="invoice-title">
        <div className="panel-heading invoice-heading">
          <div><p className="eyebrow">Invoice queue</p><h2 id="invoice-title">Customer portal submissions</h2></div>
          <div className="filters" aria-label="Invoice filters">
            <label><span>Customer</span><input value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} placeholder="Filter customer" /></label>
            <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">All statuses</option><option value="ready">Ready</option><option value="needs_attention">Needs attention</option><option value="submitted">Submitted</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option>
            </select></label>
          </div>
        </div>
        <div className="selection-hint"><span>{selectedReady.length} of 3 ready invoices selected</span><span>Choose invoices to inspect their protected submission package.</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th className="select-column"><span className="sr-only">Select</span></th><th>Invoice</th><th>Customer</th><th>Amount</th><th>Purchase order</th><th>Status</th><th>Portal result</th></tr></thead>
          <tbody>{filteredInvoices.map((invoice) => {
            const isSelected = selected.includes(invoice.invoiceNumber);
            const selectionDisabled = invoice.status !== "ready" || (!isSelected && selectedReady.length >= 3);
            return <tr key={invoice.invoiceNumber} className={isSelected ? "selected-row" : undefined}>
              <td className="select-column"><input type="checkbox" aria-label={`Select ${invoice.invoiceNumber}`} checked={isSelected} disabled={selectionDisabled} onChange={() => toggleSelected(invoice.invoiceNumber)} /></td>
              <td><strong>{invoice.invoiceNumber}</strong><small>{invoice.invoiceDate}</small></td>
              <td>{invoice.customerName}</td>
              <td>{money.format(invoice.amountMinor / 100)}</td>
              <td>{invoice.purchaseOrderNumber ?? "Missing"}</td>
              <td><span className={`badge ${invoice.status}`}>{statusLabel(invoice)}</span></td>
              <td className="result-cell">{invoice.portalReference ?? invoice.exceptionMessage ?? "Awaiting portal review"}</td>
            </tr>;
          })}</tbody>
        </table></div>
        {filteredInvoices.length === 0 && <div className="empty-inline"><strong>No matching invoices</strong><p>Adjust the customer or status filter.</p></div>}
      </section>

      {workbenchOpen && <section className="workbench" aria-labelledby="workbench-title">
        <div className="workbench-heading"><div><p className="eyebrow">Manual capability</p><h2 id="workbench-title">Submission package and portal outcome</h2></div><span>{packages.length} packages loaded</span></div>
        <div className="workbench-grid">
          <div className="package-review">
            <h3>Package review</h3>
            {packages.length === 0 ? <div className="empty-compact"><strong>No package loaded</strong><p>Select up to three ready invoices and choose Review package.</p></div> : packages.map((item) => <article key={item.invoiceNumber}>
              <div><strong>{item.invoiceNumber}</strong><span>{money.format(item.amountMinor / 100)}</span></div>
              <dl><div><dt>Purchase order</dt><dd>{item.purchaseOrderNumber}</dd></div><div><dt>Document</dt><dd>{item.document.fileName}</dd></div><div><dt>Integrity</dt><dd title={item.document.sha256}>{item.document.sha256.slice(0, 12)}… verified</dd></div></dl>
            </article>)}
          </div>
          <form className="outcome-form" action={(formData) => void recordOutcome(formData)}>
            <div><h3>Record portal outcome</h3><p>Use after a manual submission or validation performed outside the agent flow.</p></div>
            <div className="segmented" role="group" aria-label="Outcome type">
              <button type="button" aria-pressed={outcomeMode === "result"} onClick={() => setOutcomeMode("result")}>Submitted</button>
              <button type="button" aria-pressed={outcomeMode === "exception"} onClick={() => setOutcomeMode("exception")}>Exception</button>
            </div>
            <label><span>Invoice</span><select key={`${outcomeMode}-${selectedReady[0] ?? ""}`} name="invoiceNumber" required defaultValue={selectedReady[0] ?? ""}>
              <option value="" disabled>Select an invoice</option>{invoices.filter((invoice) => outcomeMode === "result"
                ? invoice.status === "ready"
                : invoice.status === "ready" || invoice.status === "needs_attention").map((invoice) => <option key={invoice.invoiceNumber} value={invoice.invoiceNumber}>{invoice.invoiceNumber}</option>)}
            </select></label>
            {outcomeMode === "result" ? <>
              <label><span>Portal reference</span><input name="portalReference" required minLength={1} maxLength={120} placeholder="ACME-2026-…" /></label>
              <label><span>Portal status</span><select name="portalStatus" defaultValue="received"><option value="received">Received</option><option value="under_review">Under review</option><option value="accepted">Accepted</option></select></label>
            </> : <>
              <label><span>Exception code</span><input name="exceptionCode" required pattern="[a-z][a-z0-9_]{1,63}" placeholder="amount_exceeds_balance" /></label>
              <label><span>Actionable message</span><textarea name="message" required minLength={1} maxLength={500} placeholder="Explain what must be corrected." /></label>
            </>}
            <button className="button primary full" type="submit" disabled={pendingAction !== null}>{pendingAction === "outcome" ? "Recording…" : "Record outcome"}</button>
          </form>
        </div>
      </section>}

      <section className="panel" aria-labelledby="activity-title">
        <div className="panel-heading"><div><p className="eyebrow">Audit trail</p><h2 id="activity-title">Recent delivery activity</h2></div><span>{auditAvailable ? `${auditEvents.length} events` : "Unavailable"}</span></div>
        {!auditAvailable ? <p className="panel-message" role="status">Recent activity is temporarily unavailable. Reload to try again.</p> : auditEvents.length === 0 ? <p className="panel-message">No portal activity recorded yet.</p> : <ol className="audit-list">
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
