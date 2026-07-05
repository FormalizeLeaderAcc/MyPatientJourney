import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { AuditEvent } from "@/lib/types";

type AppRole = "super_user" | "sub_super_user" | "manager" | "employee";
type AuditRow = {
  id: number;
  company_id: string | null;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  request_id: string | null;
  ip_address: string | null;
  created_at: string;
};
type UserRow = { id: string; full_name: string | null; email: string | null };
type CompanyRow = { id: string; name: string | null };

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function limitFrom(request: NextRequest) {
  const parsed = Number(request.nextUrl.searchParams.get("limit") ?? "500");
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(Math.max(Math.trunc(parsed), 25), 1000);
}

function normalizeAction(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);
  if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required to read the audit trail.", 500);

  const response = NextResponse.next({ request });
  const userClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies: { name: string; value: string; options: CookieOptions }[]) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return jsonError("You must be signed in to view audit history.", 401);

  const admin = createClient<any, "public", any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: roles, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id);
  if (roleError) return jsonError(roleError.message, 500);

  const isSuper = ((roles ?? []) as { role: AppRole }[]).some((row) => row.role === "super_user" || row.role === "sub_super_user");
  if (!isSuper) return jsonError("Only Super Users can view the audit trail.", 403);

  const limit = limitFrom(request);
  const { data: rows, error, count } = await admin
    .from("audit_logs")
    .select("id,company_id,actor_id,entity_type,entity_id,action,before_data,after_data,request_id,ip_address,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return jsonError(error.message, 500);

  const auditRows = (rows ?? []) as AuditRow[];
  const actorIds = Array.from(new Set(auditRows.map((row) => row.actor_id).filter(Boolean))) as string[];
  const companyIds = Array.from(new Set(auditRows.map((row) => row.company_id).filter(Boolean))) as string[];

  const [actorResult, companyResult] = await Promise.all([
    actorIds.length
      ? admin.from("users").select("id,full_name,email").in("id", actorIds)
      : Promise.resolve({ data: [], error: null }),
    companyIds.length
      ? admin.from("companies").select("id,name").in("id", companyIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (actorResult.error) return jsonError(actorResult.error.message, 500);
  if (companyResult.error) return jsonError(companyResult.error.message, 500);

  const actorById = new Map(((actorResult.data ?? []) as UserRow[]).map((actor) => [actor.id, actor]));
  const companyById = new Map(((companyResult.data ?? []) as CompanyRow[]).map((company) => [company.id, company]));

  const events: AuditEvent[] = auditRows.map((row) => {
    const actor = row.actor_id ? actorById.get(row.actor_id) : null;
    const company = row.company_id ? companyById.get(row.company_id) : null;
    return {
      id: row.id,
      companyId: row.company_id,
      companyName: company?.name || (row.company_id ? "Unknown company" : "System-wide"),
      actorId: row.actor_id,
      actorName: actor?.full_name || actor?.email || "System",
      actorEmail: actor?.email || "",
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action || normalizeAction(row.action),
      beforeData: row.before_data,
      afterData: row.after_data,
      createdAt: row.created_at,
      requestId: row.request_id,
      ipAddress: row.ip_address,
    };
  });

  return NextResponse.json({ events, total: count ?? events.length, limit });
}
