import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getSupabaseConfig } from "@/lib/config";

/**
 * Creates an unprivileged Supabase client bound to one validated OAuth token.
 * The publishable key never bypasses RLS; every query retains the user's JWT.
 */
export function createBearerClient(accessToken: string) {
  const config = getSupabaseConfig();
  return createSupabaseClient(config.url, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
