import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http-core";

export type WorkspaceContext = Readonly<{
  userId: string;
  fullName: string;
  role: "admin" | "operator" | "viewer";
  organizationId: string;
  organizationName: string;
}>;

export type CustomerSummary = Readonly<{
  id: string;
  name: string;
  portalOrigin: string;
}>;

export async function getWorkspaceContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkspaceContext> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, full_name, role, organization_id")
    .eq("user_id", userId)
    .single();
  if (profileError || !profile) {
    throw new HttpError(403, "workspace_access_required", "The caller is not assigned to an AR workspace");
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", profile.organization_id)
    .single();
  if (organizationError || !organization) {
    throw new HttpError(403, "workspace_access_required", "The caller is not assigned to an AR workspace");
  }

  const role = profile.role;
  if (role !== "admin" && role !== "operator" && role !== "viewer") {
    throw new HttpError(403, "workspace_access_required", "The caller has an invalid AR workspace role");
  }

  return {
    userId: profile.user_id,
    fullName: profile.full_name,
    role,
    organizationId: organization.id,
    organizationName: organization.name,
  };
}

export async function listCustomers(supabase: SupabaseClient): Promise<CustomerSummary[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, name, portal_origin")
    .order("name", { ascending: true });
  if (error) throw new HttpError(500, "customer_query_failed", "Customers could not be loaded");

  return data.map((customer) => ({
    id: customer.id,
    name: customer.name,
    portalOrigin: customer.portal_origin,
  }));
}
