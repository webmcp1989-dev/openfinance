export const ACME_DATA_CHANGED_EVENT = "acme:data-changed";
export const ACME_AGENT_READ_EVENT = "acme:agent-read";

export type AcmeAgentReadSection = "exceptions" | "orders" | "requirements" | "submissions";

export type AcmeSubmissionResult = Readonly<{
  actor: "agent" | "human";
  invoiceNumbers: readonly string[];
  invoiceCount: number;
  totals: readonly Readonly<{ currency: string; amountMinor: number }>[];
  portalReferences: readonly string[];
}>;

export type AcmeDataChangedDetail = Readonly<{
  actor: "agent";
  message: string;
  affectedInvoiceNumbers: readonly string[];
  submissionResult?: AcmeSubmissionResult;
}>;

export type AcmeAgentReadDetail = Readonly<{
  section: AcmeAgentReadSection;
}>;

type SubmittedInvoice = Readonly<{
  invoiceNumber: string;
  amountMinor: number;
  currency: string;
}>;

type SubmissionReceipt = Readonly<{
  invoiceNumber: string;
  portalReference: string;
}>;

export function submissionConfirmationMessage(invoiceCount: number) {
  return `${invoiceCount} invoice${invoiceCount === 1 ? " was" : "s were"} submitted and received portal references.`;
}

export function buildAcmeSubmissionResult(
  actor: AcmeSubmissionResult["actor"],
  invoices: readonly SubmittedInvoice[],
  receipts: readonly SubmissionReceipt[],
): AcmeSubmissionResult {
  const totalsByCurrency = new Map<string, number>();
  for (const invoice of invoices) {
    totalsByCurrency.set(invoice.currency, (totalsByCurrency.get(invoice.currency) ?? 0) + invoice.amountMinor);
  }
  return {
    actor,
    invoiceNumbers: receipts.map((item) => item.invoiceNumber),
    invoiceCount: receipts.length,
    totals: [...totalsByCurrency].map(([currency, amountMinor]) => ({ currency, amountMinor })),
    portalReferences: receipts.map((item) => item.portalReference),
  };
}

export function dispatchAcmeDataChanged(detail: AcmeDataChangedDetail) {
  window.dispatchEvent(new CustomEvent<AcmeDataChangedDetail>(ACME_DATA_CHANGED_EVENT, { detail }));
}

export function dispatchAcmeAgentRead(section: AcmeAgentReadSection) {
  window.dispatchEvent(new CustomEvent<AcmeAgentReadDetail>(ACME_AGENT_READ_EVENT, {
    detail: { section },
  }));
}
