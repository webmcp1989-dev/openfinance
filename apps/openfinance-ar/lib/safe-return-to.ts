import "server-only";

export function safeReturnTo(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "https://openfinance.local");
    return parsed.origin === "https://openfinance.local" ? `${parsed.pathname}${parsed.search}` : "/";
  } catch {
    return "/";
  }
}
