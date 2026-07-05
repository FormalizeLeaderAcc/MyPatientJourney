import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type AppRole = "super_user" | "sub_super_user" | "manager" | "employee";
type RoleRow = { role: AppRole; company_id: string | null; branch_id: string | null };
type AdminClient = ReturnType<typeof createClient<any, "public", any>>;
type LeadRow = { id: string; company_id: string; branch_id: string | null; patient_id: string; status: string };

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function getContext(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Supabase public environment variables are not configured.");
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for booking verification.");

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
  if (authError || !authData.user) throw new Error("You must be signed in to verify bookings.");
  const admin = createClient<any, "public", any>(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: roles, error: roleError } = await admin.from("user_roles").select("role,company_id,branch_id").eq("user_id", authData.user.id);
  if (roleError) throw new Error(roleError.message);
  const roleRows = (roles ?? []) as RoleRow[];
  const canVerify = roleRows.some((row) => row.role === "super_user" || row.role === "sub_super_user" || row.role === "manager");
  if (!canVerify) throw new Error("Only Super Users, Sub Super Users and Managers can verify bookings.");
  return { admin, actorId: authData.user.id, roles: roleRows };
}

function canSeeLead(lead: LeadRow, roles: RoleRow[]) {
  if (roles.some((row) => row.role === "super_user" || row.role === "sub_super_user")) return true;
  return roles.some((row) => row.role === "manager" && row.company_id === lead.company_id && (!row.branch_id || row.branch_id === lead.branch_id));
}

async function audit(admin: AdminClient, actorId: string, lead: LeadRow, bookingId: string, action: string, afterData: unknown) {
  await admin.from("audit_logs").insert({
    company_id: lead.company_id,
    actor_id: actorId,
    entity_type: "booking_record",
    entity_id: bookingId,
    action,
    after_data: afterData,
  });
}

export async function GET(request: NextRequest) {
  try {
    const { admin, roles } = await getContext(request);
    const { data: bookingRows, error: bookingError } = await admin
      .from("booking_records")
      .select("id,lead_id,recorded_by,preferred_date,preferred_time,confidence,notes,recorded_at")
      .order("recorded_at", { ascending: true })
      .limit(250);
    if (bookingError) throw new Error(bookingError.message);
    const bookings = bookingRows ?? [];
    if (!bookings.length) return NextResponse.json({ bookings: [] });

    const bookingIds = bookings.map((booking: { id: string }) => booking.id);
    const leadIds = Array.from(new Set(bookings.map((booking: { lead_id: string }) => booking.lead_id)));
    const userIds = Array.from(new Set(bookings.map((booking: { recorded_by: string }) => booking.recorded_by)));

    const [leadResult, verificationResult, userResult] = await Promise.all([
      admin.from("leads").select("id,company_id,branch_id,patient_id,status").in("id", leadIds),
      admin.from("booking_verifications").select("booking_record_id").in("booking_record_id", bookingIds),
      admin.from("users").select("id,full_name,email").in("id", userIds),
    ]);
    if (leadResult.error) throw new Error(leadResult.error.message);
    if (verificationResult.error) throw new Error(verificationResult.error.message);
    if (userResult.error) throw new Error(userResult.error.message);

    const leads = (leadResult.data ?? []) as LeadRow[];
    const visibleLeads = leads.filter((lead) => canSeeLead(lead, roles));
    const leadById = new Map(visibleLeads.map((lead) => [lead.id, lead]));
    const verifiedBookingIds = new Set((verificationResult.data ?? []).map((row: { booking_record_id: string }) => row.booking_record_id));
    const patientIds = Array.from(new Set(visibleLeads.map((lead) => lead.patient_id)));
    const { data: patients, error: patientError } = patientIds.length
      ? await admin.from("patients").select("id,full_name,account_number").in("id", patientIds)
      : { data: [], error: null };
    if (patientError) throw new Error(patientError.message);
    const patientById = new Map((patients ?? []).map((patient: { id: string }) => [patient.id, patient]));
    const userById = new Map((userResult.data ?? []).map((user: { id: string }) => [user.id, user]));

    const pending = bookings
      .filter((booking: { id: string; lead_id: string }) => !verifiedBookingIds.has(booking.id) && leadById.has(booking.lead_id))
      .map((booking: { id: string; lead_id: string; recorded_by: string; preferred_date: string; preferred_time: string; confidence: string; notes: string | null; recorded_at: string }) => {
        const lead = leadById.get(booking.lead_id) as LeadRow;
        const patient = patientById.get(lead.patient_id) as { full_name?: string; account_number?: string } | undefined;
        const recorder = userById.get(booking.recorded_by) as { full_name?: string; email?: string } | undefined;
        return {
          id: booking.id,
          lead_id: booking.lead_id,
          patient: patient?.full_name ?? "Unknown patient",
          account: patient?.account_number ?? "No account",
          recorded_by: recorder?.full_name ?? recorder?.email ?? "Unknown user",
          preferred_date: booking.preferred_date,
          preferred_time: booking.preferred_time,
          confidence: booking.confidence,
          notes: booking.notes,
          recorded_at: booking.recorded_at,
        };
      });

    return NextResponse.json({ bookings: pending });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to load booking records.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as { booking_record_id?: string; verification_status?: "found" | "not_found" | "date_changed" | "cancelled" | "needs_follow_up"; verification_notes?: string; verified_date?: string };
    if (!payload.booking_record_id) return jsonError("Booking record is required.");
    if (!payload.verification_status) return jsonError("Verification status is required.");
    const { admin, actorId, roles } = await getContext(request);

    const { data: booking, error: bookingError } = await admin
      .from("booking_records")
      .select("id,lead_id")
      .eq("id", payload.booking_record_id)
      .maybeSingle();
    if (bookingError) throw new Error(bookingError.message);
    if (!booking) return jsonError("Booking record not found.", 404);

    const { data: lead, error: leadError } = await admin
      .from("leads")
      .select("id,company_id,branch_id,patient_id,status")
      .eq("id", booking.lead_id)
      .maybeSingle();
    if (leadError) throw new Error(leadError.message);
    if (!lead) return jsonError("Lead not found.", 404);
    if (!canSeeLead(lead as LeadRow, roles)) return jsonError("You cannot verify a booking outside your assigned scope.", 403);

    const { error: verificationError } = await admin.from("booking_verifications").insert({
      booking_record_id: payload.booking_record_id,
      verified_by: actorId,
      verification_status: payload.verification_status,
      verification_notes: payload.verification_notes ?? null,
      verified_date: payload.verified_date || new Date().toISOString().slice(0, 10),
    });
    if (verificationError) throw new Error(verificationError.message);

    const nextStatus = payload.verification_status === "found" ? "patient_booked_and_verified" : "manager_review";
    const { error: updateError } = await admin.from("leads").update({
      status: nextStatus,
      final_outcome_at: nextStatus === "patient_booked_and_verified" ? new Date().toISOString() : null,
      next_action_at: nextStatus === "manager_review" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", booking.lead_id);
    if (updateError) throw new Error(updateError.message);

    await audit(admin, actorId, lead as LeadRow, payload.booking_record_id, "verified_booking", payload);
    return NextResponse.json({ message: payload.verification_status === "found" ? "Booking verified on practice calendar." : "Booking verification recorded for manager review.", status: nextStatus });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to save booking verification.", 500);
  }
}
