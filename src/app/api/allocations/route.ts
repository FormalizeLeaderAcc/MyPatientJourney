import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type AppRole = "super_user" | "sub_super_user" | "manager" | "employee";
type RoleRow = { role: AppRole; company_id: string | null; branch_id: string | null };
type UserRoleRow = RoleRow & { user_id: string };
type UserRow = {
  id: string;
  full_name: string;
  email: string;
  company_id: string | null;
  branch_id: string | null;
  is_active: boolean | null;
  account_status?: string | null;
};
type LeadRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  patient_id?: string | null;
  status: string;
  next_action_at?: string | null;
  last_visit_date?: string | null;
  priority_label?: string | null;
  integration_refs?: Record<string, unknown> | null;
  patients?: PatientRow | PatientRow[] | null;
};
type PatientRow = {
  full_name?: string | null;
  account_number?: string | null;
  medical_aid_scheme?: string | null;
  medical_aid_option?: string | null;
};
type ContactRow = {
  patient_id: string;
  contact_type: "mobile" | "alternate" | "whatsapp" | "email";
  value: string;
  is_primary: boolean;
};
type AllocationFilters = {
  medical_aids?: string[];
  options?: string[];
  last_visit_years?: string[];
  last_visit_months?: string[];
  attempt_bands?: string[];
  statuses?: string[];
  priorities?: string[];
  red_flags?: string[];
};
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

function effectiveUserScope(user: UserRow, userRoles: RoleRow[] = []) {
  const employeeRole = userRoles.find((row) => row.role === "employee") ?? userRoles[0];
  return {
    companyId: user.company_id ?? employeeRole?.company_id ?? null,
    branchId: user.branch_id ?? employeeRole?.branch_id ?? null,
  };
}

function userAllowedByRequester(user: UserRow, roles: RoleRow[], isSuper: boolean, userRoles: RoleRow[] = []) {
  if (isSuper) return true;
  const userScope = effectiveUserScope(user, userRoles);
  const companyIds = scopedCompanyIds(roles);
  const branchIds = scopedBranchIds(roles);
  if (branchIds.length) return Boolean(userScope.branchId && branchIds.includes(userScope.branchId));
  return Boolean(userScope.companyId && companyIds.includes(userScope.companyId));
}

function leadAllowedByRequester(lead: LeadRow, roles: RoleRow[], isSuper: boolean) {
  if (isSuper) return true;
  const companyIds = scopedCompanyIds(roles);
  const branchIds = scopedBranchIds(roles);
  if (branchIds.length) return Boolean(lead.branch_id && branchIds.includes(lead.branch_id));
  return companyIds.includes(lead.company_id);
}

