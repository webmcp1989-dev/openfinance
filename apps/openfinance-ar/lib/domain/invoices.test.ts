import { describe, expect, test } from "bun:test";

import { deliveryEventRequestSchema, erpSyncRequestSchema, packageRequestSchema } from "./invoices";

describe("OpenFinance agent request contracts", () => {
  test("accepts a unique bounded submission package", () => {
    expect(packageRequestSchema.parse({ invoiceNumbers: ["INV-10482", "INV-10491"] })).toEqual({
      invoiceNumbers: ["INV-10482", "INV-10491"],
    });
  });

  test("rejects duplicate invoice numbers", () => {
    expect(packageRequestSchema.safeParse({ invoiceNumbers: ["INV-10482", "INV-10482"] }).success).toBe(false);
  });

  test("bounds a package response below the deployment payload limit", () => {
    expect(packageRequestSchema.safeParse({
      invoiceNumbers: ["INV-1", "INV-2", "INV-3", "INV-4"],
    }).success).toBe(false);
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

  test("requires an explicit prior reference for a replacement result", () => {
    expect(deliveryEventRequestSchema.parse({
      eventType: "portal_result",
      idempotencyKey: "replacement-result-20260830-01",
      items: [{
        invoiceNumber: "INV-10482",
        portalReference: "ACME-REVISION-02",
        portalStatus: "received",
        supersedesPortalReference: "ACME-ORIGINAL-01",
      }],
    }).items[0]).toMatchObject({ supersedesPortalReference: "ACME-ORIGINAL-01" });
  });

  test("requires one bounded ERP sync idempotency key", () => {
    expect(erpSyncRequestSchema.parse({ idempotencyKey: "erp-sync-request-20260829" })).toEqual({
      idempotencyKey: "erp-sync-request-20260829",
    });
    expect(erpSyncRequestSchema.safeParse({ idempotencyKey: "short" }).success).toBe(false);
    expect(erpSyncRequestSchema.safeParse({
      idempotencyKey: "erp-sync-request-20260829",
      organizationId: "untrusted",
    }).success).toBe(false);
  });
});
