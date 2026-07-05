import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type AppRole = "super_user" | "sub_super_user" | "manager" | "employee";
type RoleRow = { role: AppRole; company_id: string | null; branch_id: string | null };
type UserRow = {
  id: string;
  full_name: string;
  email: string;
  company_id: string | null;
  branch_id: string | null;
  is_active: boolean | null;
  account_status?: string | null;
};
type LeadRow = { id: string; company_id: string; branch_id: string | null; status: string };
type AdminClient = ReturnType<typeof createClient<any, "public", any>>;

const activeStatuses = [
  "new",
  "allocated",
  "call_attempted",
  "no_answer",
  "whatsapp_sent",
  "call_back_later",
  "waiting_for_patient_response",
  "callback_due",
  "booking_recorded_pending_verification",
  "manager_review",
  "cooling_list",
];

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

async function getContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Supabase public environment variables are not configured.");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for lead allocation.");

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
  if (authError || !authData.user) throw new Error("You must be signed in to allocate patient journeys.");

  const admin = createClient<any, "public", any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: roles, error: roleError } = await admin
    .from("user_roles")
    .select("role,company_id,branch_id")
    .eq("user_id", authData.user.id);
  if (roleError) throw new Error(roleError.message);

  const roleRows = (roles ?? []) as RoleRow[];
  const isSuper = roleRows.some((row) => row.role === "super_user" || row.role === "sub_super_user");
  const isManager = roleRows.some((row) => row.role === "manager");
  if (!isSuper && !isManager) throw new Error("Only Super Users, Sub Super Users and Managers can allocate patient journeys.");

  return { admin, actorId: authData.user.id, roles: roleRows, isSuper };
}

function isActiveUser(user: UserRow) {
  return Boolean(user.is_active) && (user.account_status ?? "active") === "active";
}

function scopedCompanyIds(roles: RoleRow[]) {
  return Array.from(new Set(roles.filter((row) => row.company_id).map((row) => row.company_id as string)));
}

function scopedBranchIds(roles: RoleRow[]) {
  return Array.from(new Set(roles.filter((row) => row.branch_id).map((row) => row.branch_id as string)));
}

function userAllowedByRequester(user: UserRow, roles: RoleRow[], isSuper: boolean) {
  if (isSuper) return true;
  const companyIds = scopedCompanyIds(roles);
  const branchIds = scopedBranchIds(roles);
  if (branchIds.length) return Boolean(user.branch_id && branchIds.includes(user.branch_id));
  return Boolean(user.company_id && companyIds.includes(user.company_id));
}

function leadAllowedByRequester(lead: LeadRow, roles: RoleRow[], isSuper: boolean) {
  if (isSuper) return true;
  const companyIds = scopedCompanyIds(roles);
  const branchIds = scopedBranchIds(roles);
  if (branchIds.length) return Boolean(lead.branch_id && branchIds.includes(lead.branch_id));
  return companyIds.includes(lead.company_id);
}

function leadAssignableToUser(lead: LeadRow, user: UserRow) {
  if (!user.company_id || lead.company_id !== user.company_id) return false;
  if (lead.branch_id && user.branch_id && lead.branch_id !== user.branch_id) return false;
  return activeStatuses.includes(lead.status);
}

async function safeAudit(admin: AdminClient, payload: Record<string, unknown>) {
  await admin.from("audit_logs").insert(payload);
}

