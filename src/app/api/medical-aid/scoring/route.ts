import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { buildMedicalAidScoringIndex, matchMedicalAidOption, type MedicalAidMatch, type MedicalAidScoringIndex } from "@/lib/medical-aid-matching";

type Action = "preview" | "apply";
type AppRole = "super_user" | "sub_super_user" | "manager" | "employee";
type RoleRow = { role: AppRole; company_id: string | null; branch_id: string | null };
type AdminClient = ReturnType<typeof createClient<any, "public", any>>;
type AidScheme = { id: string; company_id: string | null; name: string; normalized_name: string };
type AidOption = { id: string; scheme_id: string; option_name: string; quality_score: number; category: string; notes: string | null; medical_aid_schemes: AidScheme | AidScheme[] | null };
type LeadRow = {
  id: string;
  company_id: string;
  branch_id: string | null;
  patient_id: string;
  status: string;
  priority_label: string;
  priority_score: number | null;
  integration_refs: Record<string, unknown> | null;
  patients: {
    id: string;
    full_name: string;
    account_number: string;
    medical_aid_scheme: string | null;
    medical_aid_option: string | null;
  } | Array<{
    id: string;
    full_name: string;
    account_number: string;
    medical_aid_scheme: string | null;
    medical_aid_option: string | null;
  }> | null;
};

const finalLeadStatuses = [
  "patient_booked_and_verified",
  "patient_not_interested",
  "wrong_number_confirmed",
  "patient_moved_away",
  "patient_deceased",
  "duplicate",
  "manager_closed",
];

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function firstRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function priorityFromScore(category: string, score: number) {
  if (category === "premium" || score >= 85) return "Premium Recall Opportunity";
  if (category === "high" || score >= 70) return "High Medical Aid Opportunity";
  return "Standard Six-Month Recall";
}

function priorityScore(existingScore: number | null | undefined, category: string, score: number) {
  const base = typeof existingScore === "number" ? existingScore : 0;
  if (category === "premium" || score >= 85) return Math.max(base, 95);
  if (category === "high" || score >= 70) return Math.max(base, 80);
  if (category === "medium" || score >= 45) return Math.max(base, 60);
  return Math.max(base, 45);
}

async function getActor(request: NextRequest, supabaseUrl: string, anonKey: string, serviceRoleKey: string) {
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
  if (authError || !authData.user) throw new Error("You must be signed in to score patient journeys.");

  const admin = createClient<any, "public", any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: roles, error: roleError } = await admin.from("user_roles").select("role,company_id,branch_id").eq("user_id", authData.user.id);
  if (roleError) throw new Error(roleError.message);
  const isAllowed = ((roles ?? []) as RoleRow[]).some((role) => role.role === "super_user" || role.role === "sub_super_user");
  if (!isAllowed) throw new Error("Only Super Users and Sub Super Users can apply Medical Aid Intelligence scoring.");
  return { admin, actorId: authData.user.id };
}

