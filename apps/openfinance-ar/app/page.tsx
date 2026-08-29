import { redirect } from "next/navigation";

import { signOut } from "@/app/login/actions";
import { OpenFinanceWorkspace } from "@/components/openfinance-workspace";
import { loadAuditSnapshot } from "@/lib/services/audit-service";
import { listInvoiceQueue } from "@/lib/services/invoice-service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProfileRow = {
  full_name: string;
  organization_id: string;
};

type OrganizationRow = {
  name: string;
};

export default async function OpenFinanceHome() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (authError || typeof userId !== "string") redirect("/login");

  const [{ data: profileData, error: profileError }, invoices, auditSnapshot] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, organization_id")
      .eq("user_id", userId)
      .single(),
    listInvoiceQueue(supabase),
    loadAuditSnapshot(supabase),
  ]);

  const profile = profileData as ProfileRow | null;
  if (profileError || !profile) redirect("/login?error=profile_missing");

  const { data: organizationData, error: organizationError } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", profile.organization_id)
    .single();
  const organization = organizationData as OrganizationRow | null;
  if (organizationError || !organization) redirect("/login?error=profile_missing");

  return <OpenFinanceWorkspace
    initialInvoices={invoices}
    initialAuditEvents={auditSnapshot.auditEvents}
    initialAuditAvailable={auditSnapshot.auditAvailable}
    fullName={profile.full_name}
    organizationName={organization.name}
    signOutAction={signOut}
  />;
}
