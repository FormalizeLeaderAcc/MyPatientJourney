import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type AppRole = "super_user" | "sub_super_user" | "manager" | "employee";
type AccountStatus = "active" | "invited" | "blocked" | "suspended" | "deleted";
type WorkHandling =
  | { mode: "reassign"; replacement_user_id: string }
  | { mode: "return_to_pool" }
  | { mode: "leave_pending" };

type SetupPayload =
  | { action: "create_company"; name: string; registration_number?: string | null }
  | { action: "update_company"; company_id: string; name: string; registration_number?: string | null }
  | { action: "delete_company"; company_id: string; password: string }
  | { action: "create_branch"; company_id: string; name: string; practice_phone?: string | null }
  | { action: "update_branch"; branch_id: string; name: string; practice_phone?: string | null }
  | { action: "delete_branch"; branch_id: string; password: string }
  | { action: "invite_user"; full_name: string; email: string; role: AppRole; company_id?: string | null; branch_id?: string | null }
  | { action: "update_user_profile"; user_id: string; full_name: string; role: AppRole; company_id?: string | null; branch_id?: string | null }
  | { action: "set_user_status"; user_id: string; status: Exclude<AccountStatus, "invited" | "deleted">; work_handling?: WorkHandling }
  | { action: "delete_user"; user_id: string; work_handling?: WorkHandling }
  | { action: "send_password_reset"; user_id?: string; email?: string }
  | { action: "change_user_email"; user_id: string; email: string }
  | { action: "import_medical_aids"; company_id?: string | null; original_name: string; rows: MedicalAidImportRow[] }
  | { action: "recall_uploaded_list"; uploaded_file_id: string; reason: string; password: string };

type MedicalAidImportRow = {
  scheme_name: string;
  option_name: string;
  quality_score: number;
  category: "unknown" | "low" | "medium" | "high" | "premium";
  notes?: string | null;
};

type AdminClient = ReturnType<typeof createClient<any, "public", any>>;
type RoleRow = { role: AppRole; company_id: string | null; branch_id: string | null };
type ProfileRow = {
  id: string;
  email: string;
  full_name: string;
  company_id: string | null;
  branch_id: string | null;
  is_primary_super?: boolean | null;
  account_status?: AccountStatus | null;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isPrivilegedRole(role?: AppRole | null) {
  return role === "super_user" || role === "sub_super_user";
}

function statusToActive(status: AccountStatus) {
  return status === "active" || status === "invited";
}

const finalLeadStatuses = [
  "patient_booked_and_verified",
  "patient_not_interested",
  "wrong_number_confirmed",
  "patient_moved_away",
  "patient_deceased",
  "duplicate",
  "manager_closed",
];

async function safeAudit(
  admin: AdminClient,
  actorId: string,
  action: string,
  entityType: string,
  entityId?: string | null,
  companyId?: string | null,
  beforeData?: Record<string, unknown> | null,
  afterData?: Record<string, unknown> | null,
) {
  await admin.from("audit_logs").insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    company_id: companyId ?? null,
    before_data: beforeData ?? null,
    after_data: afterData ?? null,
  });
}

async function loadRequester(admin: AdminClient, userId: string) {
  const [roleResult, profileResult] = await Promise.all([
    admin.from("user_roles").select("role,company_id,branch_id").eq("user_id", userId),
    admin.from("users").select("id,email,full_name,company_id,branch_id,is_primary_super,account_status").eq("id", userId).maybeSingle(),
  ]);

  if (roleResult.error) throw new Error(roleResult.error.message);
  if (profileResult.error) {
    const fallback = await admin.from("users").select("id,email,full_name,company_id,branch_id").eq("id", userId).maybeSingle();
    if (fallback.error) throw new Error(fallback.error.message);
    return { roles: (roleResult.data ?? []) as RoleRow[], profile: fallback.data as ProfileRow | null };
  }

  return { roles: (roleResult.data ?? []) as RoleRow[], profile: profileResult.data as ProfileRow | null };
}

async function targetHasPrivilegedRole(admin: AdminClient, targetUserId: string) {
  const { data, error } = await admin.from("user_roles").select("role").eq("user_id", targetUserId);
  if (error) throw new Error(error.message);
  return (data ?? []).some((row) => isPrivilegedRole(row.role as AppRole));
}

