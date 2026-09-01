"use client";

import { useEffect, useMemo, useState } from "react";

import type { DocumentSubmissionManifest } from "@/lib/domain/document-approvals";
import {
  ACME_DOCUMENT_APPROVAL_EVENT,
  ACME_DOCUMENT_APPROVAL_SETTLED_EVENT,
  type PendingDocumentSubmissionApproval,
} from "./document-submission-approval";

function actionTitle(manifest: DocumentSubmissionManifest) {
  if (manifest.action === "submit_invoice_batch") return "Submit invoice documents";
  if (manifest.action === "respond_to_invoice_exception") return "Send exception evidence";
  return "Replace rejected invoice";
}

function approvalDocuments(manifest: DocumentSubmissionManifest) {
  if (manifest.action === "submit_invoice_batch") {
    return manifest.invoices.map((invoice) => ({
      key: invoice.invoiceNumber,
      invoiceNumber: invoice.invoiceNumber,
      purchaseOrderNumber: invoice.purchaseOrderNumber,
      amountMinor: invoice.amountMinor,
      currency: invoice.currency,
      documentKind: "invoice",
      ...invoice.document,
    }));
  }
  if (manifest.action === "respond_to_invoice_exception") {
    return manifest.attachments.map((document) => ({
      key: `${manifest.invoiceNumber}-${document.documentKind}-${document.sha256}`,
      invoiceNumber: manifest.invoiceNumber,
      purchaseOrderNumber: null,
      amountMinor: null,
      currency: null,
      ...document,
    }));
  }
  return [{
    key: manifest.invoice.invoiceNumber,
    invoiceNumber: manifest.invoice.invoiceNumber,
    purchaseOrderNumber: manifest.invoice.purchaseOrderNumber,
    amountMinor: manifest.invoice.amountMinor,
    currency: manifest.invoice.currency,
    documentKind: "corrected invoice",
    ...manifest.invoice.document,
  }];
}

export function DocumentApprovalDialog() {
  const [pending, setPending] = useState<PendingDocumentSubmissionApproval | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const documents = useMemo(() => pending ? approvalDocuments(pending.manifest) : [], [pending]);

  useEffect(() => {
    const handleApproval = (event: Event) => {
      const detail = (event as CustomEvent<PendingDocumentSubmissionApproval>).detail;
      setAcknowledged(false);
      setPending(detail);
    };
    const handleSettled = (event: Event) => {
      const detail = (event as CustomEvent<{ approvalId: string }>).detail;
      setPending((current) => current?.approvalId === detail.approvalId ? null : current);
      setAcknowledged(false);
    };
    window.addEventListener(ACME_DOCUMENT_APPROVAL_EVENT, handleApproval);
    window.addEventListener(ACME_DOCUMENT_APPROVAL_SETTLED_EVENT, handleSettled);
    return () => {
      window.removeEventListener(ACME_DOCUMENT_APPROVAL_EVENT, handleApproval);
      window.removeEventListener(ACME_DOCUMENT_APPROVAL_SETTLED_EVENT, handleSettled);
    };
  }, []);

  if (!pending) return null;
  const manifest = pending.manifest;
  const totalByCurrency = new Map<string, number>();
  for (const document of documents) {
    if (document.amountMinor !== null && document.currency) {
      totalByCurrency.set(document.currency, (totalByCurrency.get(document.currency) ?? 0) + document.amountMinor);
    }
  }
  const decide = (decision: "approved" | "denied") => {
    pending.decide(decision);
    setPending(null);
    setAcknowledged(false);
  };

  return <div className="document-approval-backdrop" role="presentation">
    <section className="document-approval-dialog" role="dialog" aria-modal="true" aria-labelledby="document-approval-title" aria-describedby="document-approval-description">
      <header>
        <div>
          <p className="kicker">{pending.initiatedBy === "agent" ? "Agent requested · human decision required" : "Human document submission"}</p>
          <h2 id="document-approval-title">{actionTitle(manifest)}</h2>
        </div>
        <span className="approval-destination">Destination · Acme AP</span>
      </header>
      <p id="document-approval-description">Review the exact information below. Nothing is submitted unless you approve this request.</p>

      {manifest.action === "respond_to_invoice_exception" && <div className="approval-message">
        <span>{manifest.invoiceNumber} · {manifest.exceptionCode.replaceAll("_", " ")}</span>
        <strong>Supplier response</strong>
        <p>{manifest.message}</p>
      </div>}

      <div className="approval-document-list">
        {documents.length === 0 ? <div className="approval-document-empty"><strong>No PDF attached</strong><span>The response message is still a consequential portal write.</span></div> : documents.map((document) => (
          <article key={document.key} data-invoice={document.invoiceNumber}>
            <div><strong>{document.invoiceNumber}</strong><span>{document.documentKind.replaceAll("_", " ")}</span></div>
            {document.purchaseOrderNumber && <p>{document.purchaseOrderNumber}</p>}
            {document.amountMinor !== null && document.currency && <b>{new Intl.NumberFormat("en-US", { style: "currency", currency: document.currency }).format(document.amountMinor / 100)}</b>}
            <dl><div><dt>Document</dt><dd>{document.fileName}</dd></div><div><dt>SHA-256</dt><dd><code>{document.sha256}</code></dd></div></dl>
          </article>
        ))}
      </div>

      {totalByCurrency.size > 0 && <div className="approval-total"><span>{documents.length} document{documents.length === 1 ? "" : "s"}</span><strong>{[...totalByCurrency].map(([currency, amountMinor]) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / 100)).join(" + ")}</strong></div>}

      <label className="confirmation approval-acknowledgement">
        <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} autoFocus />
        <span>I reviewed this exact destination, action, invoice data, and document evidence and approve sending it to Acme AP.</span>
      </label>
      <footer>
        <button className="portal-button quiet" type="button" onClick={() => decide("denied")}>Deny</button>
        <button className="portal-button primary" type="button" disabled={!acknowledged} onClick={() => decide("approved")}>Approve and submit</button>
      </footer>
      <small>Approval is single-use, bound to this exact payload, and expires at {new Date(pending.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</small>
    </section>
  </div>;
}
