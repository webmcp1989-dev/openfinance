import { getAuthorizationServerMetadata, publicMetadataResponse } from "@/lib/mcp/metadata";

/** Compatibility metadata for older MCP clients. Current clients discover the
 * canonical Supabase authorization server through RFC 9728 first. */
export function GET() {
  return publicMetadataResponse(getAuthorizationServerMetadata());
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", Allow: "GET, OPTIONS" },
  });
}