async function ensureCanManageUser(admin: AdminClient, requesterIsPrimarySuper: boolean, targetUserId?: string, targetRole?: AppRole) {
  if (requesterIsPrimarySuper) return;
  if (isPrivilegedRole(targetRole)) {
    throw new Error("Only the primary Super User can create or manage Super Users and Sub Super Users.");
  }
  if (targetUserId && await targetHasPrivilegedRole(admin, targetUserId)) {
    throw new Error("Only the primary Super User can manage Super Users and Sub Super Users.");
  }
}

async function verifyPrimarySuperPassword(
  supabaseUrl: string,
  anonKey: string,
  email: string | undefined | null,
  password: string | undefined,
) {
  if (!email) throw new Error("Your Super User email could not be verified.");
  if (!password?.trim()) throw new Error("Enter your Super User password to confirm this protected action.");
  const passwordClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await passwordClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error("Password confirmation failed. Please check your Super User login password.");
}

async function activeLeadCountForCompany(admin: AdminClient, companyId: string) {
  const { count, error } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .not("status", "in", `(${finalLeadStatuses.join(",")})`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function activeLeadCountForBranch(admin: AdminClient, branchId: string) {
  const { count, error } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId)
    .not("status", "in", `(${finalLeadStatuses.join(",")})`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function getActiveAssignmentCount(admin: AdminClient, userId: string) {
  const { count, error } = await admin
    .from("lead_assignments")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", userId)
    .is("ended_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function handleAllocatedWork(
  admin: AdminClient,
  actorId: string,
  userId: string,
  handling: WorkHandling | undefined,
  reason: "user_suspended" | "user_deleted" | "user_blocked",
) {
  const activeCount = await getActiveAssignmentCount(admin, userId);
  if (!activeCount) return { affected: 0 };
  if (!handling) {
    throw new Error(`This user still has ${activeCount} active allocated lead(s). Choose whether to reassign them, return them to the unallocated pool, or leave them pending.`);
  }

  const { data: assignments, error } = await admin
    .from("lead_assignments")
    .select("id,lead_id")
    .eq("employee_id", userId)
    .is("ended_at", null);
  if (error) throw new Error(error.message);
  const activeAssignments = assignments ?? [];
  if (!activeAssignments.length) return { affected: 0 };

  if (handling.mode === "leave_pending") {
    await safeAudit(admin, actorId, "allocated_work_left_pending", "user", userId, null, null, {
      reason,
      active_assignment_count: activeAssignments.length,
    });
    return { affected: activeAssignments.length };
  }

  if (handling.mode === "return_to_pool") {
    const leadIds = activeAssignments.map((assignment) => assignment.lead_id);
    const now = new Date().toISOString();
    const endResult = await admin
      .from("lead_assignments")
      .update({ ended_at: now, reason, reassignment_policy: "returned_to_pool" })
      .in("id", activeAssignments.map((assignment) => assignment.id));
    if (endResult.error) throw new Error(endResult.error.message);
    const leadResult = await admin.from("leads").update({ status: "new", updated_at: now }).in("id", leadIds);
    if (leadResult.error) throw new Error(leadResult.error.message);
    await safeAudit(admin, actorId, "allocated_work_returned_to_pool", "user", userId, null, null, { reason, lead_ids: leadIds });
    return { affected: activeAssignments.length };
  }

  if (!handling.replacement_user_id || handling.replacement_user_id === userId) {
    throw new Error("Choose a different active employee or manager to receive the work.");
  }

  const { data: replacement } = await admin
    .from("users")
    .select("id,account_status,is_active")
    .eq("id", handling.replacement_user_id)
    .maybeSingle();
  const replacementActive = replacement?.account_status ? replacement.account_status === "active" : replacement?.is_active === true;
  if (!replacementActive) throw new Error("The replacement user must be active before work can be reassigned.");

  const now = new Date().toISOString();
  const leadIds = activeAssignments.map((assignment) => assignment.lead_id);
  const endResult = await admin
    .from("lead_assignments")
    .update({
      ended_at: now,
      reason,
      reassignment_policy: "reassigned",
      replacement_employee_id: handling.replacement_user_id,
    })
    .in("id", activeAssignments.map((assignment) => assignment.id));
  if (endResult.error) throw new Error(endResult.error.message);

  const insertResult = await admin.from("lead_assignments").insert(leadIds.map((leadId) => ({
    lead_id: leadId,
    employee_id: handling.replacement_user_id,
    assigned_by: actorId,
    reason: `Reassigned because previous user was ${reason.replace("user_", "")}`,
  })));
  if (insertResult.error) throw new Error(insertResult.error.message);

  await safeAudit(admin, actorId, "allocated_work_reassigned", "user", userId, null, null, {
    reason,
    replacement_user_id: handling.replacement_user_id,
    lead_ids: leadIds,
  });
  return { affected: activeAssignments.length };
}

async function upsertRole(admin: AdminClient, userId: string, role: AppRole, companyId?: string | null, branchId?: string | null) {
  const { error: deleteError } = await admin
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .not("role", "eq", role);
  if (deleteError) throw new Error(deleteError.message);

  const { error } = await admin.from("user_roles").upsert({
    user_id: userId,
    role,
    company_id: companyId ?? null,
    branch_id: branchId ?? null,
  });
  if (error) throw new Error(error.message);
}

async function upsertMedicalAidRows(admin: AdminClient, actorId: string, payload: Extract<SetupPayload, { action: "import_medical_aids" }>) {
  const rows = payload.rows ?? [];
  if (!rows.length) throw new Error("The import does not contain any rows.");

  const validationErrors = rows.flatMap((row, index) => {
    const issues: string[] = [];
    if (!row.scheme_name?.trim()) issues.push("scheme_name is required");
    if (!row.option_name?.trim()) issues.push("option_name is required");
    if (!Number.isFinite(Number(row.quality_score)) || Number(row.quality_score) < 0 || Number(row.quality_score) > 100) issues.push("quality_score must be 0-100");
    if (!["unknown", "low", "medium", "high", "premium"].includes(row.category)) issues.push("category must be Unknown, Low, Medium, High or Premium");
    return issues.map((issue) => ({ row: index + 2, issue }));
  });
  if (validationErrors.length) {
    await admin.from("medical_aid_import_batches").insert({
      company_id: payload.company_id ?? null,
      original_name: payload.original_name || "medical-aid-import.xlsx",
      row_count: rows.length,
      imported_by: actorId,
      status: "failed",
      validation_errors: validationErrors,
    });
    throw new Error(`Medical aid import failed validation: ${validationErrors.slice(0, 3).map((item) => `row ${item.row} ${item.issue}`).join("; ")}`);
  }

  const { data: batch, error: batchError } = await admin
    .from("medical_aid_import_batches")
    .insert({
      company_id: payload.company_id ?? null,
      original_name: payload.original_name || "medical-aid-import.xlsx",
      row_count: rows.length,
      imported_by: actorId,
      status: "imported",
      validation_errors: [],
    })
    .select("id")
    .single();
  if (batchError) throw new Error(batchError.message);

  for (const row of rows) {
    const schemeName = row.scheme_name.trim();
    const normalized = schemeName.toLowerCase().replace(/\s+/g, " ").trim();
    const { data: scheme, error: schemeError } = await admin
      .from("medical_aid_schemes")
      .upsert({
        company_id: payload.company_id ?? null,
        name: schemeName,
        normalized_name: normalized,
        notes: row.notes ?? null,
      }, { onConflict: "company_id,normalized_name" })
      .select("id")
      .single();
    if (schemeError) throw new Error(schemeError.message);

    const { error: optionError } = await admin.from("medical_aid_options").upsert({
      scheme_id: scheme.id,
      option_name: row.option_name.trim(),
      quality_score: Number(row.quality_score),
      category: row.category,
      notes: row.notes ?? null,
      updated_by: actorId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "scheme_id,option_name" });
    if (optionError) throw new Error(optionError.message);
  }

  await safeAudit(admin, actorId, "imported_medical_aid_scoring", "medical_aid_import_batch", batch.id, payload.company_id ?? null, null, {
    row_count: rows.length,
  });
  return { message: `${rows.length} medical aid scoring row(s) imported` };
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);
  if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is not configured in Vercel. Add it before creating companies, branches or invitations from the app.", 500);

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
  if (authError || !authData.user) return jsonError("You must be signed in to perform setup actions.", 401);

  const admin = createClient<any, "public", any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let requester: Awaited<ReturnType<typeof loadRequester>>;
  try {
    requester = await loadRequester(admin, authData.user.id);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to verify your permissions.", 500);
  }

  const requesterIsSuperOperator = requester.roles.some((row) => isPrivilegedRole(row.role));
  const requesterIsPrimarySuper = requester.roles.some((row) => row.role === "super_user") && requester.profile?.is_primary_super === true;
  if (!requesterIsSuperOperator) return jsonError("Only Super Users and Sub Super Users can perform setup actions.", 403);

  const payload = await request.json() as SetupPayload;

  try {
    if (payload.action === "create_company") {
      if (!payload.name?.trim()) return jsonError("Company name is required.");
      const { data, error } = await admin.from("companies").insert({
        name: payload.name.trim(),
        registration_number: payload.registration_number || null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      await safeAudit(admin, authData.user.id, "created_company", "company", data.id, data.id, null, { name: payload.name.trim() });
      return NextResponse.json({ message: "Company created" });
    }

    if (payload.action === "update_company") {
      if (!payload.company_id || !payload.name?.trim()) return jsonError("Company and name are required.");
      const { data: before, error: beforeError } = await admin
        .from("companies")
        .select("id,name,registration_number,is_active")
        .eq("id", payload.company_id)
        .maybeSingle();
      if (beforeError) throw new Error(beforeError.message);
      if (!before) return jsonError("Company not found.", 404);
      const { error } = await admin
        .from("companies")
        .update({
          name: payload.name.trim(),
          registration_number: payload.registration_number || null,
        })
        .eq("id", payload.company_id);
      if (error) throw new Error(error.message);
      await safeAudit(admin, authData.user.id, "updated_company", "company", payload.company_id, payload.company_id, before, {
        name: payload.name.trim(),
        registration_number: payload.registration_number || null,
      });
      return NextResponse.json({ message: "Company updated" });
    }

    if (payload.action === "delete_company") {
      if (!requesterIsPrimarySuper) return jsonError("Only the primary Super User can delete companies.", 403);
      if (!payload.company_id) return jsonError("Company is required.");
      await verifyPrimarySuperPassword(supabaseUrl, anonKey, requester.profile?.email ?? authData.user.email, payload.password);
      const activeLeadCount = await activeLeadCountForCompany(admin, payload.company_id);
      if (activeLeadCount > 0) {
        return jsonError(`This company has ${activeLeadCount.toLocaleString()} active lead(s). Recall/complete those leads before deleting the company.`, 409);
      }
      const { data: before, error: beforeError } = await admin
        .from("companies")
        .select("id,name,registration_number,is_active")
        .eq("id", payload.company_id)
        .maybeSingle();
      if (beforeError) throw new Error(beforeError.message);
      if (!before) return jsonError("Company not found.", 404);
      const { error } = await admin.from("companies").update({ is_active: false }).eq("id", payload.company_id);
      if (error) throw new Error(error.message);
      await safeAudit(admin, authData.user.id, "soft_deleted_company", "company", payload.company_id, payload.company_id, before, {
        is_active: false,
        protected_by_password_confirmation: true,
        active_leads_at_delete: activeLeadCount,
      });
      return NextResponse.json({ message: "Company deleted safely. Historical records remain traceable." });
    }

    if (payload.action === "create_branch") {
      if (!payload.company_id || !payload.name?.trim()) return jsonError("Company and branch name are required.");
      const { data, error } = await admin.from("branches").insert({
        company_id: payload.company_id,
        name: payload.name.trim(),
        practice_phone: payload.practice_phone || null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      await safeAudit(admin, authData.user.id, "created_branch", "branch", data.id, payload.company_id, null, { name: payload.name.trim() });
      return NextResponse.json({ message: "Branch created" });
    }

    if (payload.action === "update_branch") {
      if (!payload.branch_id || !payload.name?.trim()) return jsonError("Branch and name are required.");
      const { data: before, error: beforeError } = await admin
        .from("branches")
        .select("id,company_id,name,practice_phone,is_active")
        .eq("id", payload.branch_id)
        .maybeSingle();
      if (beforeError) throw new Error(beforeError.message);
      if (!before) return jsonError("Branch not found.", 404);
      const { error } = await admin
        .from("branches")
        .update({
          name: payload.name.trim(),
          practice_phone: payload.practice_phone || null,
        })
        .eq("id", payload.branch_id);
      if (error) throw new Error(error.message);
      await safeAudit(admin, authData.user.id, "updated_branch", "branch", payload.branch_id, before.company_id, before, {
        name: payload.name.trim(),
        practice_phone: payload.practice_phone || null,
      });
      return NextResponse.json({ message: "Branch updated" });
    }

    if (payload.action === "delete_branch") {
      if (!requesterIsPrimarySuper) return jsonError("Only the primary Super User can delete branches.", 403);
      if (!payload.branch_id) return jsonError("Branch is required.");
      await verifyPrimarySuperPassword(supabaseUrl, anonKey, requester.profile?.email ?? authData.user.email, payload.password);
      const activeLeadCount = await activeLeadCountForBranch(admin, payload.branch_id);
      if (activeLeadCount > 0) {
        return jsonError(`This branch has ${activeLeadCount.toLocaleString()} active lead(s). Recall/complete those leads before deleting the branch.`, 409);
      }
      const { data: before, error: beforeError } = await admin
        .from("branches")
        .select("id,company_id,name,practice_phone,is_active")
        .eq("id", payload.branch_id)
        .maybeSingle();
      if (beforeError) throw new Error(beforeError.message);
      if (!before) return jsonError("Branch not found.", 404);
      const { error } = await admin.from("branches").update({ is_active: false }).eq("id", payload.branch_id);
      if (error) throw new Error(error.message);
      await safeAudit(admin, authData.user.id, "soft_deleted_branch", "branch", payload.branch_id, before.company_id, before, {
        is_active: false,
        protected_by_password_confirmation: true,
        active_leads_at_delete: activeLeadCount,
      });
      return NextResponse.json({ message: "Branch deleted safely. Historical records remain traceable." });
    }

    if (payload.action === "invite_user") {
      if (!payload.full_name?.trim() || !payload.email?.trim()) return jsonError("Full name and email are required.");
      await ensureCanManageUser(admin, requesterIsPrimarySuper, undefined, payload.role);
      const email = normalizeEmail(payload.email);
      let userId: string | undefined;

      const { data: existingProfile } = await admin.from("users").select("id").eq("email", email).maybeSingle();
      userId = existingProfile?.id;

      if (!userId) {
        const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: payload.full_name.trim(), role: payload.role },
          redirectTo: `${request.nextUrl.origin}/auth/confirm`,
        });
        if (inviteError) throw new Error(inviteError.message);
        userId = inviteData.user?.id;
      }

      if (!userId) throw new Error("Unable to create or locate invited user.");

      const { error: profileError } = await admin.from("users").upsert({
        id: userId,
        full_name: payload.full_name.trim(),
        email,
        company_id: payload.company_id || null,
        branch_id: payload.branch_id || null,
        is_active: true,
        account_status: "invited",
      });
      if (profileError) throw new Error(profileError.message);

      await upsertRole(admin, userId, payload.role, payload.company_id || null, payload.branch_id || null);

      await safeAudit(admin, authData.user.id, "invited_user", "user", userId, payload.company_id || null, null, {
        email,
        role: payload.role,
        branch_id: payload.branch_id || null,
      });
      return NextResponse.json({ message: "User invitation sent" });
    }

    if (payload.action === "update_user_profile") {
      if (!payload.user_id || !payload.full_name?.trim()) return jsonError("User and full name are required.");
      await ensureCanManageUser(admin, requesterIsPrimarySuper, payload.user_id, payload.role);
      const { data: before } = await admin.from("users").select("id,full_name,email,company_id,branch_id").eq("id", payload.user_id).maybeSingle();
      const { error } = await admin.from("users").update({
        full_name: payload.full_name.trim(),
        company_id: payload.company_id || null,
        branch_id: payload.branch_id || null,
        updated_at: new Date().toISOString(),
      }).eq("id", payload.user_id);
      if (error) throw new Error(error.message);
      await upsertRole(admin, payload.user_id, payload.role, payload.company_id || null, payload.branch_id || null);
      await safeAudit(admin, authData.user.id, "updated_user_profile", "user", payload.user_id, payload.company_id || null, before ?? null, {
        full_name: payload.full_name.trim(),
        role: payload.role,
        company_id: payload.company_id || null,
        branch_id: payload.branch_id || null,
      });
      return NextResponse.json({ message: "User profile updated" });
    }

    if (payload.action === "set_user_status") {
      if (!payload.user_id) return jsonError("User is required.");
      await ensureCanManageUser(admin, requesterIsPrimarySuper, payload.user_id);
      const nextStatus = payload.status;
      const reason = nextStatus === "suspended" ? "user_suspended" : nextStatus === "blocked" ? "user_blocked" : "user_suspended";
      const affected = nextStatus === "active" ? { affected: 0 } : await handleAllocatedWork(admin, authData.user.id, payload.user_id, payload.work_handling, reason);
      const { data: before } = await admin.from("users").select("id,full_name,email,account_status,is_active").eq("id", payload.user_id).maybeSingle();
      const { error } = await admin.from("users").update({
        account_status: nextStatus,
        is_active: statusToActive(nextStatus),
        updated_at: new Date().toISOString(),
      }).eq("id", payload.user_id);
      if (error) throw new Error(error.message);
      await admin.auth.admin.updateUserById(payload.user_id, {
        ban_duration: nextStatus === "active" ? "none" : "876000h",
      });
      await safeAudit(admin, authData.user.id, "changed_user_status", "user", payload.user_id, null, before ?? null, {
        account_status: nextStatus,
        active_allocations_handled: affected.affected,
      });
      return NextResponse.json({ message: `User ${nextStatus === "active" ? "reactivated" : nextStatus}` });
    }

    if (payload.action === "delete_user") {
      if (!payload.user_id) return jsonError("User is required.");
      await ensureCanManageUser(admin, requesterIsPrimarySuper, payload.user_id);
      const affected = await handleAllocatedWork(admin, authData.user.id, payload.user_id, payload.work_handling, "user_deleted");
      const { data: before } = await admin.from("users").select("id,full_name,email,account_status,is_active").eq("id", payload.user_id).maybeSingle();
      const { error } = await admin.from("users").update({
        account_status: "deleted",
        is_active: false,
        updated_at: new Date().toISOString(),
      }).eq("id", payload.user_id);
      if (error) throw new Error(error.message);
      await admin.auth.admin.updateUserById(payload.user_id, { ban_duration: "876000h" });
      await safeAudit(admin, authData.user.id, "soft_deleted_user", "user", payload.user_id, null, before ?? null, {
        account_status: "deleted",
        active_allocations_handled: affected.affected,
      });
      return NextResponse.json({ message: "User deleted safely. Allocated work was not lost." });
    }

    if (payload.action === "send_password_reset") {
      const email = payload.email ? normalizeEmail(payload.email) : "";
      let resetEmail = email;
      if (!resetEmail && payload.user_id) {
        await ensureCanManageUser(admin, requesterIsPrimarySuper, payload.user_id);
        const { data: target, error } = await admin.from("users").select("email").eq("id", payload.user_id).maybeSingle();
        if (error) throw new Error(error.message);
        resetEmail = target?.email ?? "";
      }
      if (!resetEmail) return jsonError("Email is required.");
      const { error } = await admin.auth.resetPasswordForEmail(resetEmail, { redirectTo: `${request.nextUrl.origin}/auth/confirm` });
      if (error) throw new Error(error.message);
      await safeAudit(admin, authData.user.id, "sent_password_reset", "user", payload.user_id ?? null, null, null, { email: resetEmail });
      return NextResponse.json({ message: "Password reset email sent" });
    }

    if (payload.action === "change_user_email") {
      if (!payload.user_id || !payload.email?.trim()) return jsonError("User and email are required.");
      await ensureCanManageUser(admin, requesterIsPrimarySuper, payload.user_id);
      const email = normalizeEmail(payload.email);
      const { data: before } = await admin.from("users").select("id,email").eq("id", payload.user_id).maybeSingle();
      const authResult = await admin.auth.admin.updateUserById(payload.user_id, { email });
      if (authResult.error) throw new Error(authResult.error.message);
      const { error } = await admin.from("users").update({ email, updated_at: new Date().toISOString() }).eq("id", payload.user_id);
      if (error) throw new Error(error.message);
      await safeAudit(admin, authData.user.id, "changed_user_email", "user", payload.user_id, null, before ?? null, { email });
      return NextResponse.json({ message: "User email updated" });
    }

    if (payload.action === "import_medical_aids") {
      const result = await upsertMedicalAidRows(admin, authData.user.id, payload);
      return NextResponse.json(result);
    }

    if (payload.action === "recall_uploaded_list") {
      if (!requesterIsPrimarySuper) return jsonError("Only the primary Super User can recall or withdraw uploaded lists.", 403);
      if (!payload.uploaded_file_id) return jsonError("Uploaded list is required.");
      if (!payload.reason?.trim() || payload.reason.trim().length < 8) return jsonError("Please provide a clear recall reason.");
      await verifyPrimarySuperPassword(supabaseUrl, anonKey, requester.profile?.email ?? authData.user.email, payload.password);
      const { data, error } = await admin.rpc("recall_uploaded_list", {
        p_uploaded_file_id: payload.uploaded_file_id,
        p_actor_id: authData.user.id,
        p_reason: payload.reason.trim(),
      });
      if (error) throw new Error(error.message);
      return NextResponse.json({ message: "Uploaded list recalled safely", result: data });
    }

    return jsonError("Unknown setup action.");
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to complete setup action.", 500);
  }
}
