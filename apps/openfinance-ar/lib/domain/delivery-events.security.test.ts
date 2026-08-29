import { describe, expect, test } from "bun:test";

import { deliveryEventRequestSchema } from "./invoices";

describe("OpenFinance delivery-event safety", () => {
  test("rejects duplicate invoice results within one event", () => {
    const item = {
      invoiceNumber: "INV-10482",
      portalReference: "ACME-20260829-ABC12345",
      portalStatus: "received",
    } as const;
    expect(deliveryEventRequestSchema.safeParse({
      eventType: "portal_result",
      idempotencyKey: "result-20260829-duplicate",
      items: [item, item],
    }).success).toBe(false);
  });

  test("rejects duplicate invoice exceptions within one event", () => {
    const item = {
      invoiceNumber: "INV-10507",
      exceptionCode: "amount_exceeds_remaining_balance",
      message: "Invoice exceeds the remaining PO balance.",
    };
    expect(deliveryEventRequestSchema.safeParse({
      eventType: "portal_exception",
      idempotencyKey: "exception-20260829-duplicate",
      items: [item, item],
    }).success).toBe(false);
  });
});
