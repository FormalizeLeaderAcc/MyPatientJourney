import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type CommunicationPayload = {
  company_id: string;
  branch_id?: string | null;
  patient_id: string;
  lead_id?: string | null;
  channel: "phone" | "whatsapp_call" | "whatsapp_message" | "email" | "callback" | "booking" | "other";
  direction?: "outbound" | "inbound" | "internal";
  subject?: string | null;
  body?: string | null;
  outcome?: string | null;
  metadata?: Record<string, unknown>;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);
  if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required for audited communication history.", 500);

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
  if (authError || !authData.user) return jsonError("You must be signed in to record communication.", 401);

  const payload = await request.json() as CommunicationPayload;
  if (!payload.company_id || !payload.patient_id || !payload.channel) return jsonError("Company, patient and communication channel are required.");

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: roles, error: roleError } = await admin.from("user_roles").select("role,company_id").eq("user_id", authData.user.id);
  if (roleError) return jsonError(roleError.message, 500);
  const canRecord = (roles ?? []).some((row) => ["super_user", "sub_super_user"].includes(String(row.role)) || row.company_id === payload.company_id);
  if (!canRecord) return jsonError("You do not have permission to record communication for this company.", 403);

  const { error } = await admin.from("communication_events").insert({
    company_id: payload.company_id,
    branch_id: payload.branch_id ?? null,
    patient_id: payload.patient_id,
    lead_id: payload.lead_id ?? null,
    actor_id: authData.user.id,
    channel: payload.channel,
    direction: payload.direction ?? "outbound",
    subject: payload.subject ?? null,
    body: payload.body ?? null,
    outcome: payload.outcome ?? null,
    metadata: payload.metadata ?? {},
  });
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ message: "Communication recorded" });
}
