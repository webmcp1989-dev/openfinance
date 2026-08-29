"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiRequest } from "@/lib/browser-api";
import type {
  InvoiceCandidate,
  PurchaseOrder,
  SubmissionRequirements,
  ValidationIssue,
} from "@/lib/domain/submissions";
import type { AuditEvent } from "@/lib/services/audit-service";
import type { SubmissionRow } from "@/lib/services/submission-service";
import { AcmeSiteTools } from "./acme-site-tools";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const timestamp = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });

type ValidationResult = Readonly<{
  valid: boolean;
  invoiceNumber: string;
  purchaseOrder: PurchaseOrder | null;
  issues: ValidationIssue[];
}>;

function auditSummary(event: AuditEvent) {
  const itemCount = typeof event.details.itemCount === "number" ? event.details.itemCount : 0;
  return `${itemCount} invoice${itemCount === 1 ? "" : "s"} · batch ${event.entityId.slice(0, 8)}`;
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function parseAmountMinor(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Enter an amount with no more than two decimal places.");
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const amountMinor = dollars * 100 + cents;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Enter a valid positive amount.");
  return amountMinor;
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function fileDocument(file: File, requirements: SubmissionRequirements) {
  if (!requirements.acceptedMediaTypes.includes(file.type)) throw new Error("Choose a PDF invoice document.");
  if (file.size > requirements.maxDocumentBytes) throw new Error("The PDF is larger than the portal limit.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(file.name)) {
    throw new Error("Use a file name containing only letters, numbers, dots, dashes, and underscores.");
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return {
    fileName: file.name,
    mediaType: "application/pdf" as const,
    contentBase64: btoa(binary),
    sha256: hex(await crypto.subtle.digest("SHA-256", buffer)),
  };
}

export function AcmeWorkspace({
  initialRequirements, initialPurchaseOrders, initialSubmissions, initialAuditEvents, initialAuditAvailable, supplierName, supplierCode, signOutAction,
}: {
  initialRequirements: SubmissionRequirements;
  initialPurchaseOrders: PurchaseOrder[];
  initialSubmissions: SubmissionRow[];
  initialAuditEvents: AuditEvent[];
  initialAuditAvailable: boolean;
  supplierName: string;
  supplierCode: string;
  signOutAction: () => Promise<void>;
}) {
  const [requirements] = useState(initialRequirements);
  const [purchaseOrders, setPurchaseOrders] = useState(initialPurchaseOrders);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [auditEvents, setAuditEvents] = useState(initialAuditEvents);
  const [auditAvailable, setAuditAvailable] = useState(initialAuditAvailable);
  const [purchaseOrderLookup, setPurchaseOrderLookup] = useState<PurchaseOrder | null | undefined>(undefined);
  const [statusLookup, setStatusLookup] = useState<SubmissionRow | null | undefined>(undefined);
  const [candidatePurchaseOrder, setCandidatePurchaseOrder] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validatedBatch, setValidatedBatch] = useState<InvoiceCandidate[]>([]);
  const [confirmation, setConfirmation] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const body = await apiRequest<{
      purchaseOrders: PurchaseOrder[];
      submissions: SubmissionRow[];
      auditEvents: AuditEvent[];
      auditAvailable: boolean;
    }>("/api/agent/workspace", { cache: "no-store" });
    setPurchaseOrders(body.purchaseOrders);
    setSubmissions(body.submissions);
    setAuditEvents(body.auditEvents);
    setAuditAvailable(body.auditAvailable);
  }, []);

  useEffect(() => {
    const handleDataChanged = () => void refresh().catch(() => undefined);
    window.addEventListener("acme:data-changed", handleDataChanged);
    return () => window.removeEventListener("acme:data-changed", handleDataChanged);
  }, [refresh]);

  const batchTotal = useMemo(
    () => validatedBatch.reduce((sum, candidate) => sum + candidate.amountMinor, 0),
    [validatedBatch],
  );

  function clearFeedback() {
    setNotice(null);
    setError(null);
  }

  async function findPurchaseOrder(formData: FormData) {
    clearFeedback();
    setPendingAction("po");
    try {
      const purchaseOrderNumber = String(formData.get("purchaseOrderNumber") ?? "").toUpperCase();
      const result = await apiRequest<{ found: boolean; purchaseOrder: PurchaseOrder | null }>("/api/agent/purchase-orders", {
        method: "POST",
        body: JSON.stringify({ purchaseOrderNumber }),
      });
      setPurchaseOrderLookup(result.purchaseOrder);
      if (result.purchaseOrder) setCandidatePurchaseOrder(result.purchaseOrder.purchaseOrderNumber);
      else setNotice(`${purchaseOrderNumber} is not available to this supplier.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Purchase order lookup failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function findInvoiceStatus(formData: FormData) {
    clearFeedback();
    setPendingAction("status");
    try {
      const invoiceNumber = String(formData.get("invoiceNumber") ?? "").toUpperCase();
      const result = await apiRequest<{ found: boolean; submission: SubmissionRow | null }>("/api/agent/status", {
        method: "POST",
        body: JSON.stringify({ invoiceNumber }),
      });
      setStatusLookup(result.submission);
      if (!result.submission) setNotice(`${invoiceNumber} has no portal receipt yet.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invoice status lookup failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function validateCandidate(formData: FormData) {
    clearFeedback();
    setValidation(null);
    setPendingAction("validate");
    try {
      const file = formData.get("document");
      if (!(file instanceof File) || file.size === 0) throw new Error("Choose the invoice PDF to validate.");
      const invoiceNumber = String(formData.get("invoiceNumber") ?? "").toUpperCase();
      const candidate: InvoiceCandidate = {
        invoiceNumber,
        invoiceDate: String(formData.get("invoiceDate") ?? ""),
        amountMinor: parseAmountMinor(String(formData.get("amount") ?? "")),
        currency: String(formData.get("currency") ?? "USD").toUpperCase(),
        purchaseOrderNumber: String(formData.get("candidatePurchaseOrder") ?? "").toUpperCase(),
        document: await fileDocument(file, requirements),
      };
      const result = await apiRequest<ValidationResult>("/api/agent/validate", {
        method: "POST",
        body: JSON.stringify(candidate),
      });
      setValidation(result);
      if (result.valid) {
        setValidatedBatch((current) => {
          const withoutSameInvoice = current.filter((item) => item.invoiceNumber !== candidate.invoiceNumber);
          return withoutSameInvoice.length >= 3 ? withoutSameInvoice : [...withoutSameInvoice, candidate];
        });
        setConfirmation(false);
        setNotice(`${candidate.invoiceNumber} passed preflight and was added to the review batch.`);
        setFileInputKey((key) => key + 1);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invoice validation failed");
    } finally {
      setPendingAction(null);
    }
  }

  async function submitBatch() {
    clearFeedback();
    if (validatedBatch.length === 0 || !confirmation) {
      setError("Review the exact batch and confirm it before submission.");
      return;
    }
    setPendingAction("submit");
    try {
      const result = await apiRequest<{ items: Array<{ invoiceNumber: string; portalReference: string }> }>("/api/agent/submissions", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: idempotencyKey("ui-ap-submit"),
          invoices: validatedBatch,
        }),
      });
      await refresh();
      setValidatedBatch([]);
      setValidation(null);
      setConfirmation(false);
      setNotice(`${result.items.length} invoice${result.items.length === 1 ? " was" : "s were"} submitted and received portal references.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invoice batch could not be submitted");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="portal-shell">
      <AcmeSiteTools />
      <header className="portal-header">
        <div className="wordmark"><span className="mark">A</span><span>Acme Supplier Portal</span></div>
        <nav aria-label="Primary navigation"><a href="#operations">Submit invoice</a><a href="#orders">Purchase orders</a><a href="#submissions">Receipts</a></nav>
        <div className="supplier"><div><small>Signed in as</small><strong>{supplierName}</strong><span>{supplierCode}</span></div><form action={signOutAction}><button className="signout" type="submit">Sign out</button></form></div>
      </header>

      <section className="intro">
        <div><p className="kicker">Accounts payable</p><h1>Supplier workspace</h1><p>Find purchase orders, validate invoices, submit approved batches, and track receipts.</p></div>
        <span className="tool-status">5 authenticated site tools</span>
      </section>

      <section className="agent-guide" aria-label="Human and agent workflow">
        <span className="pulse" aria-hidden="true" />
        <div><strong>One workspace, two ways to work</strong><p>Complete every operation yourself below, or delegate discovery and preparation to your agent while retaining submission approval.</p></div>
      </section>

      <section className="requirements" aria-labelledby="requirements-title">
        <div><p className="kicker">Live submission policy</p><h2 id="requirements-title">Invoice requirements</h2></div>
        <ul><li>Open PO required</li><li>PDF up to {Math.round(requirements.maxDocumentBytes / 1_048_576)} MB</li><li>Unique invoice number</li><li>Within remaining balance</li></ul>
      </section>

      {(notice || error) && <div className={`portal-notice ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error ?? notice}</div>}

      <section className="operations" id="operations" aria-labelledby="operations-title">
        <div className="section-heading"><div><p className="kicker">Human workspace</p><h2 id="operations-title">Invoice operations</h2></div><span>Same governed backend</span></div>
        <div className="lookup-grid">
          <form className="lookup-card" action={(formData) => void findPurchaseOrder(formData)}>
            <div><span className="step-number">1</span><div><strong>Find a purchase order</strong><p>Confirm live status and available balance.</p></div></div>
            <label><span>PO number</span><div className="inline-field"><input name="purchaseOrderNumber" required pattern="[A-Z0-9][A-Z0-9-]{1,39}" placeholder="PO-8821" /><button type="submit" disabled={pendingAction !== null}>{pendingAction === "po" ? "Finding…" : "Find PO"}</button></div></label>
            {purchaseOrderLookup && <div className="lookup-result"><strong>{purchaseOrderLookup.purchaseOrderNumber}</strong><span className={`state ${purchaseOrderLookup.status}`}>{purchaseOrderLookup.status}</span><p>{purchaseOrderLookup.description}</p><b>{money.format(purchaseOrderLookup.remainingAmountMinor / 100)} remaining</b></div>}
          </form>
          <form className="lookup-card" action={(formData) => void findInvoiceStatus(formData)}>
            <div><span className="step-number neutral">4</span><div><strong>Track an invoice</strong><p>Retrieve its current receipt and status.</p></div></div>
            <label><span>Invoice number</span><div className="inline-field"><input name="invoiceNumber" required pattern="[A-Z0-9][A-Z0-9-]{1,39}" placeholder="INV-10482" /><button type="submit" disabled={pendingAction !== null}>{pendingAction === "status" ? "Checking…" : "Check status"}</button></div></label>
            {statusLookup && <div className="lookup-result"><strong>{statusLookup.invoiceNumber}</strong><span className="state open">{statusLookup.status}</span><p>{statusLookup.portalReference}</p><b>{money.format(statusLookup.amountMinor / 100)}</b></div>}
          </form>
        </div>

        <div className="submission-workbench">
          <form className="candidate-form" action={(formData) => void validateCandidate(formData)}>
            <div className="form-heading"><span className="step-number">2</span><div><h3>Validate an invoice</h3><p>Upload the exact PDF and run a read-only preflight.</p></div></div>
            <div className="field-grid">
              <label><span>Invoice number</span><input name="invoiceNumber" required pattern="[A-Z0-9][A-Z0-9-]{1,39}" placeholder="INV-10482" /></label>
              <label><span>Invoice date</span><input name="invoiceDate" type="date" required /></label>
              <label><span>Amount</span><div className="money-field"><span>$</span><input name="amount" inputMode="decimal" required pattern="\d+(\.\d{1,2})?" placeholder="18420.00" /></div></label>
              <label><span>Currency</span><input name="currency" defaultValue="USD" required pattern="[A-Z]{3}" maxLength={3} /></label>
              <label><span>Purchase order</span><input name="candidatePurchaseOrder" value={candidatePurchaseOrder} onChange={(event) => setCandidatePurchaseOrder(event.target.value.toUpperCase())} required pattern="[A-Z0-9][A-Z0-9-]{1,39}" placeholder="PO-8821" /></label>
              <label className="file-field"><span>Invoice PDF</span><input key={fileInputKey} name="document" type="file" accept="application/pdf,.pdf" required /></label>
            </div>
            <button className="portal-button secondary" type="submit" disabled={pendingAction !== null || validatedBatch.length >= 3}>{pendingAction === "validate" ? "Validating…" : "Validate and add to batch"}</button>
            {validation && <div className={`validation-result ${validation.valid ? "valid" : "invalid"}`} role="status">
              <strong>{validation.valid ? `${validation.invoiceNumber} passed every portal rule` : `${validation.invoiceNumber} needs attention`}</strong>
              {validation.issues.length > 0 && <ul>{validation.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>}
            </div>}
          </form>

          <div className="batch-review">
            <div className="form-heading"><span className="step-number">3</span><div><h3>Review and submit</h3><p>Only validated invoices can enter this batch.</p></div></div>
            {validatedBatch.length === 0 ? <div className="batch-empty"><strong>No validated invoices yet</strong><p>Validate up to three invoices to build an atomic submission batch.</p></div> : <>
              <ol className="batch-list">{validatedBatch.map((candidate) => <li key={candidate.invoiceNumber}>
                <div><strong>{candidate.invoiceNumber}</strong><span>{candidate.purchaseOrderNumber}</span></div><b>{money.format(candidate.amountMinor / 100)}</b><button type="button" aria-label={`Remove ${candidate.invoiceNumber}`} onClick={() => { setValidatedBatch((current) => current.filter((item) => item.invoiceNumber !== candidate.invoiceNumber)); setConfirmation(false); }}>Remove</button>
              </li>)}</ol>
              <div className="batch-total"><span>{validatedBatch.length} invoice{validatedBatch.length === 1 ? "" : "s"}</span><strong>{money.format(batchTotal / 100)}</strong></div>
              <label className="confirmation"><input type="checkbox" checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} /><span>I reviewed these exact invoices, POs, documents, and total and approve submission to Acme AP.</span></label>
              <button className="portal-button primary" type="button" onClick={() => void submitBatch()} disabled={!confirmation || pendingAction !== null}>{pendingAction === "submit" ? "Submitting batch…" : `Submit ${validatedBatch.length} approved invoice${validatedBatch.length === 1 ? "" : "s"}`}</button>
            </>}
          </div>
        </div>
      </section>

      <section className="orders" id="orders" aria-labelledby="orders-title">
        <div className="section-heading"><div><p className="kicker">Authorized supplier data</p><h2 id="orders-title">Purchase orders</h2></div><span>{purchaseOrders.filter((order) => order.status === "open").length} open</span></div>
        <div className="cards">{purchaseOrders.map((order) => (
          <article key={order.purchaseOrderNumber} className="order-card">
            <div><strong>{order.purchaseOrderNumber}</strong><span>{order.status}</span></div>
            <p>{order.description}</p><small>Remaining balance</small><h3>{money.format(order.remainingAmountMinor / 100)}</h3>
            <button type="button" onClick={() => { setCandidatePurchaseOrder(order.purchaseOrderNumber); document.querySelector("#operations")?.scrollIntoView({ behavior: "smooth" }); }}>Use for invoice</button>
          </article>
        ))}</div>
      </section>

      <section className="submissions" id="submissions" aria-labelledby="submissions-title">
        <div className="section-heading"><div><p className="kicker">Portal receipts</p><h2 id="submissions-title">Invoice submissions</h2></div><span>{submissions.length} received</span></div>
        {submissions.length === 0 ? <div className="empty-state"><strong>No invoices submitted yet</strong><p>Validated invoices will appear here immediately after confirmed submission.</p></div> : (
          <div className="submission-list">{submissions.map((submission) => (
            <article key={submission.portalReference}>
              <div><strong>{submission.invoiceNumber}</strong><span>{submission.status}</span></div>
              <p>{submission.portalReference} · {submission.purchaseOrderNumber}</p>
              <b>{money.format(submission.amountMinor / 100)}</b>
            </article>
          ))}</div>
        )}
      </section>

      <section className="submissions" aria-labelledby="audit-title">
        <div className="section-heading"><div><p className="kicker">Audit trail</p><h2 id="audit-title">Recent portal activity</h2></div><span>{auditAvailable ? `${auditEvents.length} events` : "Unavailable"}</span></div>
        {!auditAvailable ? <div className="empty-state" role="status"><strong>Recent activity is temporarily unavailable</strong><p>Reload to try again. Invoice and purchase-order data remain live.</p></div> : auditEvents.length === 0 ? <div className="empty-state"><strong>No committed activity yet</strong><p>Confirmed submissions create immutable audit events here.</p></div> : <ol className="audit-log">
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