function leadAssignableToUser(lead: LeadRow, user: UserRow, userRoles: RoleRow[] = []) {
  const userScope = effectiveUserScope(user, userRoles);
  if (!userScope.companyId || lead.company_id !== userScope.companyId) return false;
  if (lead.branch_id && userScope.branchId && lead.branch_id !== userScope.branchId) return false;
  return activeStatuses.includes(lead.status);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function firstRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizeStatus(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function selected(values: string[] | undefined, value: string) {
  return !values?.length || values.includes(value);
}

function lastVisitParts(value: string | null | undefined) {
  if (!value) return { year: "", month: "" };
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return { year: "", month: "" };
  return { year: parsed.getUTCFullYear().toString(), month: String(parsed.getUTCMonth() + 1).padStart(2, "0") };
}

function attemptBand(count: number) {
  if (count >= 3) return "3_plus";
  return String(Math.max(0, count));
}

function hasContact(contacts: ContactRow[], type: ContactRow["contact_type"], fallback: unknown) {
  return contacts.some((contact) => contact.contact_type === type && contact.value) || (typeof fallback === "string" && fallback.trim().length > 0);
}

function redFlagsForLead(lead: LeadRow, contacts: ContactRow[]) {
  const patient = firstRow(lead.patients);
  const refs = lead.integration_refs ?? {};
  const flags: string[] = [];
  const hasMobile = hasContact(contacts, "mobile", refs.mobile_number);
  const hasAlternative = hasContact(contacts, "alternate", refs.alternative_number);
  if (Boolean(refs.manual_contact_required) && !hasMobile && !hasAlternative) flags.push("manual_contact");
  if (!hasMobile) flags.push("missing_mobile");
  if (!hasAlternative) flags.push("missing_alternative");
  if (!patient?.medical_aid_scheme?.trim()) flags.push("missing_medical_aid");
  if (!patient?.medical_aid_option?.trim()) flags.push("missing_option");
  return flags;
}

function matchesFilters(lead: LeadRow, filters: AllocationFilters | undefined, attempts: number, contacts: ContactRow[]) {
  if (!filters) return true;
  const patient = firstRow(lead.patients);
  const visit = lastVisitParts(lead.last_visit_date);
  const flags = redFlagsForLead(lead, contacts);
  const medicalAid = patient?.medical_aid_scheme?.trim() || "Not supplied";
  const option = patient?.medical_aid_option?.trim() || "Not supplied";
  return selected(filters.medical_aids, medicalAid)
    && selected(filters.options, option)
    && selected(filters.last_visit_years, visit.year)
    && selected(filters.last_visit_months, visit.month)
    && selected(filters.attempt_bands, attemptBand(attempts))
    && (!filters.statuses?.length || filters.statuses.map(normalizeStatus).includes(normalizeStatus(lead.status)))
    && selected(filters.priorities, lead.priority_label?.trim() || "Standard Six-Month Recall")
    && (!filters.red_flags?.length || filters.red_flags.some((flag) => flags.includes(flag)));
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function recallDueDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return addMonths(parsed, 6);
}

function isDueForAllocation(lead: LeadRow) {
  const status = lead.status.toLowerCase();
  if (status !== "new") return false;

  const today = new Date();
  const todayDay = today.toISOString().slice(0, 10);
  const refs = lead.integration_refs ?? {};

  if (refs.due_for_six_month_recall === false) {
    const dueDate = recallDueDate(lead.last_visit_date);
    return Boolean(dueDate && dueDate.toISOString().slice(0, 10) <= todayDay);
  }

  if (lead.next_action_at) {
    const nextActionDate = new Date(lead.next_action_at);
    if (!Number.isNaN(nextActionDate.getTime()) && nextActionDate.toISOString().slice(0, 10) > todayDay) return false;
  }

  return true;
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

    const roleRows = (employeeRoles ?? []) as UserRoleRow[];
    const rolesByUser = new Map<string, RoleRow[]>();
    roleRows.forEach((row) => {
      rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row]);
    });

    const assignable = ((users ?? []) as UserRow[])
      .filter(isActiveUser)
      .filter((user) => userAllowedByRequester(user, roles, isSuper, rolesByUser.get(user.id) ?? []))
      .map((user) => {
        const scope = effectiveUserScope(user, rolesByUser.get(user.id) ?? []);
        return {
          id: user.id,
          name: user.full_name,
          email: user.email,
          role: "employee",
          companyId: scope.companyId,
          branchId: scope.branchId,
        };
      });

    return NextResponse.json({ users: assignable });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to load allocatable employees.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as { employee_id?: string; lead_ids?: string[]; limit?: number; company_id?: string | null; branch_id?: string | null; allocation_mode?: "random"; filters?: AllocationFilters };
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
      .select("role,company_id,branch_id")
      .eq("user_id", payload.employee_id);
    if (targetRoleError) throw new Error(targetRoleError.message);
    if (!(targetRoles ?? []).some((row: { role: string }) => row.role === "employee")) {
      return jsonError("Lead allocation is currently limited to Employee / Patient Care Coordinator accounts.");
    }
    const targetRoleRows = (targetRoles ?? []) as RoleRow[];
    const targetScope = effectiveUserScope(targetUser as UserRow, targetRoleRows);
    if (!userAllowedByRequester(targetUser as UserRow, roles, isSuper, targetRoleRows)) return jsonError("You cannot allocate work to an employee outside your assigned scope.", 403);
    if (!targetScope.companyId) return jsonError("The selected employee is not assigned to a company. Edit the employee and assign a company before allocating work.", 409);

    if ((targetUser as UserRow).company_id !== targetScope.companyId || ((targetUser as UserRow).branch_id ?? null) !== (targetScope.branchId ?? null)) {
      const { error: syncError } = await admin
        .from("users")
        .update({ company_id: targetScope.companyId, branch_id: targetScope.branchId ?? null })
        .eq("id", payload.employee_id);
      if (syncError) throw new Error(syncError.message);
      (targetUser as UserRow).company_id = targetScope.companyId;
      (targetUser as UserRow).branch_id = targetScope.branchId ?? null;
    }

    const requestedLimit = Math.max(1, Math.min(Number(payload.limit ?? 25), 250));
    let leadQuery = admin
      .from("leads")
      .select("id,company_id,branch_id,patient_id,status,next_action_at,last_visit_date,priority_label,integration_refs,priority_score,created_at,patients(full_name,account_number,medical_aid_scheme,medical_aid_option)")
      .order("priority_score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(payload.lead_ids?.length ? payload.lead_ids.length : requestedLimit * 3);

    if (payload.lead_ids?.length) {
      leadQuery = leadQuery.in("id", payload.lead_ids);
    } else {
      leadQuery = leadQuery.eq("status", "new");
      if (payload.company_id) leadQuery = leadQuery.eq("company_id", payload.company_id);
      if (payload.branch_id) leadQuery = leadQuery.eq("branch_id", payload.branch_id);
      leadQuery = leadQuery.eq("company_id", targetScope.companyId);
    }

    const { data: leads, error: leadError } = await leadQuery;
    if (leadError) throw new Error(leadError.message);

    const rawLeads = ((leads ?? []) as LeadRow[]);
    const candidateLeadIds = rawLeads.map((lead) => lead.id);
    const patientIds = Array.from(new Set(rawLeads.map((lead) => lead.patient_id).filter(Boolean))) as string[];
    const [attemptResult, contactResult] = await Promise.all([
      candidateLeadIds.length
        ? admin.from("lead_attempts").select("lead_id").in("lead_id", candidateLeadIds)
        : Promise.resolve({ data: [], error: null }),
      patientIds.length
        ? admin.from("patient_contacts").select("patient_id,contact_type,value,is_primary").in("patient_id", patientIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (attemptResult.error) throw new Error(attemptResult.error.message);
    if (contactResult.error) throw new Error(contactResult.error.message);

    const attemptsByLead = new Map<string, number>();
    ((attemptResult.data ?? []) as { lead_id: string }[]).forEach((attempt) => {
      attemptsByLead.set(attempt.lead_id, (attemptsByLead.get(attempt.lead_id) ?? 0) + 1);
    });
    const contactsByPatient = new Map<string, ContactRow[]>();
    ((contactResult.data ?? []) as ContactRow[]).forEach((contact) => {
      contactsByPatient.set(contact.patient_id, [...(contactsByPatient.get(contact.patient_id) ?? []), contact]);
    });

    const candidateLeads = rawLeads
      .filter((lead) => leadAllowedByRequester(lead, roles, isSuper))
      .filter((lead) => leadAssignableToUser(lead, targetUser as UserRow, targetRoleRows))
      .filter(isDueForAllocation)
      .filter((lead) => matchesFilters(lead, payload.filters, attemptsByLead.get(lead.id) ?? 0, contactsByPatient.get(lead.patient_id ?? "") ?? []));
    if (!candidateLeads.length) return jsonError("No due, unassigned leads are available for the selected employee and scope. Future recall leads remain in the pipeline until their six-month review date.", 409);

    const candidateIds = candidateLeads.map((lead) => lead.id);
    const { data: existingAssignments, error: assignmentError } = await admin
      .from("lead_assignments")
      .select("lead_id")
      .in("lead_id", candidateIds)
      .is("ended_at", null);
    if (assignmentError) throw new Error(assignmentError.message);

    const alreadyAssigned = new Set((existingAssignments ?? []).map((assignment: { lead_id: string }) => assignment.lead_id));
    const assignableIds = shuffle(candidateLeads.filter((lead) => !alreadyAssigned.has(lead.id))).slice(0, requestedLimit).map((lead) => lead.id);
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
      company_id: targetScope.companyId,
      entity_type: "lead_assignment",
      action: "allocated_leads",
      after_data: {
        employee_id: payload.employee_id,
        allocation_mode: "random",
        filters: payload.filters ?? {},
        assigned_count: assignableIds.length,
        requested_count: candidateIds.length,
        requested_limit: requestedLimit,
        eligible_pool_count: candidateIds.length,
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
