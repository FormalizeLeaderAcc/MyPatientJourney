import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type UploadType = "transactions" | "curated_contacts";
type SystemField =
  | "patient_name"
  | "account_number"
  | "cellphone_number"
  | "alternate_number"
  | "whatsapp_number"
  | "email"
  | "medical_aid_name"
  | "medical_aid_option"
  | "transaction_date"
  | "treatment_code"
  | "branch"
  | "practitioner"
  | "amount_charged"
  | "last_visit_date"
  | "last_8101_date"
  | "last_8159_date"
  | "notes"
  | "priority";

type ImportPayload = {
  company_id: string;
  branch_id?: string | null;
  upload_type: UploadType;
  original_name: string;
  file_hash?: string | null;
  mappings: Partial<Record<SystemField, string>>;
  rows: Record<string, unknown>[];
};

type AdminClient = ReturnType<typeof createClient<any, "public", any>>;
type BranchRow = { id: string; name: string; company_id: string };
type MedicalAidOptionRow = {
  option_name: string;
  quality_score: number;
  category: "unknown" | "low" | "medium" | "high" | "premium";
  medical_aid_schemes?: { name: string; company_id: string | null } | Array<{ name: string; company_id: string | null }> | null;
};

const requiredFields: Record<UploadType, SystemField[]> = {
  transactions: ["patient_name", "account_number", "transaction_date", "treatment_code"],
  curated_contacts: ["patient_name", "account_number", "cellphone_number"],
};

const finalPriorityLabels = new Set([
  "Premium Recall Opportunity",
  "High Medical Aid Opportunity",
  "Standard Six-Month Recall",
  "Dormant Patient",
  "Missing Data Review",
  "No Recent 8159",
  "No Recent 8101 or 8159",
]);

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeKey(value: unknown) {
  return normalize(value).toLowerCase().replace(/\s+/g, " ");
}

function mappedValue(row: Record<string, unknown>, mappings: Partial<Record<SystemField, string>>, field: SystemField) {
  const source = mappings[field];
  if (!source) return "";
  return normalize(row[source]);
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = normalize(value);
  if (!raw) return null;

  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);

  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match) {
    const [, day, month, year] = match;
    const fullYear = Number(year.length === 2 ? `20${year}` : year);
    const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}

function parseAmount(value: unknown) {
  const cleaned = normalize(value).replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function dateMax(values: Array<string | null | undefined>) {
  return values.filter(Boolean).sort().at(-1) ?? null;
}

function safePriority(value: string, fallback: string) {
  const exact = Array.from(finalPriorityLabels).find((label) => label.toLowerCase() === value.toLowerCase());
  return exact ?? fallback;
}

function validateMappings(uploadType: UploadType, mappings: Partial<Record<SystemField, string>>, headers: string[]) {
  const issues: string[] = [];
  const headerSet = new Set(headers);
  for (const field of requiredFields[uploadType]) {
    if (!mappings[field]) issues.push(`${field} is required but not mapped`);
  }
  for (const [field, source] of Object.entries(mappings)) {
    if (source && !headerSet.has(source)) issues.push(`${field} is mapped to a column that does not exist: ${source}`);
  }
  const selected = Object.values(mappings).filter(Boolean);
  const duplicates = selected.filter((source, index) => selected.indexOf(source) !== index);
  if (duplicates.length) issues.push(`Duplicate source column mapping detected: ${Array.from(new Set(duplicates)).join(", ")}`);
  return issues;
}

function validateRows(uploadType: UploadType, rows: Record<string, unknown>[], mappings: Partial<Record<SystemField, string>>) {
  const rejected: Array<{ row: number; issues: string[] }> = [];
  rows.forEach((row, index) => {
    const issues: string[] = [];
    for (const field of requiredFields[uploadType]) {
      if (!mappedValue(row, mappings, field)) issues.push(`${field} is missing`);
    }
    if (uploadType === "transactions") {
      if (!parseDate(mappedValue(row, mappings, "transaction_date"))) issues.push("transaction_date is invalid");
      if (!mappedValue(row, mappings, "treatment_code").match(/^\d{3,8}[A-Z]?$/i)) issues.push("treatment_code is invalid");
    }
    if (issues.length) rejected.push({ row: index + 2, issues });
  });
  return rejected;
}

async function safeAudit(admin: AdminClient, data: Record<string, unknown>) {
  await admin.from("audit_logs").insert(data);
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
  if (authError || !authData.user) throw new Error("You must be signed in to import patient data.");

  const admin = createClient<any, "public", any>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: roles, error: roleError } = await admin.from("user_roles").select("role,company_id").eq("user_id", authData.user.id);
  if (roleError) throw new Error(roleError.message);
  const isImporter = (roles ?? []).some((role) => ["super_user", "sub_super_user"].includes(String(role.role)));
  if (!isImporter) throw new Error("Only Super Users and Sub Super Users can import patient lists.");
  return { admin, actorId: authData.user.id };
}

