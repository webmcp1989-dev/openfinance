import { redirect } from "next/navigation";

import { signOut } from "@/app/login/actions";
import { AcmeWorkspace } from "@/components/acme-workspace";
import { loadAuditSnapshot } from "@/lib/services/audit-service";
import { listPurchaseOrders, listSubmissions } from "@/lib/services/submission-service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProfileRow = {
  supplier_id: string;
};

type SupplierRow = {
  name: string;
  supplier_code: string;
};

export default async function AcmeHome() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  const userId = authData?.claims?.sub;
  if (authError || typeof userId !== "string") redirect("/login");

  const [{ data: profileData, error: profileError }, purchaseOrders, submissions, auditSnapshot] = await Promise.all([
    supabase
      .from("profiles")
      .select("supplier_id")
      .eq("user_id", userId)
      .single(),
    listPurchaseOrders(supabase),
    listSubmissions(supabase),
    loadAuditSnapshot(supabase),
  ]);
  const profile = profileData as ProfileRow | null;
  if (profileError || !profile) redirect("/login?error=profile_missing");

  const { data: supplierData, error: supplierError } = await supabase
    .from("suppliers")
    .select("name, supplier_code")
    .eq("id", profile.supplier_id)
    .single();
  const supplier = supplierData as SupplierRow | null;
  if (supplierError || !supplier) redirect("/login?error=profile_missing");

  return <AcmeWorkspace
    initialPurchaseOrders={purchaseOrders}
    initialSubmissions={submissions}
    initialAuditEvents={auditSnapshot.auditEvents}
    initialAuditAvailable={auditSnapshot.auditAvailable}
    supplierName={supplier.name}
    supplierCode={supplier.supplier_code}
    signOutAction={signOut}
  />;
}
