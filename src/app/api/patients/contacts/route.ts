import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type ContactPayload = {
  patient_id: string;
  contact_id?: string | null;
  contact_type: "mobile" | "alternate" | "whatsapp" | "email";
  value: string;
  is_primary?: boolean;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);
  if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required for audited contact updates.", 500);

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
  if (authError || !authData.user) return jsonError("You must be signed in to update patient contact details.", 401);

  const payload = await request.json() as ContactPayload;
  if (!payload.patient_id || !payload.contact_type || !payload.value?.trim()) return jsonError("Patient, contact type and value are required.");

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: patient, error: patientError } = await admin.from("patients").select("id,company_id").eq("id", payload.patient_id).maybeSingle();
  if (patientError) return jsonError(patientError.message, 500);
  if (!patient) return jsonError("Patient not found.", 404);

  const { data: roles, error: roleError } = await admin.from("user_roles").select("role,company_id").eq("user_id", authData.user.id);
  if (roleError) return jsonError(roleError.message, 500);
  const canEdit = (roles ?? []).some((row) => ["super_user", "sub_super_user"].includes(String(row.role)) || row.company_id === patient.company_id);
  if (!canEdit) return jsonError("You do not have permission to edit this patient's contact details.", 403);

  const contactData = {
    patient_id: payload.patient_id,
    contact_type: payload.contact_type,
    value: payload.value.trim(),
    is_primary: Boolean(payload.is_primary),
    updated_by: authData.user.id,
    updated_at: new Date().toISOString(),
  };

  const result = payload.contact_id
    ? await admin.from("patient_contacts").update(contactData).eq("id", payload.contact_id).select("id").single()
    : await admin.from("patient_contacts").insert(contactData).select("id").single();
  if (result.error) return jsonError(result.error.message, 500);

  await admin.from("audit_logs").insert({
    company_id: patient.company_id,
    actor_id: authData.user.id,
    entity_type: "patient_contact",
    entity_id: result.data.id,
    action: payload.contact_id ? "updated_patient_contact" : "created_patient_contact",
    after_data: contactData,
  });

  return NextResponse.json({ message: "Patient contact details updated", contact_id: result.data.id });
}