async function loadMedicalAidScores(admin: AdminClient, companyId: string) {
  const { data } = await admin
    .from("medical_aid_options")
    .select("option_name,quality_score,category,medical_aid_schemes(name,company_id)");
  const map = new Map<string, MedicalAidOptionRow>();
  for (const row of (data ?? []) as unknown as MedicalAidOptionRow[]) {
    const scheme = Array.isArray(row.medical_aid_schemes) ? row.medical_aid_schemes[0] : row.medical_aid_schemes;
    if (scheme?.company_id && scheme.company_id !== companyId) continue;
    map.set(`${normalizeKey(scheme?.name)}::${normalizeKey(row.option_name)}`, row);
  }
  return map;
}

function medicalAidScore(scores: Map<string, MedicalAidOptionRow>, scheme: string, option: string) {
  return scores.get(`${normalizeKey(scheme)}::${normalizeKey(option)}`);
}

async function resolveBranches(admin: AdminClient, companyId: string) {
  const { data, error } = await admin.from("branches").select("id,name,company_id").eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return (data ?? []) as BranchRow[];
}

function resolveBranchId(selectedBranchId: string | null | undefined, rowBranchName: string, branches: BranchRow[]) {
  if (selectedBranchId) return selectedBranchId;
  if (!rowBranchName) return null;
  return branches.find((branch) => normalizeKey(branch.name) === normalizeKey(rowBranchName))?.id ?? null;
}

