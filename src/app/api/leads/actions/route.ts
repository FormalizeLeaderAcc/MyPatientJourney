import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type AppRole = "super_user" | "sub_super_user" | "manager" | "employee";
type RoleRow = { role: AppRole; company_id: string | null; branch_id: string | null };
type LeadRow = { id: string; company_id: string; branch_id: string | null; status: string; patient_id: string };
type AdminClient = ReturnType<typeof createClient<any, "public", any>>;

type LeadActionPayload = {
  lead_id?: string;
  action?: "call_outcome" | "no_answer" | "whatsapp_sent" | "email_sent" | "callback_scheduled" | "booking_recorded" | "final_outcome" | "manager_review" | "manager_instruction";
  outcome?: string;
  notes?: string;
  phone_used?: string;
  whatsapp_number?: string;
  template_key?: string;
  callback_date?: string;
  callback_time_range?: string;
  callback_reason?: string;
  next_follow_up_date?: string;
  preferred_date?: string;
  preferred_time?: string;
  confidence?: "confirmed_with_patient" | "requested_availability" | "tentative";
  final_status?: "patient_not_interested" | "wrong_number_confirmed" | "patient_moved_away" | "patient_deceased" | "duplicate" | "manager_closed";
  reason?: string;
};

const unsuccessfulCodes = new Set(["no_answer", "whatsapp_sent", "call_back_later", "voicemail", "unreachable"]);
const activeStatuses = new Set([
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
]);

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function dateToIso(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function getContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Supabase public environment variables are not configured.");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for patient journey actions.");

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
  if (authError || !authData.user) throw new Error("You must be signed in to record patient journey actions.");

  const admin = createClient<any, "public", any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: roles, error: roleError } = await admin
    .from("user_roles")
    .select("role,company_id,branch_id")
    .eq("user_id", authData.user.id);
  if (roleError) throw new Error(roleError.message);
  return { admin, actorId: authData.user.id, roles: (roles ?? []) as RoleRow[] };
}

function canActOnLead(lead: LeadRow, roles: RoleRow[], actorId: string, activeAssignment: { employee_id: string } | null) {
  if (roles.some((row) => row.role === "super_user" || row.role === "sub_super_user")) return true;
  if (roles.some((row) => row.role === "manager" && row.company_id === lead.company_id && (!row.branch_id || row.branch_id === lead.branch_id))) return true;
  return Boolean(activeAssignment?.employee_id === actorId);
}

function hasManagerAuthority(roles: RoleRow[], lead: LeadRow) {
  if (roles.some((row) => row.role === "super_user" || row.role === "sub_super_user")) return true;
  return roles.some((row) => row.role === "manager" && row.company_id === lead.company_id && (!row.branch_id || row.branch_id === lead.branch_id));
}

async function ensureOutcome(admin: AdminClient, code: string, label: string) {
  const { data: existing, error: existingError } = await admin
    .from("lead_outcomes")
    .select("id")
    .eq("code", code)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing?.id) return existing.id as string;

  const { data, error } = await admin
    .from("lead_outcomes")
    .insert({
      code,
      label,
      is_final: ["patient_not_interested", "wrong_number_confirmed", "patient_moved_away", "patient_deceased", "duplicate", "manager_closed"].includes(code),
      counts_as_unsuccessful_attempt: unsuccessfulCodes.has(code),
      employee_selectable: true,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function unsuccessfulDayCount(admin: AdminClient, leadId: string) {
  const { data, error } = await admin
    .from("lead_attempts")
    .select("contact_day,lead_outcomes!inner(counts_as_unsuccessful_attempt)")
    .eq("lead_id", leadId)
    .eq("lead_outcomes.counts_as_unsuccessful_attempt", true);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row: { contact_day: string }) => row.contact_day)).size;
}

async function audit(admin: AdminClient, actorId: string, lead: LeadRow, action: string, beforeData: unknown, afterData: unknown) {
  await admin.from("audit_logs").insert({
    company_id: lead.company_id,
    actor_id: actorId,
    entity_type: "lead",
    entity_id: lead.id,
    action,
    before_data: beforeData ?? null,
    after_data: afterData ?? null,
  });
}

