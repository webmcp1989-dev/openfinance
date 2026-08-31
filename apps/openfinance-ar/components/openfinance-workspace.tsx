"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/browser-api";
import type { ErpSyncResult, InvoiceQueueItem, InvoiceSupportingDocument, SubmissionPackageItem } from "@/lib/domain/invoices";
import type { AuditEvent } from "@/lib/services/audit-service";
import type { PortalFollowup } from "@/lib/services/invoice-service";
import { OpenFinanceSiteTools } from "./openfinance-site-tools";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const timestamp = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

type InvoiceDisplayStatus = InvoiceQueueItem["status"] | "paid" | "partially_paid";

function displayStatus(invoice: InvoiceQueueItem): InvoiceDisplayStatus {
  if (invoice.paidAmountMinor >= invoice.amountMinor) return "paid";
  if (invoice.paidAmountMinor > 0) return "partially_paid";
  return invoice.status;
}

function statusLabel(invoice: InvoiceQueueItem) {
  const status = displayStatus(invoice);
  const labels: Record<InvoiceQueueItem["status"], string> = {
    ready: "Ready", needs_attention: "Needs attention", submitted: "Submitted",
    accepted: "Accepted", rejected: "Rejected",
  };
  if (status === "paid") return "Paid";
  if (status === "partially_paid") return "Partially paid";
  return labels[status];
}

