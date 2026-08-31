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
import { hasStructuralPdf } from "@/lib/pdf-structure";
import { AcmeSiteTools } from "./acme-site-tools";

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
const preciseTimestamp = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

type ValidationResult = Readonly<{
  valid: boolean;
  invoiceNumber: string;
  purchaseOrder: PurchaseOrder | null;
  issues: ValidationIssue[];
}>;

type PaymentRemittance = Readonly<{
  invoiceNumber: string;
  portalReference: string;
  paymentStatus: "paid" | "scheduled" | "not_scheduled";
  scheduledFor: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  amountMinor: number | null;
  currency: string;
  paymentMethod: string | null;
  allocations: ReadonlyArray<Readonly<{
    invoiceNumber: string;
    amountMinor: number;
    currency: string;
  }>>;
}>;

type SubmissionStatusFilter = "all" | SubmissionRow["status"];

export const AP_AGENT_STARTER_PROMPT =
  "Use the Acme Supplier Portal at https://openfinance-ap.vercel.app to review and process my invoices.";

export function filterSubmissionRows(
  submissions: readonly SubmissionRow[],
  status: SubmissionStatusFilter,
  purchaseOrderNumber: string,
) {
  const normalizedPurchaseOrder = purchaseOrderNumber.trim().toUpperCase();
  return submissions.filter((submission) =>
    (status === "all" || submission.status === status) &&
    (normalizedPurchaseOrder === "" || submission.purchaseOrderNumber.includes(normalizedPurchaseOrder)),
  );
}

