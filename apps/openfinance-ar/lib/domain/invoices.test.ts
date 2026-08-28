import { describe, expect, test } from "bun:test";

import { deliveryEventRequestSchema, packageRequestSchema } from "./invoices";

describe("OpenFinance agent request contracts", () => {
  test("accepts a unique bounded submission package", () => {
    expect(packageRequestSchema.parse({ invoiceNumbers: ["INV-10482", "INV-10491"] })).toEqual({
      invoiceNumbers: ["INV-10482", "INV-10491"],
    });
  });

  test("rejects duplicate invoice numbers", () => {
    expect(packageRequestSchema.safeParse({ invoiceNumbers: ["INV-10482", "INV-10482"] }).success).toBe(false);
  });

  test("keeps portal result and exception payloads distinct and strict", () => {
    const valid = deliveryEventRequestSchema.safeParse({
      eventType: "portal_result",
      idempotencyKey: "result-20260829-001",
      items: [{ invoiceNumber: "INV-10482", portalReference: "ACME-20260829-ABC12345", portalStatus: "received" }],
    });
    const invalid = deliveryEventRequestSchema.safeParse({
      eventType: "portal_exception",
      idempotencyKey: "exception-20260829-001",
      items: [{ invoiceNumber: "INV-10507", portalReference: "should-not-be-here", exceptionCode: "amount_exceeds_balance", message: "Too high" }],
    });
    expect(valid.success).toBe(true);
    expect(invalid.success).toBe(false);
  });
});
