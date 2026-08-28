import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export async function requireAuthenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) throw new HttpError(401, "authentication_required", "Sign in to continue");
  return supabase;
}

export function requireSameOriginJson(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    throw new HttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    throw new HttpError(403, "cross_site_request_blocked", "A same-origin request is required");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprint(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function apiError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return Response.json({ error: { code: "internal_error", message: "The request could not be completed" } }, { status: 500 });
}
