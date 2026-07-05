import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Lead, LeadStatus, Priority } from "@/lib/types";

type DbRole = "super_user" | "sub_super_user" | "manager" | "employee";
type RoleRow = { role: DbRole; company_id: string | null; branch_id: string | null };
type PatientRow = {
  id: string;
  full_name: string;
  account_number: string;
  medical_aid_scheme: string | null;
  medical_aid_option: string | null;
};
type BranchRow = { id: string; name: string } | null;
type LeadRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  patient_id: string;
  source_import_batch_id: string;
  status: string;
  priority_label: string;
  recall_reason: string;
  last_visit_date: string | null;
  last_8101_date: string | null;
  last_8159_date: string | null;
  next_action_at: string | null;
  unsuccessful_attempt_days: number | null;
  integration_refs: Record<string, unknown> | null;
  patients: PatientRow | PatientRow[] | null;
  branches: BranchRow | BranchRow[] | null;
};
type ContactRow = {
  patient_id: string;
  contact_type: "mobile" | "alternate" | "whatsapp" | "email";
  value: string;
  is_primary: boolean;
};
type AssignmentRow = { lead_id: string; employee_id: string };
type UserRow = { id: string; full_name: string; email: string };
type AttemptRow = { lead_id: string; attempted_at: string };

const dbToUiStatus: Record<string, LeadStatus> = {
  new: "New",
  allocated: "Allocated",
  call_attempted: "Call Attempted",
  no_answer: "No Answer",
  whatsapp_sent: "WhatsApp Sent",
  call_back_later: "Call Back Later",
  waiting_for_patient_response: "Waiting for Patient Response",
  callback_due: "Callback Due",
  booking_recorded_pending_verification: "Booking Recorded Pending Verification",
  manager_review: "Manager Review",
  patient_booked_and_verified: "Patient Booked and Verified",
  patient_not_interested: "Patient Not Interested",
  wrong_number_confirmed: "Wrong Number Confirmed",
};

const knownPriorities = new Set<Priority>([
  "Premium Recall Opportunity",
  "High Medical Aid Opportunity",
  "Standard Six-Month Recall",
  "Dormant Patient",
  "Missing Data Review",
  "No Recent 8159",
  "No Recent 8101 or 8159",
]);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function initialsFrom(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "MP";
}

function firstRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function displayDate(value: string | null | undefined) {
  if (!value) return "Not supplied";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
}

function nextActionLabel(value: string | null | undefined, status: LeadStatus) {
  if (status === "New") return "Ready to allocate";
  if (!value) return "Next action not scheduled";
  const today = new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = date.toISOString().slice(0, 10);
  if (day < today) return "Overdue";
  if (day === today) return "Due today";
  return day;
}

function contactFor(contacts: ContactRow[], type: ContactRow["contact_type"], primaryOnly = false) {
  const scoped = contacts.filter((contact) => contact.contact_type === type);
  return (primaryOnly ? scoped.find((contact) => contact.is_primary) : scoped[0])?.value ?? "";
}

