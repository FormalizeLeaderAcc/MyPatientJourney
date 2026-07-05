import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type SetupPayload =
  | { action: "create_company"; name: string; registration_number?: string | null }
  | { action: "create_branch"; company_id: string; name: string; practice_phone?: string | null }
  | { action: "invite_user"; full_name: string; email: string; role: "manager" | "employee"; company_id?: string | null; branch_id?: string | null };

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: roleRows, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", authData.user.id);
  if (roleError) return jsonError(roleError.message, 500);
  if (!roleRows?.some((row) => row.role === "super_user")) return jsonError("Only Super Users can perform setup actions.", 403);

  const payload = await request.json() as SetupPayload;

  if (payload.action === "create_company") {
    if (!payload.name?.trim()) return jsonError("Company name is required.");
    const { error } = await admin.from("companies").insert({
      name: payload.name.trim(),
      registration_number: payload.registration_number || null,
    });
    if (error) return jsonError(error.message, 500);
    await admin.from("audit_logs").insert({ actor_id: authData.user.id, entity_type: "company", action: "created_company", after_data: { name: payload.name } });
    return NextResponse.json({ message: "Company created" });
  }

  if (payload.action === "create_branch") {
    if (!payload.company_id || !payload.name?.trim()) return jsonError("Company and branch name are required.");
    const { error } = await admin.from("branches").insert({
      company_id: payload.company_id,
      name: payload.name.trim(),
      practice_phone: payload.practice_phone || null,
    });
    if (error) return jsonError(error.message, 500);
    await admin.from("audit_logs").insert({ company_id: payload.company_id, actor_id: authData.user.id, entity_type: "branch", action: "created_branch", after_data: { name: payload.name } });
    return NextResponse.json({ message: "Branch created" });
  }

  if (payload.action === "invite_user") {
    if (!payload.full_name?.trim() || !payload.email?.trim()) return jsonError("Full name and email are required.");
    const normalizedRole = payload.role === "manager" ? "manager" : "employee";
    const email = payload.email.trim().toLowerCase();
    let userId: string | undefined;

    const { data: existingProfile } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    userId = existingProfile?.id;

    if (!userId) {
      const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: payload.full_name.trim(), role: normalizedRole },
        redirectTo: `${request.nextUrl.origin}/auth/confirm`,
      });
      if (inviteError) return jsonError(inviteError.message, 500);
      userId = inviteData.user?.id;
    }

    if (!userId) return jsonError("Unable to create or locate invited user.", 500);

    const { error: profileError } = await admin.from("users").upsert({
      id: userId,
      full_name: payload.full_name.trim(),
      email,
      company_id: payload.company_id || null,
      branch_id: payload.branch_id || null,
      is_active: true,
    });
    if (profileError) return jsonError(profileError.message, 500);

    const { error: roleInsertError } = await admin.from("user_roles").upsert({
      user_id: userId,
      role: normalizedRole,
      company_id: payload.company_id || null,
      branch_id: payload.branch_id || null,
    });
    if (roleInsertError) return jsonError(roleInsertError.message, 500);

    await admin.from("audit_logs").insert({
      company_id: payload.company_id || null,
      actor_id: authData.user.id,
      entity_type: "user",
      entity_id: userId,
      action: "invited_user",
      after_data: { email, role: normalizedRole, branch_id: payload.branch_id || null },
    });
    return NextResponse.json({ message: "User invitation sent" });
  }

  return jsonError("Unknown setup action.");
}