function auditSummary(event: AuditEvent) {
  if (event.action === "demo_state_reset") {
    return "Canonical synthetic AR data restored";
  }
  if (event.action === "payment_remittance_recorded") {
    const invoiceNumber = typeof event.details.invoiceNumber === "string" ? event.details.invoiceNumber : "Invoice";
    const paymentReference = typeof event.details.paymentReference === "string" ? event.details.paymentReference : "verified remittance";
    return `${invoiceNumber} · ${paymentReference}`;
  }
  const eventType = typeof event.details.eventType === "string"
    ? event.details.eventType.replaceAll("_", " ")
    : event.action === "erp_invoice_sync_completed" ? "ERP invoice sync" : "delivery update";
  const itemCount = typeof event.details.itemCount === "number" ? event.details.itemCount : 0;
  return `${eventType} · ${itemCount} invoice${itemCount === 1 ? "" : "s"}`;
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function parseAmountMinor(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter an amount with no more than two decimal places.");
  const amountMinor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Enter a valid positive amount.");
  return amountMinor;
}

type OutcomeMode = "result" | "exception";

export function OpenFinanceWorkspace({ initialInvoices, initialFollowups, initialAuditEvents, initialAuditAvailable, fullName, organizationName, signOutAction }: {
  initialInvoices: InvoiceQueueItem[];
  initialFollowups: PortalFollowup[];
  initialAuditEvents: AuditEvent[];
  initialAuditAvailable: boolean;
  fullName: string;
  organizationName: string;
  signOutAction: () => Promise<void>;
}) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const [followups, setFollowups] = useState(initialFollowups);
  const [supportingDocuments, setSupportingDocuments] = useState<{ invoiceNumber: string; documents: InvoiceSupportingDocument[] } | null>(null);
  const [auditEvents, setAuditEvents] = useState(initialAuditEvents);
  const [auditAvailable, setAuditAvailable] = useState(initialAuditAvailable);
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceDisplayStatus>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [packages, setPackages] = useState<SubmissionPackageItem[]>([]);
  const [outcomeMode, setOutcomeMode] = useState<OutcomeMode>("result");
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const body = await apiRequest<{
      invoices: InvoiceQueueItem[];
      followups: PortalFollowup[];
      auditEvents: AuditEvent[];
      auditAvailable: boolean;
    }>("/api/agent/workspace", { cache: "no-store" });
    setInvoices(body.invoices);
    setFollowups(body.followups);
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
    return customerMatches && (statusFilter === "all" || displayStatus(invoice) === statusFilter);
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

  async function restoreDemo() {
    clearFeedback();
    setPendingAction("reset");
    try {
      await apiRequest("/api/demo/reset", {
        method: "POST",
        body: JSON.stringify({ confirmation: "restore-canonical-demo" }),
      });
      setSelected([]);
      setPackages([]);
      setWorkbenchOpen(false);
      setResetOpen(false);
      await refresh();
      setNotice("OpenFinance AR was restored to the canonical synthetic starting state.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The synthetic demo could not be restored");
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
          ...(String(formData.get("supersedesPortalReference") ?? "").trim()
            ? { supersedesPortalReference: String(formData.get("supersedesPortalReference")).trim() }
            : {}),
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

  async function loadSupportingDocuments(invoiceNumber: string) {
    clearFeedback();
    setPendingAction(`documents:${invoiceNumber}`);
    try {
      const result = await apiRequest<{ invoiceNumber: string; documents: InvoiceSupportingDocument[] }>("/api/agent/supporting-documents", {
        method: "POST", body: JSON.stringify({ invoiceNumber }),
      });
      setSupportingDocuments(result);
      setNotice(result.documents.length === 0
        ? `${invoiceNumber} has no supporting documents.`
        : `${result.documents.length} supporting document${result.documents.length === 1 ? " is" : "s are"} ready below for ${invoiceNumber}.`);
      document.querySelector("#followup-title")?.scrollIntoView({ behavior: "smooth" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Supporting documents could not be loaded");
    } finally {
      setPendingAction(null);
    }
  }

  function downloadSupportingDocument(document: InvoiceSupportingDocument) {
    const binary = atob(document.contentBase64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: document.mediaType }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = document.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function recordRemittance(formData: FormData) {
    clearFeedback();
    if (formData.get("confirmation") !== "approved") {
      setError("Review and confirm the exact payment before recording it.");
      return;
    }
    setPendingAction("remittance");
    try {
      const invoiceNumber = String(formData.get("invoiceNumber") ?? "");
      await apiRequest("/api/agent/remittances", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: idempotencyKey("ui-remittance"),
          invoiceNumber,
          paymentReference: String(formData.get("paymentReference") ?? ""),
          amountMinor: parseAmountMinor(String(formData.get("amount") ?? "")),
          currency: "USD",
          paymentMethod: String(formData.get("paymentMethod") ?? "ach"),
          paidAt: new Date(String(formData.get("paidAt") ?? "")).toISOString(),
        }),
      });
      await refresh();
      setNotice(`${invoiceNumber} payment remittance was reconciled into OpenFinance.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Payment remittance could not be recorded");
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
        <div><strong>19 tools, zero cross-writes</strong><p>These 7 site tools write only OpenFinance AR; Acme&apos;s 12 write only its AP portal. Your agent reconciles both live views, and you alone authorize data crossing between them.</p></div>
      </section>

      <section className="demo-controls" aria-labelledby="demo-controls-title">
        <div>
          <p className="eyebrow">Synthetic challenge environment</p>
          <h2 id="demo-controls-title">Need a fresh demo run?</h2>
          <p>Restore only this AR workspace, then restore the independent AP portal separately.</p>
        </div>
        {!resetOpen ? <button className="button quiet" type="button" onClick={() => setResetOpen(true)} disabled={pendingAction !== null}>
          Restore demo start
        </button> : <div className="reset-confirmation" role="group" aria-label="Confirm OpenFinance demo reset">
          <p><strong>Restore the synthetic AR portfolio?</strong><span>Portal results, imported ERP invoices, remittance writebacks, and workflow events will be replaced by the canonical 24-invoice queue with seven ready packages.</span></p>
          <div>
            <button className="button quiet" type="button" onClick={() => setResetOpen(false)} disabled={pendingAction !== null}>Cancel</button>
            <button className="button danger" type="button" onClick={() => void restoreDemo()} disabled={pendingAction !== null}>
              {pendingAction === "reset" ? "Restoring…" : "Restore synthetic AR data"}
            </button>
          </div>
        </div>}
      </section>

      <section className="panel" aria-labelledby="invoice-title">
        <div className="panel-heading invoice-heading">
          <div><p className="eyebrow">Invoice queue</p><h2 id="invoice-title">Customer portal submissions</h2></div>
          <div className="filters" aria-label="Invoice filters">
            <label><span>Customer</span><input value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} placeholder="Filter customer" /></label>
            <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="all">All statuses</option><option value="ready">Ready</option><option value="needs_attention">Needs attention</option><option value="submitted">Submitted</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option>
            </select></label>
          </div>
        </div>
        <div className="selection-hint">
          <div className="selection-copy">
            <span className="selection-count">{selectedReady.length} of {metrics.ready} ready invoices selected</span>
            <span>{selectedReady.length === 0
              ? "Select a ready invoice to reveal its human download."
              : "Download now, or review the protected package before portal submission."}</span>
          </div>
          {selectedReady.length > 0 && <div className="selection-actions" aria-label="Selected invoice downloads">
            {selectedReady.map((invoiceNumber) => <a
              key={invoiceNumber}
              className="button secondary selection-download"
              href={`/api/agent/invoices/${encodeURIComponent(invoiceNumber)}/document`}
              download={`${invoiceNumber}.pdf`}
              aria-label={`Download selected invoice ${invoiceNumber} PDF`}
            >
              Download {invoiceNumber}
            </a>)}
          </div>}
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th className="select-column"><span className="sr-only">Select</span></th><th>Invoice</th><th>Customer</th><th>Amount</th><th>Purchase order</th><th>Status</th><th>Portal result</th><th>Evidence</th></tr></thead>
          <tbody>{filteredInvoices.map((invoice) => {
            const isSelected = selected.includes(invoice.invoiceNumber);
            const selectionDisabled = invoice.status !== "ready" || (!isSelected && selectedReady.length >= 3);
            return <tr key={invoice.invoiceNumber} className={isSelected ? "selected-row" : undefined}>
              <td className="select-column"><input type="checkbox" aria-label={`Select ${invoice.invoiceNumber}`} checked={isSelected} disabled={selectionDisabled} onChange={() => toggleSelected(invoice.invoiceNumber)} /></td>
              <td><strong>{invoice.invoiceNumber}</strong><small>{invoice.invoiceDate}</small></td>
              <td>{invoice.customerName}</td>
              <td>{money.format(invoice.amountMinor / 100)}</td>
              <td>{invoice.purchaseOrderNumber ?? "Missing"}</td>
              <td><span className={`badge ${displayStatus(invoice)}`}>{statusLabel(invoice)}</span></td>
              <td className="result-cell">{invoice.portalReference ?? invoice.exceptionMessage ?? "Awaiting portal review"}</td>
              <td><button className="text-button" type="button" onClick={() => void loadSupportingDocuments(invoice.invoiceNumber)} disabled={pendingAction !== null}>{pendingAction === `documents:${invoice.invoiceNumber}` ? "Loading…" : "View evidence"}</button></td>
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
              <div className="document-actions">
                <p>Download this verified PDF, then upload it in Acme AP for manual validation.</p>
                <a className="button secondary" href={`/api/agent/invoices/${encodeURIComponent(item.invoiceNumber)}/document`} download={item.document.fileName} aria-label={`Download ${item.invoiceNumber} PDF`}>
                  Download PDF
                </a>
              </div>
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
                ? invoice.status === "ready" || invoice.status === "submitted"
                : invoice.status === "ready" || invoice.status === "needs_attention").map((invoice) => <option key={invoice.invoiceNumber} value={invoice.invoiceNumber}>{invoice.invoiceNumber}</option>)}
            </select></label>
            {outcomeMode === "result" ? <>
              <label><span>Portal reference</span><input name="portalReference" required minLength={1} maxLength={120} placeholder="ACME-2026-…" /></label>
              <label><span>Superseded portal reference <small>(replacement only)</small></span><input name="supersedesPortalReference" minLength={1} maxLength={120} placeholder="Exact prior Acme reference" /></label>
              <label><span>Portal status</span><select name="portalStatus" defaultValue="received"><option value="received">Received</option><option value="under_review">Under review</option><option value="accepted">Accepted</option></select></label>
            </> : <>
              <label><span>Exception code</span><input name="exceptionCode" required pattern="[a-z][a-z0-9_]{1,63}" placeholder="amount_exceeds_balance" /></label>
              <label><span>Actionable message</span><textarea name="message" required minLength={1} maxLength={500} placeholder="Explain what must be corrected." /></label>
            </>}
            <button className="button primary full" type="submit" disabled={pendingAction !== null}>{pendingAction === "outcome" ? "Recording…" : "Record outcome"}</button>
          </form>
        </div>
      </section>}

      <section className="workbench" aria-labelledby="followup-title">
        <div className="workbench-heading"><div><p className="eyebrow">Exception to cash</p><h2 id="followup-title">Portal follow-ups and remittance</h2></div><span>{followups.length} actionable</span></div>
        <div className="workbench-grid">
          <div className="package-review">
            <h3>Invoices needing follow-up</h3>
            {followups.length === 0 ? <div className="empty-compact"><strong>No follow-ups</strong><p>Submitted invoices are current and no balance needs attention.</p></div> : followups.map((followup) => <article key={followup.invoiceNumber}>
              <div><strong>{followup.invoiceNumber}</strong><span>{followup.followupReason.replaceAll("_", " ")}</span></div>
              <p>{followup.suggestedAction}</p>
              <dl><div><dt>Remaining due</dt><dd>{money.format(followup.remainingDueMinor / 100)}</dd></div><div><dt>Due date</dt><dd>{followup.dueDate}</dd></div></dl>
              {followup.status === "rejected" && <a
                className="button secondary"
                href={`/api/agent/invoices/${encodeURIComponent(followup.invoiceNumber)}/document`}
                download={`${followup.invoiceNumber}.pdf`}
                aria-label={`Download rejected invoice ${followup.invoiceNumber} correction source PDF`}
              >Download correction source</a>}
              <button className="button secondary" type="button" onClick={() => void loadSupportingDocuments(followup.invoiceNumber)} disabled={pendingAction !== null}>Supporting documents</button>
            </article>)}
            {supportingDocuments && <div className="empty-compact"><strong>{supportingDocuments.invoiceNumber} evidence</strong>
              {supportingDocuments.documents.length === 0 ? <p>No supporting documents are stored.</p> : supportingDocuments.documents.map((document) => <button className="button secondary" type="button" key={`${document.documentKind}-${document.sha256}`} onClick={() => downloadSupportingDocument(document)}>{document.documentKind.replaceAll("_", " ")} · {document.fileName}</button>)}
            </div>}
          </div>
          <form className="outcome-form" action={(formData) => void recordRemittance(formData)}>
            <div><h3>Finish on cash</h3><p>Use only after get_payment_remittance returns the customer&apos;s completed allocation. Recording it here closes the AR balance; AP cannot write this state.</p></div>
            <label><span>Invoice</span><select name="invoiceNumber" required defaultValue=""><option value="" disabled>Select submitted invoice</option>{invoices.filter((invoice) => invoice.portalReference && invoice.paidAmountMinor < invoice.amountMinor).map((invoice) => <option key={invoice.invoiceNumber} value={invoice.invoiceNumber}>{invoice.invoiceNumber} · {money.format((invoice.amountMinor - invoice.paidAmountMinor) / 100)} due</option>)}</select></label>
            <label><span>Payment reference</span><input name="paymentReference" required maxLength={120} placeholder="PAY-20260830-AB12CD34" /></label>
            <label><span>Paid amount</span><input name="amount" required inputMode="decimal" pattern="\d+(\.\d{1,2})?" placeholder="18420.00" /></label>
            <label><span>Payment method</span><select name="paymentMethod" defaultValue="ach"><option value="ach">ACH</option><option value="wire">Wire</option><option value="check">Check</option><option value="card">Card</option><option value="other">Other</option></select></label>
            <label><span>Paid at</span><input name="paidAt" type="datetime-local" required /></label>
            <label className="confirmation"><input name="confirmation" type="checkbox" value="approved" /><span>I verified this exact reference, invoice allocation, amount, and payment date in the customer portal.</span></label>
            <button className="button primary full" type="submit" disabled={pendingAction !== null}>{pendingAction === "remittance" ? "Recording…" : "Record verified remittance"}</button>
          </form>
        </div>
      </section>

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
