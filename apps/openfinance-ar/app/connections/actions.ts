"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const clientIdSchema = z.string().uuid();

export async function revokeConnection(formData: FormData) {
  const clientId = clientIdSchema.parse(formData.get("clientId"));
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || typeof claimsData?.claims?.sub !== "string") redirect("/login?returnTo=/connections");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("user_id", claimsData.claims.sub)
    .single();
  if (profileError || !profile) redirect("/login?error=profile_missing");

  const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
  if (error) redirect("/connections?error=revoke_failed");
  revalidatePath("/connections");
  redirect("/connections?revoked=true");
}
