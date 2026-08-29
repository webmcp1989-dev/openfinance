import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/lib/supabase/bearer", () => ({ createBearerClient: () => ({}) }));
const [{ parseMcpConfig }, { OpenFinanceTokenVerifier }] = await Promise.all([
  import("@/lib/config"),
  import("./auth"),
]);

const config = parseMcpConfig({
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  OPENFINANCE_MCP_URL: "https://ar.example.com/mcp",
});
const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  organizationId: "20000000-0000-4000-8000-000000000001",
  role: "operator" as const,
  fullName: "AR Operator",
};

describe("OpenFinance OAuth token verification", () => {
  test("returns a resource-bound MCP identity for a valid OAuth token", async () => {
    const verifier = new OpenFinanceTokenVerifier(
      config,
      async () => ({
        sub: actor.userId,
        client_id: "oauth-client-1",
        role: "authenticated",
        email: "operator@example.com",
        scope: "email email",
        exp: 2_000_000_000,
      }),
      async () => actor,
    );

    await expect(verifier.verifyAccessToken("signed-token")).resolves.toMatchObject({
      token: "signed-token",
      clientId: "oauth-client-1",
      scopes: ["email"],
      expiresAt: 2_000_000_000,
      resource: config.resourceUrl,
      extra: { subject: actor.userId, actor },
    });
  });

  test("rejects a normal portal session token without an OAuth client ID", async () => {
    const verifier = new OpenFinanceTokenVerifier(
      config,
      async () => ({ sub: actor.userId, role: "authenticated", exp: 2_000_000_000 }),
      async () => actor,
    );
    await expect(verifier.verifyAccessToken("portal-token")).rejects.toMatchObject({ code: "invalid_token" });
  });

  test("rejects an unexpected database role", async () => {
    const verifier = new OpenFinanceTokenVerifier(
      config,
      async () => ({ sub: actor.userId, client_id: "client", role: "service_role", exp: 2_000_000_000 }),
      async () => actor,
    );
    await expect(verifier.verifyAccessToken("privileged-token")).rejects.toMatchObject({ code: "invalid_token" });
  });

  test("normalizes principal lookup failures without leaking details", async () => {
    const verifier = new OpenFinanceTokenVerifier(
      config,
      async () => ({ sub: actor.userId, client_id: "client", role: "authenticated", exp: 2_000_000_000 }),
      async () => { throw new Error("database topology detail"); },
    );
    await expect(verifier.verifyAccessToken("bad-token")).rejects.toMatchObject({
      code: "invalid_token",
      message: "Access token is invalid or expired",
    });
  });
});
