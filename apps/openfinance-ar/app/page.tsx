import { redirect } from "next/navigation";

import { signOut } from "@/app/login/actions";
import { OpenFinanceWorkspace } from "@/components/openfinance-workspace";
import { listInvoiceQueue } from "@/lib/services/invoice-service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProfileRow = {
  full_name: string;
  organizations: { name: string } | { name: string }[];
};

export default async function OpenFinanceHome() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  if (authError || !authData?.claims?.sub) redirect("/login");

  const [{ data: profileData }, invoices] = await Promise.all([
    supabase.from("profiles").select("full_name, organizations!inner(name)").single(),
    listInvoiceQueue(supabase),
  ]);

  const profile = profileData as unknown as ProfileRow | null;
  if (!profile) redirect("/login?error=profile_missing");
  const organizationName = Array.isArray(profile.organizations)
    ? profile.organizations[0]?.name ?? "Supplier"
    : profile.organizations.name;

  return <OpenFinanceWorkspace
    initialInvoices={invoices}
    fullName={profile.full_name}
    organizationName={organizationName}
    signOutAction={signOut}
  />;
}
