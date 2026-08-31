import { describe, expect, test } from "bun:test";

import { isManualOutcomeStatusEligible, parseUtcDateTimeLocal } from "./openfinance-workspace";

describe("manual portal outcome eligibility", () => {
  test("keeps supplier exception and replacement writebacks reachable", () => {
    expect(isManualOutcomeStatusEligible("needs_attention", "result")).toBe(true);
    expect(isManualOutcomeStatusEligible("rejected", "result")).toBe(true);
  });

  test("preserves existing result and exception candidates", () => {
    expect(isManualOutcomeStatusEligible("ready", "result")).toBe(true);
    expect(isManualOutcomeStatusEligible("submitted", "result")).toBe(true);
    expect(isManualOutcomeStatusEligible("accepted", "result")).toBe(false);
    expect(isManualOutcomeStatusEligible("ready", "exception")).toBe(true);
    expect(isManualOutcomeStatusEligible("needs_attention", "exception")).toBe(true);
    expect(isManualOutcomeStatusEligible("rejected", "exception")).toBe(false);
  });
});

describe("UTC remittance timestamps", () => {
  test("preserves the exact UTC time shown by the AP portal", () => {
    expect(parseUtcDateTimeLocal("2026-08-31T22:29")).toBe("2026-08-31T22:29:00.000Z");
    expect(parseUtcDateTimeLocal("2026-08-31T22:29:17")).toBe("2026-08-31T22:29:17.000Z");
  });

  test("rejects missing and impossible timestamps", () => {
    expect(() => parseUtcDateTimeLocal("")).toThrow("exact UTC");
    expect(() => parseUtcDateTimeLocal("2026-02-30T10:00")).toThrow("valid UTC");
  });
});
