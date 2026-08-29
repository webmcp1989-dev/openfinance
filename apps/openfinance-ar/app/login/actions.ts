"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeReturnTo } from "@/lib/safe-return-to";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  returnTo: z.string().max(1_000).optional(),
});

function loginErrorUrl(error: string, returnTo: string) {
  const query = new URLSearchParams({ error });
  if (returnTo !== "/") query.set("returnTo", returnTo);
  return `/login?${query}`;
}

export async function signIn(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    returnTo: formData.get("returnTo") || undefined,
  });
  const returnTo = safeReturnTo(parsed.success ? parsed.data.returnTo : formData.get("returnTo"));
  if (!parsed.success) redirect(loginErrorUrl("invalid_input", returnTo));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect(loginErrorUrl("invalid_credentials", returnTo));
  redirect(returnTo);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
