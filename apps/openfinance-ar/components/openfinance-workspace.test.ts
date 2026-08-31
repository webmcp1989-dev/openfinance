import { describe, expect, test } from "bun:test";

import { isManualOutcomeStatusEligible } from "./openfinance-workspace";

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