function actionConfig(payload: LeadActionPayload) {
  if (payload.action === "no_answer") return { code: "no_answer", label: "No answer", channel: "phone", status: "no_answer", nextActionAt: tomorrowIso() };
  if (payload.action === "whatsapp_sent") return { code: "whatsapp_sent", label: "WhatsApp sent", channel: "whatsapp_message", status: "whatsapp_sent", nextActionAt: dateToIso(payload.next_follow_up_date) };
  if (payload.action === "email_sent") return { code: "email_sent", label: "Email sent", channel: "email", status: "waiting_for_patient_response", nextActionAt: dateToIso(payload.next_follow_up_date) ?? tomorrowIso() };
  if (payload.action === "callback_scheduled") return { code: "call_back_later", label: "Call back later", channel: "phone", status: "call_back_later", nextActionAt: dateToIso(payload.callback_date) };
  if (payload.action === "manager_review") return { code: "manager_review", label: "Escalated to manager", channel: "other", status: "manager_review", nextActionAt: null };
  if (payload.action === "manager_instruction") return { code: "manager_instruction", label: "Manager instruction to employee", channel: "other", status: "allocated", nextActionAt: new Date().toISOString() };
  if (payload.action === "final_outcome") return { code: payload.final_status ?? "manager_closed", label: (payload.reason || payload.final_status || "Final outcome").replace(/_/g, " "), channel: "other", status: payload.final_status ?? "manager_closed", nextActionAt: null };
  const normalized = String(payload.outcome || "call_attempted").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (normalized === "no_answer") return { code: "no_answer", label: "No answer", channel: "phone", status: "no_answer", nextActionAt: tomorrowIso() };
  if (normalized === "voicemail") return { code: "voicemail", label: "Voicemail", channel: "phone", status: "call_attempted", nextActionAt: tomorrowIso() };
  return { code: normalized || "call_attempted", label: payload.outcome || "Call attempted", channel: "phone", status: "call_attempted", nextActionAt: tomorrowIso() };
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as LeadActionPayload;
    if (!payload.lead_id) return jsonError("Lead is required.");
    if (!payload.action) return jsonError("Lead action is required.");

    const { admin, actorId, roles } = await getContext(request);
    const { data: lead, error: leadError } = await admin
      .from("leads")
      .select("id,company_id,branch_id,status,patient_id")
      .eq("id", payload.lead_id)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) return jsonError("Lead not found.", 404);

    const { data: activeAssignment, error: assignmentError } = await admin
      .from("lead_assignments")
      .select("employee_id")
      .eq("lead_id", payload.lead_id)
      .is("ended_at", null)
      .maybeSingle();
    if (assignmentError) throw new Error(assignmentError.message);
    if (!canActOnLead(lead as LeadRow, roles, actorId, activeAssignment as { employee_id: string } | null)) {
      return jsonError("You do not have permission to update this patient journey.", 403);
    }

    const leadRow = lead as LeadRow;
    if (!activeStatuses.has(leadRow.status) && payload.action !== "manager_review") {
      return jsonError("This patient journey already has a final outcome.", 409);
    }

    const beforeData = { status: leadRow.status };
    const now = new Date().toISOString();

    if (payload.action === "booking_recorded") {
      if (!payload.preferred_date) return jsonError("Preferred booking date is required.");
      if (!payload.preferred_time?.trim()) return jsonError("Preferred booking time is required.");
      const confidence = payload.confidence ?? "requested_availability";
      const { data: booking, error: bookingError } = await admin.from("booking_records").insert({
        lead_id: leadRow.id,
        recorded_by: actorId,
        preferred_date: payload.preferred_date,
        preferred_time: payload.preferred_time.trim(),
        confidence,
        notes: payload.notes ?? null,
      }).select("id").single();
      if (bookingError) throw new Error(bookingError.message);
      const { error: updateError } = await admin.from("leads").update({
        status: "booking_recorded_pending_verification",
        next_action_at: null,
        updated_at: now,
      }).eq("id", leadRow.id);
      if (updateError) throw new Error(updateError.message);
      await audit(admin, actorId, leadRow, "recorded_booking", beforeData, { booking_record_id: booking.id, ...payload });
      return NextResponse.json({ message: "Booking recorded and sent for manager verification.", status: "booking_recorded_pending_verification" });
    }

    if (payload.action === "callback_scheduled" && !payload.callback_date) {
      return jsonError("Callback date is required.");
    }
    if (payload.action === "whatsapp_sent" && !payload.whatsapp_number?.trim()) {
      return jsonError("WhatsApp number used is required.");
    }
    if (payload.action === "manager_review") {
      if (!payload.reason?.trim()) return jsonError("Escalation reason is required.");
      if (!payload.notes?.trim() || payload.notes.trim().length < 5) return jsonError("Escalation notes are required.");
    }
    if (payload.action === "manager_instruction") {
      if (!hasManagerAuthority(roles, leadRow)) return jsonError("Only a manager or super user can send manager instructions.", 403);
      if (leadRow.status !== "manager_review") return jsonError("Only journeys in Manager Review can be returned with manager instructions.");
      if (!payload.reason?.trim()) return jsonError("Manager instruction reason is required.");
      if (!payload.notes?.trim() || payload.notes.trim().length < 5) return jsonError("Manager instruction notes are required.");
    }
    if (payload.action === "final_outcome") {
      if (!payload.final_status) return jsonError("Final outcome status is required.");
      if (payload.final_status === "manager_closed" && !hasManagerAuthority(roles, leadRow)) return jsonError("Only a manager or super user can close a journey as Manager Closed.", 403);
      if (!payload.reason?.trim()) return jsonError("Final outcome reason is required.");
      if (!payload.notes?.trim() || payload.notes.trim().length < 5) return jsonError("Final outcome notes are required.");
    }

    const config = actionConfig(payload);
    const outcomeId = await ensureOutcome(admin, config.code, config.label);

    if (payload.action === "callback_scheduled") {
      const callbackAt = dateToIso(payload.callback_date);
      if (!callbackAt) return jsonError("Callback date is invalid.");
      const { error: callbackError } = await admin.from("callback_tasks").insert({
        lead_id: leadRow.id,
        assigned_to: activeAssignment?.employee_id ?? actorId,
        callback_at: callbackAt,
        time_range: payload.callback_time_range || null,
        reason: payload.callback_reason || payload.reason || "Patient requested callback",
        notes: payload.notes ?? null,
        created_by: actorId,
      });
      if (callbackError) throw new Error(callbackError.message);
    }

    const shouldCreateAttempt = payload.action !== "final_outcome" && payload.action !== "manager_review" && payload.action !== "manager_instruction";
    if (shouldCreateAttempt) {
      const { error: attemptError } = await admin.from("lead_attempts").insert({
        lead_id: leadRow.id,
        employee_id: actorId,
        outcome_id: outcomeId,
        channel: config.channel,
        phone_used: payload.phone_used || payload.whatsapp_number || null,
        template_key: payload.template_key || null,
        notes: payload.notes ?? null,
        metadata: payload,
      });
      if (attemptError) {
        if (String(attemptError.code) === "23505") return jsonError("This unsuccessful outcome has already been recorded for this patient today. Try again on a different calendar day.", 409);
        throw new Error(attemptError.message);
      }
    }

    const unsuccessfulDays = await unsuccessfulDayCount(admin, leadRow.id);
    const nextStatus = unsuccessfulDays >= 3 && unsuccessfulCodes.has(config.code) ? "manager_review" : config.status;
    const updatePayload: Record<string, unknown> = {
      status: nextStatus,
      updated_at: now,
      next_action_at: config.nextActionAt,
    };
    if (payload.action === "final_outcome") updatePayload.final_outcome_at = now;

    const { error: updateError } = await admin.from("leads").update(updatePayload).eq("id", leadRow.id);
    if (updateError) throw new Error(updateError.message);

    await audit(admin, actorId, leadRow, `lead_action_${payload.action}`, beforeData, {
      ...payload,
      outcome_code: config.code,
      status: nextStatus,
      unsuccessful_attempt_days: unsuccessfulDays,
    });

    return NextResponse.json({
      message: nextStatus === "manager_review" ? "Three unsuccessful contact days reached. Lead moved to Manager Review." : "Patient journey action recorded.",
      status: nextStatus,
      unsuccessful_attempt_days: unsuccessfulDays,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to record patient journey action.", 500);
  }
}