async function upsertPatient(admin: AdminClient, payload: {
  companyId: string;
  accountNumber: string;
  fullName: string;
  medicalAidScheme?: string | null;
  medicalAidOption?: string | null;
  importBatchId: string;
}) {
  const { data, error } = await admin
    .from("patients")
    .upsert({
      company_id: payload.companyId,
      account_number: payload.accountNumber,
      full_name: payload.fullName,
      medical_aid_scheme: payload.medicalAidScheme || null,
      medical_aid_option: payload.medicalAidOption || null,
      source_import_batch_id: payload.importBatchId,
    }, { onConflict: "company_id,account_number" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

async function insertContact(admin: AdminClient, patientId: string, importBatchId: string, contactType: string, value: string, isPrimary: boolean, actorId: string) {
  if (!value) return;
  const { error } = await admin.from("patient_contacts").insert({
    patient_id: patientId,
    contact_type: contactType,
    value,
    is_primary: isPrimary,
    is_verified: false,
    updated_by: actorId,
    source_import_batch_id: importBatchId,
  });
  if (error) throw new Error(error.message);
}

async function importTransactions(
  admin: AdminClient,
  actorId: string,
  payload: ImportPayload,
  uploadedFileId: string,
  importBatchId: string,
  branches: BranchRow[],
  aidScores: Map<string, MedicalAidOptionRow>,
) {
  const patientSummaries = new Map<string, {
    patientId: string;
    accountNumber: string;
    fullName: string;
    branchId: string | null;
    medicalAidScheme: string;
    medicalAidOption: string;
    phone: string;
    txns: Array<{ date: string; code: string }>;
  }>();
  let importedRows = 0;

  for (const [index, row] of payload.rows.entries()) {
    const patientName = mappedValue(row, payload.mappings, "patient_name");
    const accountNumber = mappedValue(row, payload.mappings, "account_number");
    const transactionDate = parseDate(mappedValue(row, payload.mappings, "transaction_date"));
    const treatmentCode = mappedValue(row, payload.mappings, "treatment_code").toUpperCase();
    if (!patientName || !accountNumber || !transactionDate || !treatmentCode) continue;

    const medicalAidScheme = mappedValue(row, payload.mappings, "medical_aid_name");
    const medicalAidOption = mappedValue(row, payload.mappings, "medical_aid_option");
    const branchId = resolveBranchId(payload.branch_id, mappedValue(row, payload.mappings, "branch"), branches);
    const patientId = await upsertPatient(admin, {
      companyId: payload.company_id,
      accountNumber,
      fullName: patientName,
      medicalAidScheme,
      medicalAidOption,
      importBatchId,
    });

    await insertContact(admin, patientId, importBatchId, "mobile", mappedValue(row, payload.mappings, "cellphone_number"), true, actorId);
    await insertContact(admin, patientId, importBatchId, "alternate", mappedValue(row, payload.mappings, "alternate_number"), false, actorId);

    const { error } = await admin.from("transactions").insert({
      import_batch_id: importBatchId,
      patient_id: patientId,
      branch_id: branchId,
      transaction_date: transactionDate,
      treatment_code: treatmentCode,
      practitioner: mappedValue(row, payload.mappings, "practitioner") || null,
      amount_charged: parseAmount(mappedValue(row, payload.mappings, "amount_charged")),
      source_row_number: index + 2,
      source_payload: row,
    });
    if (error) throw new Error(error.message);
    importedRows += 1;

    const key = `${payload.company_id}::${accountNumber}`;
    const current = patientSummaries.get(key) ?? {
      patientId,
      accountNumber,
      fullName: patientName,
      branchId,
      medicalAidScheme,
      medicalAidOption,
      phone: mappedValue(row, payload.mappings, "cellphone_number"),
      txns: [],
    };
    current.txns.push({ date: transactionDate, code: treatmentCode });
    if (!current.branchId && branchId) current.branchId = branchId;
    patientSummaries.set(key, current);
  }

  const now = new Date();
  const sixMonthsAgo = addMonths(now, -6).toISOString().slice(0, 10);
  const twelveMonthsAgo = addMonths(now, -12).toISOString().slice(0, 10);
  let generatedLeads = 0;

  for (const summary of patientSummaries.values()) {
    const recallTxns = summary.txns.filter((txn) => txn.code === "8101" || txn.code === "8159");
    const lastVisit = dateMax(summary.txns.map((txn) => txn.date));
    const last8101 = dateMax(summary.txns.filter((txn) => txn.code === "8101").map((txn) => txn.date));
    const last8159 = dateMax(summary.txns.filter((txn) => txn.code === "8159").map((txn) => txn.date));
    const hasRecent8101 = Boolean(last8101 && last8101 >= sixMonthsAgo);
    const hasRecent8159 = Boolean(last8159 && last8159 >= sixMonthsAgo);
    const noRecentRecallCodes = !hasRecent8101 && !hasRecent8159;
    const dormant = !recallTxns.length || Boolean(dateMax(recallTxns.map((txn) => txn.date)) && dateMax(recallTxns.map((txn) => txn.date))! < twelveMonthsAgo);
    const noRecent8159 = Boolean(last8101 && !hasRecent8159);
    const score = medicalAidScore(aidScores, summary.medicalAidScheme, summary.medicalAidOption);
    const highAid = score && (score.category === "high" || score.category === "premium" || score.quality_score >= 70);
    const dueAfter8159 = Boolean(last8159 && last8159 < sixMonthsAgo && !summary.txns.some((txn) => txn.date > last8159));

    if (!noRecentRecallCodes && !dormant && !noRecent8159 && !highAid && !dueAfter8159) continue;

    const missingPhone = !summary.phone;
    const priorityLabel = missingPhone
      ? "Missing Data Review"
      : score?.category === "premium" || (score?.quality_score ?? 0) >= 85
        ? "Premium Recall Opportunity"
        : highAid
          ? "High Medical Aid Opportunity"
          : dormant
            ? "Dormant Patient"
            : noRecent8159
              ? "No Recent 8159"
              : "No Recent 8101 or 8159";

    const reason = [
      noRecentRecallCodes ? "No 8101 or 8159 charged in the last 6 months" : "",
      dueAfter8159 ? "8159 was charged but patient has not returned after 6 months" : "",
      noRecent8159 ? "Patient had 8101 but no recent 8159" : "",
      dormant ? "No 8101 or 8159 in over 12 months" : "",
      highAid ? `Medical aid option scored ${score?.quality_score ?? "high"}` : "",
      missingPhone ? "Missing primary contact number" : "",
    ].filter(Boolean).join("; ");

    const { error } = await admin.from("leads").insert({
      company_id: payload.company_id,
      branch_id: summary.branchId,
      patient_id: summary.patientId,
      source_import_batch_id: importBatchId,
      status: "new",
      priority_label: priorityLabel,
      priority_score: missingPhone ? 20 : score?.quality_score ?? (dormant ? 45 : 60),
      recall_reason: reason || "Standard six-month recall opportunity",
      last_visit_date: lastVisit,
      last_8101_date: last8101,
      last_8159_date: last8159,
      next_action_at: new Date().toISOString(),
      integration_refs: { uploaded_file_id: uploadedFileId },
    });
    if (error) throw new Error(error.message);
    generatedLeads += 1;
  }

  return { importedRows, generatedLeads };
}

async function importCuratedContacts(
  admin: AdminClient,
  actorId: string,
  payload: ImportPayload,
  uploadedFileId: string,
  importBatchId: string,
  branches: BranchRow[],
) {
  let importedRows = 0;
  let generatedLeads = 0;
  for (const [index, row] of payload.rows.entries()) {
    const patientName = mappedValue(row, payload.mappings, "patient_name");
    const accountNumber = mappedValue(row, payload.mappings, "account_number");
    const phone = mappedValue(row, payload.mappings, "cellphone_number");
    if (!patientName || !accountNumber || !phone) continue;
    const branchId = resolveBranchId(payload.branch_id, mappedValue(row, payload.mappings, "branch"), branches);
    const medicalAidScheme = mappedValue(row, payload.mappings, "medical_aid_name");
    const medicalAidOption = mappedValue(row, payload.mappings, "medical_aid_option");
    const patientId = await upsertPatient(admin, {
      companyId: payload.company_id,
      accountNumber,
      fullName: patientName,
      medicalAidScheme,
      medicalAidOption,
      importBatchId,
    });
    await insertContact(admin, patientId, importBatchId, "mobile", phone, true, actorId);
    await insertContact(admin, patientId, importBatchId, "alternate", mappedValue(row, payload.mappings, "alternate_number"), false, actorId);
    await insertContact(admin, patientId, importBatchId, "whatsapp", mappedValue(row, payload.mappings, "whatsapp_number"), false, actorId);
    await insertContact(admin, patientId, importBatchId, "email", mappedValue(row, payload.mappings, "email"), false, actorId);

    const priority = safePriority(mappedValue(row, payload.mappings, "priority"), phone ? "Standard Six-Month Recall" : "Missing Data Review");
    const lastVisit = parseDate(mappedValue(row, payload.mappings, "last_visit_date"));
    const last8101 = parseDate(mappedValue(row, payload.mappings, "last_8101_date"));
    const last8159 = parseDate(mappedValue(row, payload.mappings, "last_8159_date"));
    const notes = mappedValue(row, payload.mappings, "notes");
    const { error } = await admin.from("leads").insert({
      company_id: payload.company_id,
      branch_id: branchId,
      patient_id: patientId,
      source_import_batch_id: importBatchId,
      status: "new",
      priority_label: priority,
      priority_score: priority.includes("Premium") ? 90 : priority.includes("High") ? 75 : priority.includes("Dormant") ? 45 : 60,
      recall_reason: notes || "Curated patient follow-up list",
      last_visit_date: lastVisit,
      last_8101_date: last8101,
      last_8159_date: last8159,
      next_action_at: new Date().toISOString(),
      integration_refs: { uploaded_file_id: uploadedFileId, source_row_number: index + 2 },
    });
    if (error) throw new Error(error.message);
    importedRows += 1;
    generatedLeads += 1;
  }
  return { importedRows, generatedLeads };
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);
  if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required for production imports.", 500);

  try {
    const payload = await request.json() as ImportPayload;
    if (!payload.company_id) return jsonError("Select a company before importing.");
    if (!payload.original_name?.trim()) return jsonError("Original file name is required.");
    if (!payload.rows?.length) return jsonError("No spreadsheet rows were supplied for import.");

    const headers = Object.keys(payload.rows[0] ?? {});
    const mappingIssues = validateMappings(payload.upload_type, payload.mappings, headers);
    const rejectedRows = validateRows(payload.upload_type, payload.rows, payload.mappings);
    if (mappingIssues.length || rejectedRows.length) {
      return jsonError("Import validation failed.", 422, { mappingIssues, rejectedRows: rejectedRows.slice(0, 50) });
    }

    const { admin, actorId } = await getActor(request, supabaseUrl, anonKey, serviceRoleKey);
    const branches = await resolveBranches(admin, payload.company_id);
    if (payload.branch_id && !branches.some((branch) => branch.id === payload.branch_id)) {
      return jsonError("Selected branch does not belong to the selected company.", 400);
    }

    const { data: uploadedFile, error: fileError } = await admin.from("uploaded_files").insert({
      company_id: payload.company_id,
      branch_id: payload.branch_id || null,
      upload_type: payload.upload_type === "transactions" ? "transactions" : "curated_contacts",
      original_name: payload.original_name,
      storage_path: `inline-import/${payload.company_id}/${Date.now()}-${payload.original_name.replace(/[^a-z0-9_.-]/gi, "_")}`,
      file_hash: payload.file_hash || null,
      row_count: payload.rows.length,
      uploaded_by: actorId,
    }).select("id").single();
    if (fileError) throw new Error(fileError.message);

    const { data: batch, error: batchError } = await admin.from("import_batches").insert({
      uploaded_file_id: uploadedFile.id,
      status: "importing",
      source_metadata: {
        headers,
        mappings: payload.mappings,
        upload_type: payload.upload_type,
        file_hash: payload.file_hash || null,
      },
      imported_rows: 0,
      rejected_rows: 0,
      imported_by: actorId,
    }).select("id").single();
    if (batchError) throw new Error(batchError.message);

    const mappingRows = Object.entries(payload.mappings)
      .filter(([, source]) => Boolean(source))
      .map(([target_field, source_column]) => ({
        import_batch_id: batch.id,
        source_column,
        target_field,
        confidence: 100,
        confirmed_by: actorId,
      }));
    if (mappingRows.length) {
      const { error } = await admin.from("column_mappings").insert(mappingRows);
      if (error) throw new Error(error.message);
    }

    const aidScores = await loadMedicalAidScores(admin, payload.company_id);
    const result = payload.upload_type === "transactions"
      ? await importTransactions(admin, actorId, payload, uploadedFile.id, batch.id, branches, aidScores)
      : await importCuratedContacts(admin, actorId, payload, uploadedFile.id, batch.id, branches);

    const { error: completeError } = await admin.from("import_batches").update({
      status: "completed",
      imported_rows: result.importedRows,
      rejected_rows: payload.rows.length - result.importedRows,
      completed_at: new Date().toISOString(),
    }).eq("id", batch.id);
    if (completeError) throw new Error(completeError.message);

    await safeAudit(admin, {
      company_id: payload.company_id,
      actor_id: actorId,
      entity_type: "import_batch",
      entity_id: batch.id,
      action: "imported_uploaded_list",
      after_data: {
        uploaded_file_id: uploadedFile.id,
        original_name: payload.original_name,
        upload_type: payload.upload_type,
        row_count: payload.rows.length,
        imported_rows: result.importedRows,
        generated_leads: result.generatedLeads,
      },
    });

    return NextResponse.json({
      message: `Import completed: ${result.importedRows} row(s), ${result.generatedLeads} lead(s) generated`,
      uploaded_file_id: uploadedFile.id,
      import_batch_id: batch.id,
      ...result,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to import uploaded list.", 500);
  }
}
