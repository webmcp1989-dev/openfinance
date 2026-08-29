import Link from "next/link";

import { getMcpConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export const remoteMcpToolNames = [
  "get_ar_workspace",
  "list_customers",
  "list_invoices",
  "get_submission_package",
  "list_portal_followups",
  "get_invoice_supporting_documents",
  "list_audit_events",
  "sync_invoices_from_erp",
  "record_portal_result",
  "record_portal_exception",
  "record_payment_remittance",
];

export default function McpInfoPage() {
  const config = getMcpConfig();
  return (
    <main className="connections-shell mcp-info-shell">
      <header className="connections-header"><div><p className="eyebrow">OpenFinance AR</p><h1>Remote MCP server</h1><p>Connect an AR team&apos;s agent to its own governed OpenFinance workspace.</p></div><Link className="button quiet" href="/">Open AR workspace</Link></header>
      <section className="mcp-info-card">
        <h2>Connection</h2>
        <dl><div><dt>Server URL</dt><dd><code>{config.resourceUrl.href}</code></dd></div><div><dt>Authentication</dt><dd>Supabase OAuth 2.1 with PKCE, dynamic client registration, explicit consent, and revocation.</dd></div><div><dt>Authorization</dt><dd>Audience-bound JWT validation, authenticated AR membership, workspace roles, and Supabase Row Level Security.</dd></div></dl>
      </section>
      <section className="mcp-info-card"><h2>Available tools</h2><ul className="tool-inventory">{remoteMcpToolNames.map((tool) => <li key={tool}><code>{tool}</code></li>)}</ul><p>Demo reset is deliberately excluded. The MCP is an AR-team access surface; customer AP interoperability remains browser-mediated WebMCP and requires separate informed approval before data transfer and submission.</p></section>
      <section className="mcp-info-card"><h2>Human control</h2><p>OAuth consent explains the exact access being granted. AI clients should require approval for consequential write tools. Every mutation remains tenant-scoped, role-checked, transactional, idempotent where retried, and visible in the AR audit trail.</p><Link href="/connections">Manage agent connections</Link></section>
    </main>
  );
}
