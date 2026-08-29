import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { loadAuditSnapshot } = await import("./audit-service");

function auditClient(result: { data: unknown; error: unknown }) {
  const chain = {
    select() { return chain; },
    order() { return chain; },
    limit() { return Promise.resolve(result); },
  };
  return { from() { return chain; } };
}

describe("Acme audit snapshot", () => {
  test("reports an available empty audit trail", async () => {
    await expect(loadAuditSnapshot(auditClient({ data: [], error: null }) as never)).resolves.toEqual({
      auditEvents: [],
      auditAvailable: true,
    });
  });

  test("degrades explicitly when the optional audit query fails", async () => {
    await expect(loadAuditSnapshot(auditClient({ data: null, error: { code: "PGRST002" } }) as never)).resolves.toEqual({
      auditEvents: [],
      auditAvailable: false,
    });
  });

  test("does not hide unexpected audit mapping failures", async () => {
    await expect(loadAuditSnapshot(auditClient({ data: null, error: null }) as never)).rejects.toBeInstanceOf(TypeError);
  });
});