function auditSummary(event: AuditEvent) {
  if (event.action === "demo_state_reset") {
    return "Canonical synthetic AP data restored";
  }
  if (event.action === "demo_payment_scheduled") {
    const invoiceNumber = typeof event.details.invoiceNumber === "string" ? event.details.invoiceNumber : "Invoice";
    return `${invoiceNumber} · synthetic buyer settlement scheduled`;
  }
  const invoiceNumber = typeof event.details.invoiceNumber === "string" ? event.details.invoiceNumber : null;
  if (event.action === "invoice_exception_responded" && invoiceNumber) {
    const exceptionCode = typeof event.details.exceptionCode === "string" ? event.details.exceptionCode.replaceAll("_", " ") : "exception";
    const attachmentCount = typeof event.details.attachmentCount === "number" ? event.details.attachmentCount : 0;
    return `${invoiceNumber} · ${exceptionCode} · ${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`;
  }
  if (event.action === "invoice_inquiry_created" && invoiceNumber) {
    return `${invoiceNumber} · ${event.entityId}`;
  }
  if (event.action === "rejected_invoice_replaced" && invoiceNumber) {
    const revision = typeof event.details.revision === "number" ? `revision ${event.details.revision}` : "corrected revision";
    return `${invoiceNumber} · ${revision}`;
  }
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

export async function fileDocument(file: File, requirements: SubmissionRequirements) {
  const hasAcceptedMediaType = requirements.acceptedMediaTypes.includes(file.type);
  const hasPortablePdfFallback = file.type === "" && file.name.toLowerCase().endsWith(".pdf");
  if (!hasAcceptedMediaType && !hasPortablePdfFallback) throw new Error("Choose a PDF invoice document.");
  if (file.size > requirements.maxDocumentBytes) throw new Error("The PDF is larger than the portal limit.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(file.name)) {
    throw new Error("Use a file name containing only letters, numbers, dots, dashes, and underscores.");
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!hasStructuralPdf(bytes)) {
    throw new Error("Choose a structurally valid PDF invoice document.");
  }
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
  const [remittanceLookup, setRemittanceLookup] = useState<PaymentRemittance | null | undefined>(undefined);
  const [submissionStatusFilter, setSubmissionStatusFilter] = useState<SubmissionStatusFilter>("all");
  const [submissionPurchaseOrderFilter, setSubmissionPurchaseOrderFilter] = useState("");
  const [candidatePurchaseOrder, setCandidatePurchaseOrder] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [validatedBatch, setValidatedBatch] = useState<InvoiceCandidate[]>([]);
  const [confirmation, setConfirmation] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [starterPromptCopied, setStarterPromptCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeStatusInvoiceNumber = statusLookup?.invoiceNumber;

  const refresh = useCallback(async () => {
    const [body, refreshedStatus] = await Promise.all([
      apiRequest<{
        purchaseOrders: PurchaseOrder[];
        submissions: SubmissionRow[];
        auditEvents: AuditEvent[];
        auditAvailable: boolean;
      }>("/api/agent/workspace", { cache: "no-store" }),
      activeStatusInvoiceNumber
        ? apiRequest<{ found: boolean; submission: SubmissionRow | null }>("/api/agent/status", {
            method: "POST",
            body: JSON.stringify({ invoiceNumber: activeStatusInvoiceNumber }),
          })
        : Promise.resolve(undefined),
    ]);
    setPurchaseOrders(body.purchaseOrders);
    setSubmissions(body.submissions);
    if (refreshedStatus) setStatusLookup(refreshedStatus.submission);
    setAuditEvents(body.auditEvents);
    setAuditAvailable(body.auditAvailable);
  }, [activeStatusInvoiceNumber]);

  useEffect(() => {
    const handleDataChanged = () => void refresh().catch(() => undefined);
    window.addEventListener("acme:data-changed", handleDataChanged);
    return () => window.removeEventListener("acme:data-changed", handleDataChanged);
  }, [refresh]);

  useEffect(() => {
    const nextSettlement = submissions
      .filter((submission) => submission.settlementExpectedAt && !submission.paidAt)
      .map((submission) => Date.parse(submission.settlementExpectedAt as string))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    if (nextSettlement === undefined) return;

    const timer = window.setTimeout(
      () => void refresh().catch(() => undefined),
      Math.max(0, nextSettlement - Date.now() + 500),
    );
    return () => window.clearTimeout(timer);
  }, [refresh, submissions]);

  const batchTotal = useMemo(
    () => validatedBatch.reduce((sum, candidate) => sum + candidate.amountMinor, 0),
    [validatedBatch],
  );
  const filteredSubmissions = useMemo(
    () => filterSubmissionRows(submissions, submissionStatusFilter, submissionPurchaseOrderFilter),
    [submissionPurchaseOrderFilter, submissionStatusFilter, submissions],
  );

  function clearFeedback() {
    setNotice(null);
    setError(null);
  }

  async function copyStarterPrompt() {
    try {
      await navigator.clipboard.writeText(AP_AGENT_STARTER_PROMPT);
      setStarterPromptCopied(true);
    } catch {
      setError("Copy was unavailable. Select the starter instruction and copy it manually.");
    }
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

  async function findPaymentRemittance(formData: FormData) {
    clearFeedback();
    setPendingAction("remittance");
    try {
      const invoiceNumber = String(formData.get("invoiceNumber") ?? "").toUpperCase();
      const result = await apiRequest<PaymentRemittance>("/api/agent/remittance", {
        method: "POST",
        body: JSON.stringify({ invoiceNumber }),
      });
      setRemittanceLookup(result);
    } catch (cause) {
      setRemittanceLookup(undefined);
      setError(cause instanceof Error ? cause.message : "Payment remittance lookup failed");
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

  async function respondToException(formData: FormData) {
    clearFeedback();
    if (formData.get("confirmation") !== "approved") {
      setError("Review and approve the exact response and evidence before sending it.");
      return;
    }
    setPendingAction("exception-response");
    try {
      const file = formData.get("attachment");
      const attachments = file instanceof File && file.size > 0 ? [{
        ...(await fileDocument(file, requirements)),
        documentKind: String(formData.get("documentKind") ?? "other"),
      }] : [];
      const invoiceNumber = String(formData.get("invoiceNumber") ?? "").toUpperCase();
      await apiRequest("/api/agent/exception-responses", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: idempotencyKey("ui-exception-response"),
          invoiceNumber,
          exceptionCode: String(formData.get("exceptionCode") ?? ""),
          message: String(formData.get("message") ?? ""),
          attachments,
        }),
      });
      await refresh();
      setNotice(`${invoiceNumber} exception response was sent with ${attachments.length} supporting document${attachments.length === 1 ? "" : "s"}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Exception response could not be sent");
    } finally {
      setPendingAction(null);
    }
  }

  async function replaceRejectedInvoice(formData: FormData) {
    clearFeedback();
    if (formData.get("confirmation") !== "approved") {
      setError("Review and approve the exact corrected invoice before replacement.");
      return;
    }
    setPendingAction("replacement");
    try {
      const file = formData.get("document");
      if (!(file instanceof File) || file.size === 0) throw new Error("Choose the corrected invoice PDF.");
      const invoiceNumber = String(formData.get("invoiceNumber") ?? "").toUpperCase();
      await apiRequest("/api/agent/replacements", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: idempotencyKey("ui-invoice-replacement"),
          invoice: {
            invoiceNumber,
            invoiceDate: String(formData.get("invoiceDate") ?? ""),
            amountMinor: parseAmountMinor(String(formData.get("amount") ?? "")),
            currency: String(formData.get("currency") ?? "USD").toUpperCase(),
            purchaseOrderNumber: String(formData.get("purchaseOrderNumber") ?? "").toUpperCase(),
            document: await fileDocument(file, requirements),
          },
        }),
      });
      await refresh();
      setNotice(`${invoiceNumber} was replaced by a corrected, newly validated revision.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rejected invoice could not be replaced");
    } finally {
      setPendingAction(null);
    }
  }

  async function createInquiry(formData: FormData) {
    clearFeedback();
    if (formData.get("confirmation") !== "approved") {
      setError("Review and approve the exact inquiry before opening the buyer case.");
      return;
    }
    setPendingAction("inquiry");
    try {
      const invoiceNumber = String(formData.get("invoiceNumber") ?? "").toUpperCase();
      const result = await apiRequest<{ caseReference: string }>("/api/agent/inquiries", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: idempotencyKey("ui-invoice-inquiry"),
          invoiceNumber,
          inquiryType: String(formData.get("inquiryType") ?? "invoice_inquiry"),
          subject: String(formData.get("subject") ?? ""),
          message: String(formData.get("message") ?? ""),
        }),
      });
      await refresh();
      setNotice(`${result.caseReference} was opened for ${invoiceNumber}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invoice inquiry could not be created");
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
      setPurchaseOrderLookup(undefined);
      setStatusLookup(undefined);
      setCandidatePurchaseOrder("");
      setValidation(null);
      setValidatedBatch([]);
      setConfirmation(false);
      setFileInputKey((key) => key + 1);
      setResetOpen(false);
      await refresh();
      setNotice("Acme AP was restored to the canonical synthetic starting state.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The synthetic demo could not be restored");
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="portal-shell">
      <AcmeSiteTools />
      <header className="portal-header">
        <div className="openfinance-lockup portal-openfinance-lockup" aria-label="OpenFinance Supplier Portal">
          <span className="openfinance-logo portal-openfinance-logo" aria-hidden="true">OF</span>
          <span><strong>OpenFinance</strong><small>Supplier Portal · Acme</small></span>
        </div>
        <nav aria-label="Primary navigation"><a href="#operations">Submit invoice</a><a href="#orders">Purchase orders</a><a href="#submissions">Receipts</a></nav>
        <div className="supplier"><div><small>Signed in as</small><strong>{supplierName}</strong><span>{supplierCode}</span></div><form action={signOutAction}><button className="signout" type="submit">Sign out</button></form></div>
      </header>

      <section className="webmcp-hero" aria-labelledby="webmcp-support-title">
        <div className="webmcp-hero-copy">
          <p className="kicker">Agent-ready supplier workspace</p>
          <h1 id="webmcp-support-title">WebMCP fully supported</h1>
          <p>Open this supplier portal in a WebMCP-enabled browser, sign in, and give your agent the instruction shown here.</p>
        </div>
        <div className="agent-starter">
          <span>Say to your agent</span>
          <blockquote>“{AP_AGENT_STARTER_PROMPT}”</blockquote>
          <button type="button" onClick={() => void copyStarterPrompt()} aria-live="polite">
            {starterPromptCopied ? "Prompt copied" : "Copy starter prompt"}
          </button>
        </div>
      </section>

      <section className="intro">
        <div><p className="kicker">Accounts payable</p><h1>Supplier workspace</h1><p>Find purchase orders, validate invoices, submit approved batches, and track receipts.</p></div>
        <span className="tool-status">12 authenticated site tools</span>
      </section>

      <section className="agent-guide" aria-label="Human and agent workflow">
        <span className="pulse" aria-hidden="true" />
        <div><strong>12 authenticated tools, one governed portal</strong><p>Every tool operates only within this supplier portal and follows the same validation, authorization, and human-approval rules as the interface.</p></div>
      </section>

      <section className="demo-controls" aria-labelledby="demo-controls-title">
        <div>
          <p className="kicker">Synthetic challenge environment</p>
          <h2 id="demo-controls-title">Need a fresh demo run?</h2>
          <p>Restore this AP workspace to its canonical synthetic starting state.</p>
        </div>
        {!resetOpen ? <button className="portal-button quiet" type="button" onClick={() => setResetOpen(true)} disabled={pendingAction !== null}>
          Restore demo start
        </button> : <div className="reset-confirmation" role="group" aria-label="Confirm Acme demo reset">
          <p><strong>Restore the synthetic AP portfolio?</strong><span>Current receipts, payment signals, and workflow events will be replaced by nine canonical POs and three historical exception cases.</span></p>
          <div>
            <button className="portal-button quiet" type="button" onClick={() => setResetOpen(false)} disabled={pendingAction !== null}>Cancel</button>
            <button className="portal-button danger" type="button" onClick={() => void restoreDemo()} disabled={pendingAction !== null}>
              {pendingAction === "reset" ? "Restoring…" : "Restore synthetic AP data"}
            </button>
          </div>
        </div>}
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
            {purchaseOrderLookup && <div className="lookup-result detailed-result"><strong>{purchaseOrderLookup.purchaseOrderNumber}</strong><span className={`state ${purchaseOrderLookup.status}`}>{purchaseOrderLookup.status}</span><p>{purchaseOrderLookup.description}</p><b>{money.format(purchaseOrderLookup.remainingAmountMinor / 100)} remaining</b>
              <dl><div><dt>Authorized</dt><dd>{money.format(purchaseOrderLookup.authorizedAmountMinor / 100)} {purchaseOrderLookup.currency}</dd></div><div><dt>Payment terms</dt><dd>{purchaseOrderLookup.paymentTerms}</dd></div><div><dt>Receipt</dt><dd>{purchaseOrderLookup.receiptRequired ? `${money.format(purchaseOrderLookup.receivedAmountMinor / 100)} received` : "Not required"}</dd></div><div><dt>Service entry</dt><dd>{purchaseOrderLookup.serviceEntryStatus.replaceAll("_", " ")}</dd></div><div><dt>Price tolerance</dt><dd>{purchaseOrderLookup.priceToleranceBasisPoints / 100}% + {money.format(purchaseOrderLookup.amountToleranceMinor / 100)}</dd></div><div><dt>Evidence</dt><dd>{purchaseOrderLookup.requiredAttachmentKinds.join(", ") || "None required"}</dd></div></dl>
              <ol>{purchaseOrderLookup.lines.map((line) => <li key={line.lineNumber}><strong>Line {line.lineNumber}</strong><span>{line.description} · {line.receivedQuantity}/{line.orderedQuantity} {line.unitOfMeasure} received · {money.format(line.invoicedAmountMinor / 100)} invoiced</span></li>)}</ol>
            </div>}
          </form>
          <form className="lookup-card" action={(formData) => void findInvoiceStatus(formData)}>
            <div><span className="step-number neutral">4</span><div><strong>Track an invoice</strong><p>Retrieve its current receipt and status.</p></div></div>
            <label><span>Invoice number</span><div className="inline-field"><input name="invoiceNumber" required pattern="[A-Z0-9][A-Z0-9-]{1,39}" placeholder="INV-10482" /><button type="submit" disabled={pendingAction !== null}>{pendingAction === "status" ? "Checking…" : "Check status"}</button></div></label>
            {statusLookup && <div className="lookup-result"><strong>{statusLookup.invoiceNumber}</strong><span className={`state ${statusLookup.status}`}>{statusLookup.status}</span><p>{statusLookup.paymentReference ?? statusLookup.portalReference}</p><b>{money.format(statusLookup.amountMinor / 100)}</b>{statusLookup.revision && <small>Revision {statusLookup.revision}</small>}
              {statusLookup.timeline && statusLookup.timeline.length > 0 && <ol>{statusLookup.timeline.map((event) => <li key={`${event.eventCode}-${event.createdAt}`}><small>{event.status.replaceAll("_", " ")} · {event.message}</small></li>)}</ol>}
              {statusLookup.exceptions && statusLookup.exceptions.length > 0 && <ul>{statusLookup.exceptions.map((exception) => <li key={exception.exceptionCode}><small><strong>{exception.exceptionCode}</strong> · {exception.owner.replaceAll("_", " ")} · {exception.message}<br /><b>{exception.authorityBoundary}</b><br />Resolution: {exception.resolutionGuidance}<br />Allowed: {exception.allowedActions.join(", ") || "No supplier action"}{exception.requiredDocumentKind ? ` · Evidence: ${exception.requiredDocumentKind.replaceAll("_", " ")}` : ""}</small></li>)}</ul>}
              {statusLookup.inquiries && statusLookup.inquiries.length > 0 && <ul>{statusLookup.inquiries.map((inquiry) => <li key={inquiry.caseReference}><small><strong>{inquiry.caseReference}</strong> · {inquiry.inquiryType.replaceAll("_", " ")} · {inquiry.status}<br />{inquiry.subject}</small></li>)}</ul>}
            </div>}
          </form>
          <form className="lookup-card remittance-lookup" action={(formData) => void findPaymentRemittance(formData)}>
            <div><span className="step-number neutral">5</span><div><strong>Finish on cash</strong><p>Read the exact AP allocation and confirm the payment reference, method, and amount.</p></div></div>
            <label><span>Invoice number</span><div className="inline-field"><input name="invoiceNumber" required pattern="[A-Z0-9][A-Z0-9-]{1,39}" placeholder="INV-10482" /><button type="submit" disabled={pendingAction !== null}>{pendingAction === "remittance" ? "Loading…" : "View remittance"}</button></div></label>
            {remittanceLookup && <div className="lookup-result detailed-result"><strong>{remittanceLookup.invoiceNumber}</strong><span className={`state ${remittanceLookup.paymentStatus}`}>{remittanceLookup.paymentStatus.replaceAll("_", " ")}</span><p>{remittanceLookup.paymentReference ?? remittanceLookup.portalReference}</p><b>{remittanceLookup.amountMinor === null ? "No payment yet" : money.format(remittanceLookup.amountMinor / 100)}</b>
              <dl><div><dt>Method</dt><dd>{remittanceLookup.paymentMethod?.toUpperCase() ?? "Not available"}</dd></div><div><dt>Scheduled</dt><dd>{remittanceLookup.scheduledFor ? timestamp.format(new Date(remittanceLookup.scheduledFor)) : "Not scheduled"}</dd></div><div><dt>Paid</dt><dd>{remittanceLookup.paidAt ? timestamp.format(new Date(remittanceLookup.paidAt)) : "Not paid"}</dd></div><div><dt>Currency</dt><dd>{remittanceLookup.currency}</dd></div></dl>
              {remittanceLookup.allocations.length > 0 && <ol>{remittanceLookup.allocations.map((allocation) => <li key={allocation.invoiceNumber}><strong>{allocation.invoiceNumber}</strong><span>{money.format(allocation.amountMinor / 100)} {allocation.currency}</span></li>)}</ol>}
            </div>}
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
            <dl><div><dt>Payment terms</dt><dd>{order.paymentTerms}</dd></div><div><dt>Received</dt><dd>{money.format(order.receivedAmountMinor / 100)}</dd></div><div><dt>Service entry</dt><dd>{order.serviceEntryStatus.replaceAll("_", " ")}</dd></div><div><dt>Lines</dt><dd>{order.lines.length}</dd></div></dl>
            {order.requiredAttachmentKinds.length > 0 && <small>Required evidence: {order.requiredAttachmentKinds.join(", ")}</small>}
            <button type="button" onClick={() => { setCandidatePurchaseOrder(order.purchaseOrderNumber); document.querySelector("#operations")?.scrollIntoView({ behavior: "smooth" }); }}>Use for invoice</button>
          </article>
        ))}</div>
      </section>

      <section className="operations" id="resolution" aria-labelledby="resolution-title">
        <div className="section-heading"><div><p className="kicker">Exception to cash</p><h2 id="resolution-title">Resolve, correct, or ask AP</h2></div><span>Human-approved writes</span></div>
        <div className="submission-workbench">
          <form className="candidate-form" action={(formData) => void respondToException(formData)}>
            <div className="form-heading"><div><h3>Respond to an exception</h3><p>Add an exact response and optional supporting PDF.</p></div></div>
            <div className="field-grid">
              <label><span>Invoice</span><select name="invoiceNumber" required defaultValue=""><option value="" disabled>Select invoice</option>{submissions.map((submission) => <option key={submission.invoiceNumber} value={submission.invoiceNumber}>{submission.invoiceNumber}</option>)}</select></label>
              <label><span>Exception code</span><input name="exceptionCode" required pattern="[a-z][a-z0-9_]{1,63}" placeholder="missing_supporting_document" /></label>
              <label><span>Document kind</span><select name="documentKind" defaultValue="proof_of_delivery"><option value="proof_of_delivery">Proof of delivery</option><option value="service_acceptance">Service acceptance</option><option value="timesheet">Timesheet</option><option value="tax_document">Tax document</option><option value="contract">Contract</option><option value="other">Other</option></select></label>
              <label className="file-field"><span>Supporting PDF (optional)</span><input name="attachment" type="file" accept="application/pdf,.pdf" /></label>
            </div>
            <label><span>Response</span><textarea name="message" required minLength={1} maxLength={1000} placeholder="Explain the correction or attached evidence." /></label>
            <label className="confirmation"><input name="confirmation" type="checkbox" value="approved" /><span>I reviewed this exact response and evidence and approve sending it to Acme AP.</span></label>
            <button className="portal-button secondary" type="submit" disabled={pendingAction !== null}>{pendingAction === "exception-response" ? "Sending…" : "Send approved response"}</button>
          </form>

          <form className="candidate-form" action={(formData) => void replaceRejectedInvoice(formData)}>
            <div className="form-heading"><div><h3>Replace rejected invoice</h3><p>Creates an audited revision only when the exception permits replacement.</p></div></div>
            <div className="field-grid">
              <label><span>Invoice</span><select name="invoiceNumber" required defaultValue=""><option value="" disabled>Select rejected invoice</option>{submissions.filter((submission) => submission.status === "rejected" || submission.status === "disputed").map((submission) => <option key={submission.invoiceNumber} value={submission.invoiceNumber}>{submission.invoiceNumber}</option>)}</select></label>
              <label><span>Invoice date</span><input name="invoiceDate" type="date" required /></label>
              <label><span>Corrected amount</span><input name="amount" inputMode="decimal" required pattern="\d+(\.\d{1,2})?" /></label>
              <label><span>Currency</span><input name="currency" defaultValue="USD" required pattern="[A-Z]{3}" maxLength={3} /></label>
              <label><span>Purchase order</span><select name="purchaseOrderNumber" required defaultValue=""><option value="" disabled>Select PO</option>{purchaseOrders.filter((order) => order.status === "open").map((order) => <option key={order.purchaseOrderNumber} value={order.purchaseOrderNumber}>{order.purchaseOrderNumber}</option>)}</select></label>
              <label className="file-field"><span>Corrected invoice PDF</span><input name="document" type="file" accept="application/pdf,.pdf" required /></label>
            </div>
            <label className="confirmation"><input name="confirmation" type="checkbox" value="approved" /><span>I reviewed the exact corrected invoice, PO, amount, and document and approve replacement.</span></label>
            <button className="portal-button secondary" type="submit" disabled={pendingAction !== null}>{pendingAction === "replacement" ? "Replacing…" : "Replace rejected invoice"}</button>
          </form>
        </div>

        <form className="candidate-form" action={(formData) => void createInquiry(formData)}>
          <div className="form-heading"><div><h3>Open an AP inquiry</h3><p>Route buyer-owned blockers or payment questions into a tracked case.</p></div></div>
          <div className="field-grid">
            <label><span>Invoice</span><select name="invoiceNumber" required defaultValue=""><option value="" disabled>Select invoice</option>{submissions.map((submission) => <option key={submission.invoiceNumber} value={submission.invoiceNumber}>{submission.invoiceNumber}</option>)}</select></label>
            <label><span>Inquiry type</span><select name="inquiryType" defaultValue="payment_inquiry"><option value="payment_inquiry">Payment inquiry</option><option value="invoice_inquiry">Invoice inquiry</option><option value="expedite_payment">Expedite payment</option><option value="payment_terms">Payment terms</option><option value="invoice_entry_assistance">Invoice entry assistance</option></select></label>
            <label><span>Subject</span><input name="subject" required minLength={1} maxLength={160} /></label>
          </div>
          <label><span>Message</span><textarea name="message" required minLength={1} maxLength={1000} /></label>
          <label className="confirmation"><input name="confirmation" type="checkbox" value="approved" /><span>I reviewed the case type, subject, and message and approve opening this buyer case.</span></label>
          <button className="portal-button primary" type="submit" disabled={pendingAction !== null}>{pendingAction === "inquiry" ? "Opening case…" : "Open approved inquiry"}</button>
        </form>
      </section>

      <section className="submissions" id="submissions" aria-labelledby="submissions-title">
        <div className="section-heading"><div><p className="kicker">Portal receipts</p><h2 id="submissions-title">Invoice submissions</h2></div><span>{submissions.length} received</span></div>
        <div className="settlement-note"><strong>Synthetic buyer payment signal</strong><p>For this challenge demo, every second committed invoice settles 10 seconds after receipt. The portal and agent read the same live AP status.</p></div>
        <div className="submission-filters" aria-label="Invoice submission filters">
          <label><span>Status</span><select value={submissionStatusFilter} onChange={(event) => setSubmissionStatusFilter(event.target.value as SubmissionStatusFilter)}><option value="all">All statuses</option><option value="received">Received</option><option value="under_review">Under review</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="disputed">Disputed</option><option value="voided">Voided</option><option value="paid">Paid</option></select></label>
          <label><span>Purchase order</span><input value={submissionPurchaseOrderFilter} onChange={(event) => setSubmissionPurchaseOrderFilter(event.target.value.toUpperCase())} placeholder="Filter PO" /></label>
        </div>
        {submissions.length === 0 ? <div className="empty-state"><strong>No invoices submitted yet</strong><p>Validated invoices will appear here immediately after confirmed submission.</p></div> : (
          filteredSubmissions.length === 0 ? <div className="empty-state"><strong>No matching invoices</strong><p>Adjust the status or purchase-order filter.</p></div> : <div className="submission-list">{filteredSubmissions.map((submission) => (
            <article key={submission.portalReference}>
              <div><strong>{submission.invoiceNumber}</strong><span className={submission.status}>{submission.status}</span></div>
              <p>{submission.portalReference} · {submission.purchaseOrderNumber}</p>
              {submission.status === "paid" && submission.paymentReference && submission.paidAt
                ? <small>Paid {preciseTimestamp.format(new Date(submission.paidAt))} · {submission.paymentReference}</small>
                : submission.settlementExpectedAt
                  ? <small>Payment signal expected at {preciseTimestamp.format(new Date(submission.settlementExpectedAt))}</small>
                  : <small>Awaiting buyer processing</small>}
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
