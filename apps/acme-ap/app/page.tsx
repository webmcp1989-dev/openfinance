import { redirect } from "next/navigation";

import { signOut } from "@/app/login/actions";
import { AcmeWorkspace } from "@/components/acme-workspace";
import { listPurchaseOrders, listSubmissions } from "@/lib/services/submission-service";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SupplierRow = {
  name: string;
  supplier_code: string;
};

type ProfileRow = {
  suppliers: SupplierRow | SupplierRow[];
};

export default async function AcmeHome() {
  const supabase = await createClient();
  const { data: authData, error: authError } = await supabase.auth.getClaims();
  if (authError || !authData?.claims?.sub) redirect("/login");

  const [{ data: profileData }, purchaseOrders, submissions] = await Promise.all([
    supabase.from("profiles").select("suppliers!inner(name, supplier_code)").single(),
    listPurchaseOrders(supabase),
    listSubmissions(supabase),
  ]);
  const profile = profileData as unknown as ProfileRow | null;
  if (!profile) redirect("/login?error=profile_missing");
  const supplier = Array.isArray(profile.suppliers) ? profile.suppliers[0] : profile.suppliers;
  if (!supplier) redirect("/login?error=profile_missing");

  return <AcmeWorkspace
    initialPurchaseOrders={purchaseOrders}
    initialSubmissions={submissions}
    supplierName={supplier.name}
    supplierCode={supplier.supplier_code}
    signOutAction={signOut}
  />;
}
