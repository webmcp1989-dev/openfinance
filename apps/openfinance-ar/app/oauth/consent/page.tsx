import { redirect } from "next/navigation";
import { z } from "zod";

import { safeOAuthRedirect } from "@/lib/mcp/oauth";
import { createClient } from "@/lib/supabase/server";
import { approveAuthorization, denyAuthorization } from "./actions";

const querySchema = z.object({
  authorization_id: z.string().uuid(),
  error: z.string().optional(),
}).strict();

function scopeLabel(scope: string) {
  return ({
    email: "Confirm the email address attached to this OpenFinance account",
    openid: "Confirm your OpenFinance identity",
    profile: "Read your basic OpenFinance profile",
    phone: "Read the phone number attached to your identity",
  } as Record<string, string>)[scope] ?? scope;
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parsed = querySchema.safeParse(await searchParams);
  if (!parsed.success) {
    return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">OpenFinance</p><h1>Invalid authorization request</h1><p className="form-error">Return to your agent and start the connection again.</p></section></main>;
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || typeof claimsData?.claims?.sub !== "string") {
    const returnTo = `/oauth/consent?authorization_id=${encodeURIComponent(parsed.data.authorization_id)}`;
    redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("user_id", claimsData.claims.sub)
    .single();
  if (profileError || !profile) redirect("/login?error=profile_missing");

  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(parsed.data.authorization_id);
  if (error || !data) {
    return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">OpenFinance</p><h1>Authorization expired</h1><p className="form-error">Return to your agent and start the connection again.</p></section></main>;
  }
  if ("redirect_url" in data) redirect(safeOAuthRedirect(data.redirect_url));

  const scopes = data.scope.split(/\s+/).filter(Boolean);
  return (
    <main className="auth-shell">
      <section className="auth-card consent-card" aria-labelledby="consent-title">
        <p className="eyebrow">OpenFinance agent access</p>
        <h1 id="consent-title">Allow {data.client.name || "this agent"} to use your AR workspace?</h1>
        <p className="consent-intro">Signed in as <strong>{profile.full_name}</strong> ({profile.role}). The agent acts with your existing tenant and role boundaries.</p>

        <div className="consent-client">
          <span>Requesting client</span>
          <strong>{data.client.name || "Unnamed OAuth client"}</strong>
          <small>{data.redirect_uri}</small>
        </div>

        <div className="consent-permissions">
          <strong>This connection can:</strong>
          <ul>
            <li>Read customers, invoices, protected PDFs, and audit activity in your AR organization.</li>
            <li>Sync invoices and record verified portal outcomes when your OpenFinance role permits it.</li>
            <li>Never access another tenant, bypass Row Level Security, reset the demo, or connect directly to a customer AP database.</li>
          </ul>
        </div>

        {scopes.length > 0 ? <div className="consent-scopes"><strong>Identity scopes requested</strong><ul>{scopes.map((scope) => <li key={scope}>{scopeLabel(scope)}</li>)}</ul></div> : null}
        {parsed.data.error ? <p className="form-error" role="alert">The authorization decision could not be completed. Please try again.</p> : null}

        <div className="consent-actions">
          <form action={denyAuthorization}><input name="authorizationId" type="hidden" value={data.authorization_id} /><button className="button quiet" type="submit">Deny</button></form>
          <form action={approveAuthorization}><input name="authorizationId" type="hidden" value={data.authorization_id} /><button className="button primary" type="submit">Allow agent access</button></form>
        </div>
        <p className="consent-footnote">You can revoke this client at any time from Agent connections. Consequential tool calls should still require confirmation in your AI client.</p>
      </section>
    </main>
  );
}
