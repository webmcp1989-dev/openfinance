import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const requests: Array<{ path: string; init?: RequestInit }> = [];
mock.module("@/lib/browser-api", () => ({
  apiRequest: mock(async (path: string, init?: RequestInit) => {
    requests.push({ path, init });
    if (init?.method === "POST") {
      return {
        approvalId: "90000000-0000-4000-8000-000000000001",
        status: "pending",
        expiresAt: "2099-09-01T10:05:00.000Z",
      };
    }
    return { status: "approved" };
  }),
}));

const {
  ACME_DOCUMENT_APPROVAL_EVENT,
  ACME_DOCUMENT_APPROVAL_SETTLED_EVENT,
  obtainDocumentSubmissionApproval,
} = await import("./document-submission-approval");

const approvalRequest = {
  idempotencyKey: "approval-lifecycle-20260901",
  initiatedBy: "agent" as const,
  manifest: {
    action: "replace_rejected_invoice" as const,
    invoice: {
      invoiceNumber: "INV-10479",
      invoiceDate: "2026-08-10",
      amountMinor: 410_000,
      currency: "USD",
      purchaseOrderNumber: "PO-8955",
      document: {
        fileName: "INV-10479.pdf",
        mediaType: "application/pdf" as const,
        sha256: "a".repeat(64),
      },
    },
  },
};

let scheduledTimeout: (() => void) | null;
let browserWindow: EventTarget & {
  setTimeout: (callback: () => void) => number;
  clearTimeout: (id: number) => void;
};

beforeEach(() => {
  requests.length = 0;
  scheduledTimeout = null;
  browserWindow = Object.assign(new EventTarget(), {
    setTimeout(callback: () => void) {
      scheduledTimeout = callback;
      return 1;
    },
    clearTimeout() {},
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("document submission approval lifecycle", () => {
  test("records an explicit human decision and emits a matching settled event", async () => {
    const settled = new Promise<string>((resolve) => {
      browserWindow.addEventListener(ACME_DOCUMENT_APPROVAL_SETTLED_EVENT, (event) => {
        resolve((event as CustomEvent<{ approvalId: string }>).detail.approvalId);
      }, { once: true });
    });
    browserWindow.addEventListener(ACME_DOCUMENT_APPROVAL_EVENT, (event) => {
      (event as CustomEvent<{ decide: (decision: "approved") => void }>).detail.decide("approved");
    }, { once: true });

    await expect(obtainDocumentSubmissionApproval(approvalRequest)).resolves.toBe("90000000-0000-4000-8000-000000000001");
    await expect(settled).resolves.toBe("90000000-0000-4000-8000-000000000001");
    expect(requests.map(({ init }) => init?.method)).toEqual(["POST", "PATCH"]);
  });

  test("expires locally without trying to approve or deny an already expired database record", async () => {
    const settled = new Promise<void>((resolve) => {
      browserWindow.addEventListener(ACME_DOCUMENT_APPROVAL_SETTLED_EVENT, () => resolve(), { once: true });
    });
    const pendingApproval = obtainDocumentSubmissionApproval(approvalRequest);
    await Promise.resolve();
    expect(scheduledTimeout).not.toBeNull();
    scheduledTimeout?.();

    await expect(pendingApproval).rejects.toMatchObject({ name: "AbortError", message: "Human approval expired. Nothing was sent." });
    await settled;
    expect(requests.map(({ init }) => init?.method)).toEqual(["POST"]);
  });

  test("cancellation dismisses the request without transmitting a decision or document", async () => {
    const controller = new AbortController();
    const pendingApproval = obtainDocumentSubmissionApproval(approvalRequest, controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(pendingApproval).rejects.toMatchObject({ name: "AbortError", message: "Document submission was cancelled. Nothing was sent." });
    expect(requests.map(({ init }) => init?.method)).toEqual(["POST"]);
  });
});
