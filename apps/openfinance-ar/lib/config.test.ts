import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { parseMcpConfig } = await import("./config");

const base = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  OPENFINANCE_MCP_URL: "https://ar.example.com/mcp",
};

describe("OpenFinance MCP configuration", () => {
  test("derives canonical OAuth resource and authorization-server metadata", () => {
    const config = parseMcpConfig(base);

    expect(config.resourceUrl.href).toBe("https://ar.example.com/mcp");
    expect(config.resourceMetadataUrl.href).toBe("https://ar.example.com/.well-known/oauth-protected-resource/mcp");
    expect(config.authorizationServerUrl.href).toBe("https://project.supabase.co/auth/v1");
    expect(config.authorizationServerMetadataUrl.href).toBe("https://project.supabase.co/.well-known/oauth-authorization-server/auth/v1");
    expect(config.allowedHostnames).toEqual(["ar.example.com"]);
  });

  test("requires an explicit canonical resource URL in production", () => {
    expect(() => parseMcpConfig({ ...base, OPENFINANCE_MCP_URL: undefined }))
      .toThrow("OPENFINANCE_MCP_URL is required in production");
  });

  test.each([
    "https://ar.example.com/other",
    "https://ar.example.com/mcp?tenant=one",
    "http://ar.example.com/mcp",
  ])("rejects unsafe or non-canonical resource URL %s", (resourceUrl) => {
    expect(() => parseMcpConfig({ ...base, OPENFINANCE_MCP_URL: resourceUrl })).toThrow();
  });
});
