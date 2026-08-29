import "server-only";

import type { NextRequest } from "next/server";

import { HttpError } from "@/lib/http-core";
import { createClient } from "@/lib/supabase/server";

export { fingerprint, HttpError } from "@/lib/http-core";

export async function requireAuthenticatedClient() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) {
    throw new HttpError(401, "authentication_required", "Sign in to continue");
  }
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

export function apiError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return Response.json(
    { error: { code: "internal_error", message: "The request could not be completed" } },
    { status: 500 },
  );
}
