import { getProtectedResourceMetadata, publicMetadataResponse } from "@/lib/mcp/metadata";

export function GET() {
  return publicMetadataResponse(getProtectedResourceMetadata());
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", Allow: "GET, OPTIONS" },
  });
}