function contactDay(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);
  if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required to load live leads.", 500);

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
  if (authError || !authData.user) return jsonError("You must be signed in to view live leads.", 401);

  const admin = createClient<any, "public", any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: roleRows, error: roleError } = await admin
    .from("user_roles")
    .select("role,company_id,branch_id")
    .eq("user_id", authData.user.id);
  if (roleError) return jsonError(roleError.message, 500);

  const roles = (roleRows ?? []) as RoleRow[];
  const isSuper = roles.some((row) => row.role === "super_user" || row.role === "sub_super_user");
  const isManager = roles.some((row) => row.role === "manager");
  const isEmployee = roles.some((row) => row.role === "employee");

  let query = admin
    .from("leads")
    .select(`
      id, company_id, branch_id, patient_id, source_import_batch_id, status,
      priority_label, recall_reason, last_visit_date, last_8101_date, last_8159_date,
      next_action_at, unsuccessful_attempt_days, integration_refs,
      patients(id, full_name, account_number, medical_aid_scheme, medical_aid_option),
      branches(id, name)
    `)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (!isSuper) {
    if (isManager) {
      const branchIds = roles.filter((row) => row.role === "manager" && row.branch_id).map((row) => row.branch_id as string);
      const companyIds = roles.filter((row) => row.role === "manager" && row.company_id).map((row) => row.company_id as string);
      if (branchIds.length) query = query.in("branch_id", branchIds);
      else if (companyIds.length) query = query.in("company_id", companyIds);
      else return NextResponse.json({ leads: [] });
    } else if (isEmployee) {
      const { data: assignments, error: assignmentError } = await admin
        .from("lead_assignments")
        .select("lead_id")
        .eq("employee_id", authData.user.id)
        .is("ended_at", null);
      if (assignmentError) return jsonError(assignmentError.message, 500);
      const leadIds = (assignments ?? []).map((assignment: { lead_id: string }) => assignment.lead_id);
      if (!leadIds.length) return NextResponse.json({ leads: [] });
      query = query.in("id", leadIds);
    } else {
      return jsonError("Your account does not have permission to view leads.", 403);
    }
  }

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);
  const leadRows = (data ?? []) as LeadRow[];
  const patientIds = Array.from(new Set(leadRows.map((lead) => lead.patient_id).filter(Boolean)));
  const leadIds = leadRows.map((lead) => lead.id);

  const [contactResult, assignmentResult, attemptResult] = await Promise.all([
    patientIds.length
      ? admin.from("patient_contacts").select("patient_id,contact_type,value,is_primary").in("patient_id", patientIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length
      ? admin.from("lead_assignments").select("lead_id,employee_id").in("lead_id", leadIds).is("ended_at", null)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length
      ? admin.from("lead_attempts").select("lead_id,attempted_at").in("lead_id", leadIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (contactResult.error) return jsonError(contactResult.error.message, 500);
  if (assignmentResult.error) return jsonError(assignmentResult.error.message, 500);
  if (attemptResult.error) return jsonError(attemptResult.error.message, 500);

  const assignments = (assignmentResult.data ?? []) as AssignmentRow[];
  const employeeIds = Array.from(new Set(assignments.map((assignment) => assignment.employee_id)));
  const usersById = new Map<string, UserRow>();
  if (employeeIds.length) {
    const { data: employees, error: employeeError } = await admin
      .from("users")
      .select("id,full_name,email")
      .in("id", employeeIds);
    if (employeeError) return jsonError(employeeError.message, 500);
    ((employees ?? []) as UserRow[]).forEach((user) => usersById.set(user.id, user));
  }

  const contactsByPatient = new Map<string, ContactRow[]>();
  ((contactResult.data ?? []) as ContactRow[]).forEach((contact) => {
    contactsByPatient.set(contact.patient_id, [...(contactsByPatient.get(contact.patient_id) ?? []), contact]);
  });
  const assignmentByLead = new Map(assignments.map((assignment) => [assignment.lead_id, assignment]));
  const attemptsByLead = new Map<string, AttemptRow[]>();
  ((attemptResult.data ?? []) as AttemptRow[]).forEach((attempt) => {
    attemptsByLead.set(attempt.lead_id, [...(attemptsByLead.get(attempt.lead_id) ?? []), attempt]);
  });

  const leads: Lead[] = leadRows.map((lead) => {
    const patient = firstRow(lead.patients);
    const branch = firstRow(lead.branches);
    const contacts = contactsByPatient.get(lead.patient_id) ?? [];
    const assignment = assignmentByLead.get(lead.id);
    const assignee = assignment ? usersById.get(assignment.employee_id) : null;
    const attempts = attemptsByLead.get(lead.id) ?? [];
    const status = dbToUiStatus[lead.status] ?? "New";
    const priority = knownPriorities.has(lead.priority_label as Priority)
      ? lead.priority_label as Priority
      : "Standard Six-Month Recall";
    const refs = lead.integration_refs ?? {};
    const phone = contactFor(contacts, "mobile", true) || contactFor(contacts, "mobile") || String(refs.mobile_number ?? "");

    return {
      id: lead.id,
      companyId: lead.company_id,
      branchId: lead.branch_id,
      patientId: lead.patient_id,
      patient: patient?.full_name ?? "Unknown patient",
      initials: initialsFrom(patient?.full_name ?? "Unknown patient"),
      account: patient?.account_number ?? "No account",
      phone,
      alternatePhone: contactFor(contacts, "alternate") || String(refs.alternative_number ?? "") || null,
      whatsapp: contactFor(contacts, "whatsapp") || phone || null,
      email: contactFor(contacts, "email") || null,
      branch: branch?.name ?? "Company-wide",
      medicalAid: patient?.medical_aid_scheme || "Not supplied",
      option: patient?.medical_aid_option || "Not supplied",
      priority,
      lastVisit: displayDate(lead.last_visit_date),
      last8101: displayDate(lead.last_8101_date),
      last8159: displayDate(lead.last_8159_date),
      reason: lead.recall_reason,
      attempts: attempts.length,
      attemptDays: Math.max(lead.unsuccessful_attempt_days ?? 0, new Set(attempts.map((attempt) => contactDay(attempt.attempted_at))).size),
      nextAction: nextActionLabel(lead.next_action_at, status),
      latestOutcome: status === "New" ? "Not contacted yet" : status,
      status,
      assignedTo: assignee?.full_name ?? "Unallocated",
      doctor: String(refs.practitioner ?? "Practice"),
      amount: typeof refs.last_visit_total_amount_charged === "number" ? refs.last_visit_total_amount_charged : 0,
      sourceBatch: lead.source_import_batch_id,
    };
  });

  return NextResponse.json({ leads });
}
