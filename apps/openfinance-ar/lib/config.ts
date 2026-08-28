import "server-only";

type SupabaseConfig = Readonly<{
  url: string;
  publishableKey: string;
}>;

export function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase environment variables are not configured");
  }

  return { url, publishableKey };
}
