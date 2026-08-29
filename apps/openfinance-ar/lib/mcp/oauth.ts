import "server-only";

import { z } from "zod";

// Supabase authorization request IDs are opaque, URL-safe values rather than UUIDs.
export const authorizationIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

export function safeOAuthRedirect(value: string) {
  const target = new URL(value);
  const isSecure = target.protocol === "https:";
  const isLoopback = target.protocol === "http:"
    && (target.hostname === "localhost" || target.hostname === "127.0.0.1" || target.hostname === "[::1]");
  if (!isSecure && !isLoopback) throw new Error("OAuth redirect is not permitted");
  return target.href;
}
