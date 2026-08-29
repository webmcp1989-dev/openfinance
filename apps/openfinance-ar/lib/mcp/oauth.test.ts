import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { authorizationIdSchema, safeOAuthRedirect } = await import("./oauth");

describe("OpenFinance OAuth request boundaries", () => {
  test("accepts current Supabase opaque authorization request IDs", () => {
    expect(authorizationIdSchema.parse("rp2qniqvxmnkt3kpzj4oql6hm5niysrr"))
      .toBe("rp2qniqvxmnkt3kpzj4oql6hm5niysrr");
  });

  test.each(["short", "contains space and punctuation!", "../authorization"])(
    "rejects malformed authorization request ID %s",
    (value) => expect(authorizationIdSchema.safeParse(value).success).toBe(false),
  );

  test("permits HTTPS and loopback OAuth redirects only", () => {
    expect(safeOAuthRedirect("https://client.example/callback?code=one"))
      .toBe("https://client.example/callback?code=one");
    expect(safeOAuthRedirect("http://localhost:3210/callback")).toBe("http://localhost:3210/callback");
    expect(() => safeOAuthRedirect("http://client.example/callback")).toThrow("OAuth redirect is not permitted");
  });
});
