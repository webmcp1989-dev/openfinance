import "server-only";

export function safeOAuthRedirect(value: string) {
  const target = new URL(value);
  const isSecure = target.protocol === "https:";
  const isLoopback = target.protocol === "http:"
    && (target.hostname === "localhost" || target.hostname === "127.0.0.1" || target.hostname === "[::1]");
  if (!isSecure && !isLoopback) throw new Error("OAuth redirect is not permitted");
  return target.href;
}
