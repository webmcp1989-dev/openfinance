export const OPENFINANCE_DATA_CHANGED_EVENT = "openfinance:data-changed";
export const OPENFINANCE_AGENT_READ_EVENT = "openfinance:agent-read";

export type OpenFinanceAgentReadSection = "followups" | "invoices";

export type PaymentReconciliationResult = Readonly<{
  actor: "agent" | "human";
  invoiceNumber: string;
  paymentReference: string;
  amountMinor: number;
  currency: string;
  paymentMethod: string;
  paidAt: string;
  remainingDueMinor: number;
}>;

export type OpenFinanceDataChangedDetail = Readonly<{
  actor: "agent";
  message: string;
  affectedInvoiceNumbers: readonly string[];
  paymentResult?: PaymentReconciliationResult;
}>;

export type OpenFinanceAgentReadDetail = Readonly<{
  section: OpenFinanceAgentReadSection;
}>;

type PaymentInput = Readonly<{
  invoiceNumber: string;
  paymentReference: string;
  amountMinor: number;
  currency: string;
  paymentMethod: string;
  paidAt: string;
}>;

export function buildPaymentReconciliationResult(
  actor: PaymentReconciliationResult["actor"],
  input: PaymentInput,
  remainingDueMinor: number,
): PaymentReconciliationResult {
  return { actor, ...input, remainingDueMinor };
}

export function dispatchOpenFinanceDataChanged(detail: OpenFinanceDataChangedDetail) {
  window.dispatchEvent(new CustomEvent<OpenFinanceDataChangedDetail>(OPENFINANCE_DATA_CHANGED_EVENT, { detail }));
}

export function dispatchOpenFinanceAgentRead(section: OpenFinanceAgentReadSection) {
  window.dispatchEvent(new CustomEvent<OpenFinanceAgentReadDetail>(OPENFINANCE_AGENT_READ_EVENT, {
    detail: { section },
  }));
}
