import "server-only";

type SupabaseConfig = Readonly<{
  url: string;
  publishableKey: string;
}>;

export type McpConfig = Readonly<{
  resourceUrl: URL;
  resourceMetadataUrl: URL;
  documentationUrl: URL;
  authorizationServerUrl: URL;
  authorizationServerMetadataUrl: URL;
  jwksUrl: URL;
  allowedHostnames: readonly string[];
  allowedOriginHostnames: readonly string[];
  scopes: readonly string[];
}>;

const LOCAL_MCP_URL = "http://localhost:3000/mcp";

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase environment variables are not configured");
  }

  return { url, publishableKey };
}

export function parseMcpConfig(environment: Record<string, string | undefined>): McpConfig {
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");

  const configuredResource = environment.OPENFINANCE_MCP_URL;
  if (!configuredResource && environment.NODE_ENV === "production") {
    throw new Error("OPENFINANCE_MCP_URL is required in production");
  }

  const resourceUrl = new URL(configuredResource ?? LOCAL_MCP_URL);
  if (resourceUrl.pathname !== "/mcp" || resourceUrl.search || resourceUrl.hash) {
    throw new Error("OPENFINANCE_MCP_URL must be the canonical /mcp URL without query or fragment");
  }
  if (resourceUrl.protocol !== "https:" && !isLocalHostname(resourceUrl.hostname)) {
    throw new Error("OPENFINANCE_MCP_URL must use HTTPS outside local development");
  }

  const supabaseOrigin = new URL(supabaseUrl);
  if (supabaseOrigin.protocol !== "https:" && !isLocalHostname(supabaseOrigin.hostname)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS outside local development");
  }

  const authorizationServerUrl = new URL("/auth/v1", supabaseOrigin);
  const vercelHostname = environment.VERCEL_URL
    ? new URL(`https://${environment.VERCEL_URL}`).hostname
    : undefined;
  const localHostnames = environment.NODE_ENV === "production"
    ? []
    : ["localhost", "127.0.0.1", "[::1]"];

  return {
    resourceUrl,
    resourceMetadataUrl: new URL(`/.well-known/oauth-protected-resource${resourceUrl.pathname}`, resourceUrl),
    documentationUrl: new URL("/mcp-info", resourceUrl),
    authorizationServerUrl,
    authorizationServerMetadataUrl: new URL(
      `/.well-known/oauth-authorization-server${authorizationServerUrl.pathname}`,
      supabaseOrigin,
    ),
    jwksUrl: new URL("/auth/v1/.well-known/jwks.json", supabaseOrigin),
    allowedHostnames: unique([resourceUrl.hostname, vercelHostname, ...localHostnames]),
    allowedOriginHostnames: unique([resourceUrl.hostname, ...localHostnames]),
    scopes: ["email"],
  };
}

export function getMcpConfig() {
  return parseMcpConfig(process.env);
}
