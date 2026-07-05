import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type AccountPayload =
  | { action: "update_profile"; full_name: string; avatar_url?: string | null; preferences?: Record<string, unknown> }
  | { action: "change_password"; password: string }
  | { action: "activate_invited_user" };

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);

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
  if (authError || !authData.user) return jsonError("You must be signed in to update your account.", 401);

  const payload = await request.json() as AccountPayload;

  if (payload.action === "activate_invited_user") {
    if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required to activate invited accounts.", 500);
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: before, error: beforeError } = await admin
      .from("users")
      .select("id,email,full_name,account_status,is_active")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (beforeError) return jsonError(beforeError.message, 500);
    if (!before) return jsonError("Your app profile could not be found. Please contact Formalize Admin.", 404);

    if (before.account_status !== "invited" && before.is_active === true) {
      return NextResponse.json({ message: "Account already active", profile: before });
    }

    const nextProfile = {
      account_status: "active",
      is_active: true,
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from("users").update(nextProfile).eq("id", authData.user.id);
    if (error) return jsonError(error.message, 500);

    await admin.from("audit_logs").insert({
      actor_id: authData.user.id,
      entity_type: "user",
      entity_id: authData.user.id,
      action: "activated_invited_account",
      before_data: before,
      after_data: nextProfile,
    });
    return NextResponse.json({ message: "Account activated", profile: { ...before, ...nextProfile } });
  }

  if (payload.action === "change_password") {
    if (!payload.password || payload.password.length < 8) return jsonError("Password must be at least 8 characters.");
    const { error } = await userClient.auth.updateUser({ password: payload.password });
    if (error) return jsonError(error.message, 500);
    return NextResponse.json({ message: "Password updated" });
  }

  if (payload.action === "update_profile") {
    if (!payload.full_name?.trim()) return jsonError("Full name is required.");
    if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required to update profile settings.", 500);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const nextProfile = {
      full_name: payload.full_name.trim(),
      avatar_url: payload.avatar_url || null,
      preferences: payload.preferences ?? {},
      updated_at: new Date().toISOString(),
    };

    const { data: before } = await admin
      .from("users")
      .select("full_name,avatar_url,preferences")
      .eq("id", authData.user.id)
      .maybeSingle();
    const { error } = await admin.from("users").update(nextProfile).eq("id", authData.user.id);
    if (error) return jsonError(error.message, 500);

    await admin.auth.admin.updateUserById(authData.user.id, {
      user_metadata: {
        ...authData.user.user_metadata,
        full_name: nextProfile.full_name,
        avatar_url: nextProfile.avatar_url,
      },
    });
    await admin.from("audit_logs").insert({
      actor_id: authData.user.id,
      entity_type: "user",
      entity_id: authData.user.id,
      action: "updated_own_account_settings",
      before_data: before ?? null,
      after_data: nextProfile,
    });
    return NextResponse.json({ message: "Account settings updated", profile: nextProfile });
  }

  return jsonError("Unknown account action.");
}