export async function GET(request: NextRequest) {
  try {
    const { admin, roles, isSuper } = await getContext(request);
    const { data: employeeRoles, error: roleError } = await admin
      .from("user_roles")
      .select("user_id,role,company_id,branch_id")
      .eq("role", "employee");
    if (roleError) throw new Error(roleError.message);

    const userIds = Array.from(new Set((employeeRoles ?? []).map((row: { user_id: string }) => row.user_id)));
    if (!userIds.length) return NextResponse.json({ users: [] });

    const { data: users, error: userError } = await admin
      .from("users")
      .select("id,full_name,email,company_id,branch_id,is_active,account_status")
      .in("id", userIds)
      .order("full_name");
    if (userError) throw new Error(userError.message);

    const assignable = ((users ?? []) as UserRow[])
      .filter(isActiveUser)
      .filter((user) => userAllowedByRequester(user, roles, isSuper))
      .map((user) => ({
        id: user.id,
        name: user.full_name,
        email: user.email,
        role: "employee",
        companyId: user.company_id,
        branchId: user.branch_id,
      }));

    return NextResponse.json({ users: assignable });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to load allocatable employees.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as { employee_id?: string; lead_ids?: string[]; limit?: number; company_id?: string | null; branch_id?: string | null };
    if (!payload.employee_id) return jsonError("Choose an active employee before allocating leads.");

    const { admin, actorId, roles, isSuper } = await getContext(request);
    const { data: targetUser, error: targetError } = await admin
      .from("users")
      .select("id,full_name,email,company_id,branch_id,is_active,account_status")
      .eq("id", payload.employee_id)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!targetUser || !isActiveUser(targetUser as UserRow)) return jsonError("The selected employee is not active.");

    const { data: targetRoles, error: targetRoleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", payload.employee_id);
    if (targetRoleError) throw new Error(targetRoleError.message);
    if (!(targetRoles ?? []).some((row: { role: string }) => row.role === "employee")) {
      return jsonError("Lead allocation is currently limited to Employee / Patient Care Coordinator accounts.");
    }
    if (!userAllowedByRequester(targetUser as UserRow, roles, isSuper)) return jsonError("You cannot allocate work to an employee outside your assigned scope.", 403);

    const requestedLimit = Math.max(1, Math.min(Number(payload.limit ?? 25), 250));
    let leadQuery = admin
      .from("leads")
      .select("id,company_id,branch_id,status,priority_score,created_at")
      .order("priority_score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(payload.lead_ids?.length ? payload.lead_ids.length : requestedLimit * 3);

    if (payload.lead_ids?.length) {
      leadQuery = leadQuery.in("id", payload.lead_ids);
    } else {
      leadQuery = leadQuery.eq("status", "new");
      if (payload.company_id) leadQuery = leadQuery.eq("company_id", payload.company_id);
      if (payload.branch_id) leadQuery = leadQuery.eq("branch_id", payload.branch_id);
      if ((targetUser as UserRow).company_id) leadQuery = leadQuery.eq("company_id", (targetUser as UserRow).company_id);
    }

    const { data: leads, error: leadError } = await leadQuery;
    if (leadError) throw new Error(leadError.message);
    const candidateLeads = ((leads ?? []) as LeadRow[])
      .filter((lead) => leadAllowedByRequester(lead, roles, isSuper))
      .filter((lead) => leadAssignableToUser(lead, targetUser as UserRow));
    if (!candidateLeads.length) return jsonError("No eligible unassigned leads are available for the selected employee and scope.", 409);

    const candidateIds = candidateLeads.map((lead) => lead.id);
    const { data: existingAssignments, error: assignmentError } = await admin
      .from("lead_assignments")
      .select("lead_id")
      .in("lead_id", candidateIds)
      .is("ended_at", null);
    if (assignmentError) throw new Error(assignmentError.message);

    const alreadyAssigned = new Set((existingAssignments ?? []).map((assignment: { lead_id: string }) => assignment.lead_id));
    const assignableIds = candidateIds.filter((id) => !alreadyAssigned.has(id)).slice(0, requestedLimit);
    if (!assignableIds.length) {
      return jsonError("All matching leads are already actively allocated. Refresh the lead list to see the latest assignments.", 409);
    }

    const { error: insertError } = await admin.from("lead_assignments").insert(assignableIds.map((leadId) => ({
      lead_id: leadId,
      employee_id: payload.employee_id,
      assigned_by: actorId,
      reason: "Allocated from Lead Allocation workspace",
    })));
    if (insertError) throw new Error(insertError.message);

    const now = new Date().toISOString();
    const { error: leadUpdateError } = await admin
      .from("leads")
      .update({ status: "allocated", next_action_at: now, updated_at: now })
      .in("id", assignableIds);
    if (leadUpdateError) throw new Error(leadUpdateError.message);

    await safeAudit(admin, {
      actor_id: actorId,
      company_id: (targetUser as UserRow).company_id,
      entity_type: "lead_assignment",
      action: "allocated_leads",
      after_data: {
        employee_id: payload.employee_id,
        assigned_count: assignableIds.length,
        requested_count: candidateIds.length,
        skipped_already_assigned: candidateIds.length - assignableIds.length,
        lead_ids: assignableIds,
      },
    });

    return NextResponse.json({
      message: `${assignableIds.length.toLocaleString()} lead(s) allocated to ${(targetUser as UserRow).full_name}.`,
      assigned_count: assignableIds.length,
      skipped_already_assigned: candidateIds.length - assignableIds.length,
      lead_ids: assignableIds,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to allocate leads.", 500);
  }
}
