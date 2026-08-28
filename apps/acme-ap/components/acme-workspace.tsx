"use client";

import { useCallback, useEffect, useState } from "react";

import type { PurchaseOrder } from "@/lib/domain/submissions";
import type { SubmissionRow } from "@/lib/services/submission-service";
import { AcmeSiteTools } from "./acme-site-tools";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function AcmeWorkspace({
  initialPurchaseOrders, initialSubmissions, supplierName, supplierCode, signOutAction,
}: {
  initialPurchaseOrders: PurchaseOrder[];
  initialSubmissions: SubmissionRow[];
  supplierName: string;
  supplierCode: string;
  signOutAction: () => Promise<void>;
}) {
  const [purchaseOrders, setPurchaseOrders] = useState(initialPurchaseOrders);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/agent/workspace", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { purchaseOrders: PurchaseOrder[]; submissions: SubmissionRow[] };
    setPurchaseOrders(body.purchaseOrders);
    setSubmissions(body.submissions);
  }, []);

  useEffect(() => {
    window.addEventListener("acme:data-changed", refresh);
    return () => window.removeEventListener("acme:data-changed", refresh);
  }, [refresh]);

  return (
    <main className="portal-shell">
      <AcmeSiteTools />
      <header className="portal-header">
        <div className="wordmark"><span className="mark">A</span><span>Acme Supplier Portal</span></div>
        <nav aria-label="Primary navigation"><a href="#orders">Purchase orders</a><a href="#submissions">Invoices</a></nav>
        <div className="supplier"><div><small>Signed in as</small><strong>{supplierName}</strong><span>{supplierCode}</span></div><form action={signOutAction}><button className="signout" type="submit">Sign out</button></form></div>
      </header>

      <section className="intro">
        <div><p className="kicker">Accounts payable</p><h1>Supplier workspace</h1><p>Review purchase orders, validate invoices, and track submissions.</p></div>
        <span className="tool-status">5 authenticated site tools</span>
      </section>

      <section className="agent-guide" aria-label="Human and agent workflow">
        <span className="pulse" aria-hidden="true" />
        <div><strong>Agent preflight, human approval</strong><p>The agent can detect exceptions and prepare a valid batch. Submission waits for your explicit confirmation.</p></div>
      </section>

      <section className="requirements" aria-labelledby="requirements-title">
        <div><p className="kicker">Submission policy</p><h2 id="requirements-title">Invoice requirements</h2></div>
        <ul><li>Valid open PO</li><li>PDF up to 1 MB</li><li>Unique invoice number</li><li>Amount within PO balance</li></ul>
      </section>

      <section className="orders" id="orders" aria-labelledby="orders-title">
        <div className="section-heading"><div><p className="kicker">Authorized supplier data</p><h2 id="orders-title">Purchase orders</h2></div><span>{purchaseOrders.filter((order) => order.status === "open").length} open</span></div>
        <div className="cards">{purchaseOrders.map((order) => (
          <article key={order.purchaseOrderNumber} className="order-card">
            <div><strong>{order.purchaseOrderNumber}</strong><span>{order.status}</span></div>
            <p>{order.description}</p><small>Remaining balance</small><h3>{money.format(order.remainingAmountMinor / 100)}</h3>
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
    </main>
  );
}
