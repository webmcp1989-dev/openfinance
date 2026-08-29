import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { revokeConnection } from "./actions";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; revoked?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || typeof claimsData?.claims?.sub !== "string") redirect("/login?returnTo=/connections");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("user_id", claimsData.claims.sub)
    .single();
  if (profileError || !profile) redirect("/login?error=profile_missing");

  const { data: grants, error } = await supabase.auth.oauth.listGrants();
  return (
    <main className="connections-shell">
      <header className="connections-header"><div><p className="eyebrow">OpenFinance</p><h1>Agent connections</h1><p>Review and revoke AI clients authorized by {profile.full_name}.</p></div><Link className="button quiet" href="/">Back to AR workspace</Link></header>
      {query.revoked ? <p className="notice success" role="status">Agent access was revoked and its refresh tokens were invalidated.</p> : null}
      {query.error || error ? <p className="notice error" role="alert">Connections could not be updated. Try again.</p> : null}
      <section className="connections-list" aria-label="Authorized OAuth clients">
        {!error && grants?.length === 0 ? <div className="empty-compact"><strong>No connected agents</strong><p>Connect an MCP client to see it here.</p></div> : null}
        {grants?.map((grant) => <article key={grant.client.id}>
          <div><strong>{grant.client.name || "Unnamed OAuth client"}</strong><span>Authorized {new Date(grant.granted_at).toLocaleDateString("en-US")}</span><small>{grant.client.uri || grant.client.id}</small></div>
          <form action={revokeConnection}><input name="clientId" type="hidden" value={grant.client.id} /><button className="button danger" type="submit">Revoke access</button></form>
        </article>)}
      </section>
    </main>
  );
}
