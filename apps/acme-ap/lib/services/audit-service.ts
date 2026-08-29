import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http-core";

export type AuditEvent = Readonly<{
  id: number;
  action: string;
  entityType: string;
  entityId: string;
  details: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export type AuditSnapshot = Readonly<{
  auditEvents: AuditEvent[];
  auditAvailable: boolean;
}>;

export async function listAuditEvents(supabase: SupabaseClient, limit = 8): Promise<AuditEvent[]> {
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, action, entity_type, entity_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new HttpError(500, "audit_query_failed", "Recent activity could not be loaded");
  return (data as Array<{
    id: number;
    action: string;
    entity_type: string;
    entity_id: string;
    details: Record<string, unknown>;
    created_at: string;
  }>).map((row) => ({
    id: Number(row.id),
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details,
    createdAt: row.created_at,
  }));
}

export async function loadAuditSnapshot(
  supabase: SupabaseClient,
  limit = 8,
): Promise<AuditSnapshot> {
  try {
    return { auditEvents: await listAuditEvents(supabase, limit), auditAvailable: true };
  } catch (error) {
    if (error instanceof HttpError && error.code === "audit_query_failed") {
      return { auditEvents: [], auditAvailable: false };
    }
    throw error;
  }
}
