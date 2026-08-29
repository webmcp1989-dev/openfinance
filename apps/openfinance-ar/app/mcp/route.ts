import {
  createMcpHandler,
  originValidationResponse,
  requireBearerAuth,
  validateHostHeader,
  type AuthInfo,
} from "@modelcontextprotocol/server";

import { getMcpConfig } from "@/lib/config";
import { getOpenFinanceTokenVerifier } from "@/lib/mcp/auth";
import { createOpenFinanceMcpServer } from "@/lib/mcp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MCP_REQUEST_BYTES = 128 * 1024;

const handler = createMcpHandler(({ authInfo }) => {
  if (!authInfo) throw new Error("MCP authentication context is missing");
  return createOpenFinanceMcpServer(authInfo);
}, {
  legacy: "stateless",
  responseMode: "json",
});

function jsonError(status: number, code: string, message: string, extraHeaders: HeadersInit = {}) {
  const headers = new Headers(extraHeaders);
  headers.set("Cache-Control", "no-store");
  return Response.json({ error: { code, message } }, {
    status,
    headers,
  });
}

function validateNetworkBoundary(request: Request) {
  const config = getMcpConfig();
  const requestUrl = new URL(request.url);
  const hostHeader = request.headers.get("host") ?? requestUrl.host;
  const host = validateHostHeader(hostHeader, [...config.allowedHostnames]);
  if (!host.ok) return jsonError(403, "invalid_host", "The MCP host is not allowed");
  return originValidationResponse(request, [...config.allowedOriginHostnames]);
}

function withMcpResponseHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.append("Vary", "Authorization");

  const origin = request.headers.get("origin");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.append("Vary", "Origin");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function getBearerGate() {
  const config = getMcpConfig();
  return requireBearerAuth({
    verifier: getOpenFinanceTokenVerifier(),
    resourceMetadataUrl: config.resourceMetadataUrl.href,
  });
}

async function authenticatedRequest(request: Request) {
  const boundaryError = validateNetworkBoundary(request);
  if (boundaryError) return boundaryError;

  const auth: AuthInfo | Response = await getBearerGate()(request);
  if (auth instanceof Response) return withMcpResponseHeaders(auth, request);

  if (request.method !== "POST") {
    return withMcpResponseHeaders(jsonError(
      405,
      "method_not_allowed",
      "This stateless MCP endpoint accepts POST requests",
      { Allow: "POST, OPTIONS" },
    ), request);
  }

  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return withMcpResponseHeaders(jsonError(415, "unsupported_media_type", "Content-Type must be application/json"), request);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_REQUEST_BYTES) {
    return withMcpResponseHeaders(jsonError(413, "request_too_large", "MCP request exceeds 128 KiB"), request);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_MCP_REQUEST_BYTES) {
    return withMcpResponseHeaders(jsonError(413, "request_too_large", "MCP request exceeds 128 KiB"), request);
  }

  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
  });
  const response = await handler.fetch(boundedRequest, { authInfo: auth });
  return withMcpResponseHeaders(response, request);
}

export async function POST(request: Request) {
  return authenticatedRequest(request);
}

export async function GET(request: Request) {
  return authenticatedRequest(request);
}

export async function DELETE(request: Request) {
  return authenticatedRequest(request);
}

export function OPTIONS(request: Request) {
  const boundaryError = validateNetworkBoundary(request);
  if (boundaryError) return boundaryError;
  const origin = request.headers.get("origin");
  const headers = new Headers({
    Allow: "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
  }
  return new Response(null, { status: 204, headers });
}
