import "server-only";

import { getMcpConfig } from "@/lib/config";

export function getProtectedResourceMetadata() {
  const config = getMcpConfig();
  return {
    resource: config.resourceUrl.href,
    authorization_servers: [config.authorizationServerUrl.href.replace(/\/$/, "")],
    bearer_methods_supported: ["header"],
    scopes_supported: [...config.scopes],
    resource_name: "OpenFinance AR",
    resource_documentation: config.documentationUrl.href,
  };
}

export function getAuthorizationServerMetadata() {
  const config = getMcpConfig();
  const issuer = config.authorizationServerUrl.href.replace(/\/$/, "");
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/clients/register`,
    jwks_uri: config.jwksUrl.href,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["openid", "email", "profile", "phone"],
  };
}

export function publicMetadataResponse(body: Record<string, unknown>) {
  return Response.json(body, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