async function loadScoringOptions(admin: AdminClient, companyId?: string | null) {
  const { data, error } = await admin
    .from("medical_aid_options")
    .select("id,scheme_id,option_name,quality_score,category,notes,medical_aid_schemes(id,company_id,name,normalized_name)")
    .order("quality_score", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as AidOption[];
  if (!companyId) return rows;
  return rows.filter((option) => {
    const scheme = firstRow(option.medical_aid_schemes);
    return !scheme?.company_id || scheme.company_id === companyId;
  });
}

async function loadLeads(admin: AdminClient, companyId?: string | null) {
  const leads: LeadRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = admin
      .from("leads")
      .select(`
        id,company_id,branch_id,patient_id,status,priority_label,priority_score,integration_refs,
        patients(id,full_name,account_number,medical_aid_scheme,medical_aid_option)
      `)
      .not("status", "in", `(${finalLeadStatuses.join(",")})`)
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (companyId) query = query.eq("company_id", companyId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const pageRows = (data ?? []) as LeadRow[];
    leads.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return leads;
}

function buildOptionIndex(options: AidOption[]) {
  return buildMedicalAidScoringIndex(options);
}

function matchOption(index: MedicalAidScoringIndex<AidOption>[], lead: LeadRow) {
  const patient = firstRow(lead.patients);
  return matchMedicalAidOption(index, {
    companyId: lead.company_id,
    schemeName: patient?.medical_aid_scheme,
    optionName: patient?.medical_aid_option,
  });
}

function scoringPayload(lead: LeadRow, match: MedicalAidMatch<AidOption>) {
  const option = match.option;
  const scheme = firstRow(option.medical_aid_schemes);
  const category = String(option.category ?? "unknown").toLowerCase();
  const score = Number(option.quality_score ?? 0);
  return {
    priority_label: priorityFromScore(category, score),
    priority_score: priorityScore(lead.priority_score, category, score),
    integration_refs: {
      ...(lead.integration_refs ?? {}),
      medical_aid_scoring: {
        matched_at: new Date().toISOString(),
        match_confidence: match.confidence,
        match_confidence_score: match.confidenceScore,
        match_reason: match.reason,
        scheme_id: scheme?.id ?? null,
        scheme_name: scheme?.name ?? null,
        option_id: option.id,
        option_name: option.option_name,
        quality_score: score,
        category,
        scope: scheme?.company_id ? "company" : "global",
      },
      medical_aid_score: score,
      medical_aid_quality_category: category,
    },
  };
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);
  if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required for Medical Aid Intelligence scoring.", 500);

  try {
    const body = await request.json() as { action?: Action; company_id?: string | null };
    const action = body.action ?? "preview";
    if (!["preview", "apply"].includes(action)) return jsonError("Unknown scoring action.");

    const { admin, actorId } = await getActor(request, supabaseUrl, anonKey, serviceRoleKey);
    const companyId = body.company_id || null;
    const [options, leads] = await Promise.all([loadScoringOptions(admin, companyId), loadLeads(admin, companyId)]);
    const index = buildOptionIndex(options);

    const matched = leads.flatMap((lead) => {
      const match = matchOption(index, lead);
      return match ? [{ lead, option: match.option, match, payload: scoringPayload(lead, match) }] : [];
    });
    const unmatched = leads.length - matched.length;
    const premium = matched.filter((item) => {
      const category = String(item.option.category ?? "unknown").toLowerCase();
      return category === "premium" || Number(item.option.quality_score ?? 0) >= 85;
    }).length;
    const high = matched.filter((item) => {
      const category = String(item.option.category ?? "unknown").toLowerCase();
      const score = Number(item.option.quality_score ?? 0);
      return (category === "high" || score >= 70) && category !== "premium" && score < 85;
    }).length;
    const mediumLowUnknown = matched.length - premium - high;

    if (action === "apply") {
      for (const item of matched) {
        const { error } = await admin.from("leads").update(item.payload).eq("id", item.lead.id);
        if (error) throw new Error(error.message);
      }
      await admin.from("audit_logs").insert({
        actor_id: actorId,
        action: "applied_medical_aid_scoring",
        entity_type: "medical_aid_scoring",
        entity_id: companyId,
        company_id: companyId,
        after_data: {
          company_id: companyId,
          total_active_leads_reviewed: leads.length,
          matched_leads: matched.length,
          unmatched_leads: unmatched,
          premium_leads: premium,
          high_leads: high,
          medium_low_unknown_leads: mediumLowUnknown,
        },
      });
    }

    return NextResponse.json({
      mode: action,
      scoring_options: options.length,
      active_leads_reviewed: leads.length,
      matched_leads: matched.length,
      unmatched_leads: unmatched,
      premium_leads: premium,
      high_leads: high,
      medium_low_unknown_leads: mediumLowUnknown,
      updated_leads: action === "apply" ? matched.length : 0,
      samples: matched.slice(0, 10).map((item) => {
        const patient = firstRow(item.lead.patients);
        const scheme = firstRow(item.option.medical_aid_schemes);
        return {
          lead_id: item.lead.id,
          patient: patient?.full_name ?? "Unknown patient",
          account_number: patient?.account_number ?? "",
          patient_scheme: patient?.medical_aid_scheme ?? "",
          patient_option: patient?.medical_aid_option ?? "",
          matched_scheme: scheme?.name ?? "",
          matched_option: item.option.option_name,
          quality_score: item.option.quality_score,
          category: item.option.category,
          match_confidence: item.match.confidence,
          match_confidence_score: item.match.confidenceScore,
          match_reason: item.match.reason,
          priority_label: item.payload.priority_label,
        };
      }),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to apply Medical Aid Intelligence scoring.", 500);
  }
}
