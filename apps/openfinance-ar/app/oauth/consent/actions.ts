"use server";

import { redirect } from "next/navigation";

import { authorizationIdSchema, safeOAuthRedirect } from "@/lib/mcp/oauth";
import { createClient } from "@/lib/supabase/server";

async function decide(formData: FormData, decision: "approve" | "deny") {
  const authorizationId = authorizationIdSchema.parse(formData.get("authorizationId"));
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || typeof claimsData?.claims?.sub !== "string") redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", claimsData.claims.sub)
    .single();
  if (profileError || !profile) redirect("/login?error=profile_missing");

  const response = decision === "approve"
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (response.error || !response.data?.redirect_url) {
    redirect(`/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}&error=decision_failed`);
  }
  redirect(safeOAuthRedirect(response.data.redirect_url));
}

export async function approveAuthorization(formData: FormData) {
  return decide(formData, "approve");
}

export async function denyAuthorization(formData: FormData) {
  return decide(formData, "deny");
}
