import { after, NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 300;

type UploadType = "lead_ready";
type SystemField =
  | "patient_name"
  | "account_number"
  | "last_treatment_date"
  | "last_treatment_code"
  | "last_treatment_description"
  | "mobile_number"
  | "alternative_number"
  | "medical_aid_name"
  | "medical_aid_option"
  | "last_visit_total_amount_charged";

type ImportPayload = {
  company_id: string;
  branch_id?: string | null;
  upload_type: UploadType;
  original_name: string;
  file_hash?: string | null;
  mappings: Partial<Record<SystemField, string>>;
  rows: Record<string, unknown>[];
};
type ImportProgressRow = {
  id: string;
  status: string;
  imported_rows: number | null;
  rejected_rows: number | null;
  completed_at: string | null;
  created_at: string;
  uploaded_files: Array<{
    id: string;
    company_id: string;
    branch_id: string | null;
    upload_type: string;
    original_name: string;
    row_count: number | null;
    created_at: string;
  }> | {
    id: string;
    company_id: string;
    branch_id: string | null;
    upload_type: string;
    original_name: string;
    row_count: number | null;
    created_at: string;
  } | null;
};

type AdminClient = ReturnType<typeof createClient<any, "public", any>>;
type BranchRow = { id: string; name: string; company_id: string };

const requiredFields: SystemField[] = ["patient_name", "account_number", "last_treatment_date"];
const recommendedFields: SystemField[] = [
  "last_treatment_code",
  "last_treatment_description",
  "mobile_number",
  "alternative_number",
  "medical_aid_name",
  "medical_aid_option",
  "last_visit_total_amount_charged",
];
const finalLeadStatuses = [
  "patient_booked_and_verified",
  "patient_not_interested",
  "wrong_number_confirmed",
  "patient_moved_away",
  "patient_deceased",
  "duplicate",
  "manager_closed",
].join(",");

function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

function normalize(value: unknown) {
  return String(value ?? "").trim();
}

function mappedValue(row: Record<string, unknown>, mappings: Partial<Record<SystemField, string>>, field: SystemField) {
  const source = mappings[field];
  return source ? normalize(row[source]) : "";
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

function cleanPhone(value: unknown) {
  const raw = normalize(value);
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("27") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+27${digits.slice(1)}`;
  if (digits.length === 9) return `+27${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isSixMonthRecallDue(lastTreatmentDate: string) {
  return lastTreatmentDate <= addMonths(new Date(), -6).toISOString().slice(0, 10);
}

function treatmentCodesContain(codes: string, code: "8101" | "8159") {
  return codes.split(/[,;/\s]+/).map((item) => item.trim()).includes(code);
}

function validateMappings(mappings: Partial<Record<SystemField, string>>, headers: string[]) {
  const issues: string[] = [];
  const headerSet = new Set(headers);
  for (const field of requiredFields) {
    if (!mappings[field]) issues.push(`${field} is required but not mapped`);
  }
  for (const [field, source] of Object.entries(mappings)) {
    if (source && !headerSet.has(source)) issues.push(`${field} is mapped to a column that does not exist: ${source}`);
  }
  const selected = Object.values(mappings).filter(Boolean);
  const duplicates = selected.filter((source, index) => selected.indexOf(source) !== index);
  if (duplicates.length) issues.push(`One source column cannot be mapped to multiple lead fields: ${Array.from(new Set(duplicates)).join(", ")}`);
  return issues;
}

function validateRows(rows: Record<string, unknown>[], mappings: Partial<Record<SystemField, string>>) {
  const rejected: Array<{ row: number; issues: string[] }> = [];
  const warnings: Array<{ row: number; issues: string[] }> = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const issues: string[] = [];
    const rowWarnings: string[] = [];

    for (const field of requiredFields) {
      if (!mappedValue(row, mappings, field)) issues.push(`${field} is missing`);
    }

    const lastTreatmentDate = mappedValue(row, mappings, "last_treatment_date");
    if (lastTreatmentDate && !parseDate(lastTreatmentDate)) issues.push("last_treatment_date is invalid");

    const mobile = mappedValue(row, mappings, "mobile_number");
    if (mobile && cleanPhone(mobile) === null) issues.push("mobile_number format is invalid");
    if (!mobile) rowWarnings.push("mobile_number is missing; the lead will import but should be reviewed before contact");

    const amount = mappedValue(row, mappings, "last_visit_total_amount_charged");
    if (amount && parseAmount(amount) === null) issues.push("last_visit_total_amount_charged must be numeric");

    for (const field of recommendedFields) {
      if (!mappings[field]) rowWarnings.push(`${field} is not mapped`);
    }

    if (issues.length) rejected.push({ row: rowNumber, issues });
    if (rowWarnings.length) warnings.push({ row: rowNumber, issues: Array.from(new Set(rowWarnings)) });
  });

  return { rejected, warnings };
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
  if (!isImporter) throw new Error("Only Super Users and Sub Super Users can import lead-ready patient lists.");
  return { admin, actorId: authData.user.id };
}

async function resolveBranches(admin: AdminClient, companyId: string) {
  const { data, error } = await admin.from("branches").select("id,name,company_id").eq("company_id", companyId);
  if (error) throw new Error(error.message);
  return (data ?? []) as BranchRow[];
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

async function upsertContact(admin: AdminClient, patientId: string, importBatchId: string, contactType: "mobile" | "alternate", value: string, isPrimary: boolean, actorId: string) {
  if (!value) return;
  const { data: existingContacts, error: existingError } = await admin
    .from("patient_contacts")
    .select("id,value,manual_override")
    .eq("patient_id", patientId)
    .eq("contact_type", contactType);
  if (existingError) throw new Error(existingError.message);
  const manualContact = (existingContacts ?? []).find((contact) => Boolean(contact.manual_override));
  if (manualContact) return;

  const existing = (existingContacts ?? []).find((contact) => contact.value === value);
  if (existing?.id) {
    const { error } = await admin
      .from("patient_contacts")
      .update({ is_primary: isPrimary, updated_by: actorId, source_import_batch_id: importBatchId, manual_override: false })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await admin.from("patient_contacts").insert({
    patient_id: patientId,
    contact_type: contactType,
    value,
    is_primary: isPrimary,
    is_verified: false,
    updated_by: actorId,
    source_import_batch_id: importBatchId,
    manual_override: false,
  });
  if (error) throw new Error(error.message);
}

async function findActiveLead(admin: AdminClient, companyId: string, patientId: string, branchId: string | null) {
  let query = admin
    .from("leads")
    .select("id,integration_refs")
    .eq("company_id", companyId)
    .eq("patient_id", patientId)
    .not("status", "in", `(${finalLeadStatuses})`)
    .order("created_at", { ascending: false })
    .limit(1);

  query = branchId ? query.eq("branch_id", branchId) : query.is("branch_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; integration_refs: Record<string, unknown> | null } | null;
}

async function importLeadRows(
  admin: AdminClient,
  actorId: string,
  payload: ImportPayload,
  uploadedFileId: string,
  importBatchId: string,
  onProgress?: (importedRows: number) => Promise<void>,
) {
  let importedRows = 0;
  let createdLeads = 0;
  let updatedLeads = 0;

  for (const [index, row] of payload.rows.entries()) {
    const patientName = mappedValue(row, payload.mappings, "patient_name");
    const accountNumber = mappedValue(row, payload.mappings, "account_number");
    const lastTreatmentDate = parseDate(mappedValue(row, payload.mappings, "last_treatment_date"));
    if (!patientName || !accountNumber || !lastTreatmentDate) continue;

    const mobile = cleanPhone(mappedValue(row, payload.mappings, "mobile_number")) || "";
    const alternative = cleanPhone(mappedValue(row, payload.mappings, "alternative_number")) || "";
    const medicalAidScheme = mappedValue(row, payload.mappings, "medical_aid_name");
    const medicalAidOption = mappedValue(row, payload.mappings, "medical_aid_option");
    const treatmentCode = mappedValue(row, payload.mappings, "last_treatment_code");
    const treatmentDescription = mappedValue(row, payload.mappings, "last_treatment_description");
    const amount = parseAmount(mappedValue(row, payload.mappings, "last_visit_total_amount_charged"));
    const dueForSixMonthRecall = isSixMonthRecallDue(lastTreatmentDate);
    const missingContact = !mobile && !alternative;
    const priorityLabel = missingContact
      ? "Missing Data Review"
      : "Standard Six-Month Recall";
    const recallReason = dueForSixMonthRecall
      ? `Last treatment date was ${lastTreatmentDate}; patient has passed the six-month review window.`
      : `Last treatment date was ${lastTreatmentDate}; patient has not yet passed the six-month review window.`;
    const patientId = await upsertPatient(admin, {
      companyId: payload.company_id,
      accountNumber,
      fullName: patientName,
      medicalAidScheme,
      medicalAidOption,
      importBatchId,
    });

    await upsertContact(admin, patientId, importBatchId, "mobile", mobile, true, actorId);
    await upsertContact(admin, patientId, importBatchId, "alternate", alternative, false, actorId);

    const existingLead = await findActiveLead(admin, payload.company_id, patientId, payload.branch_id || null);
    const integrationRefs = {
      ...(existingLead?.integration_refs ?? {}),
      lead_source: "lead_ready_upload",
      lead_type: "patient_recall_follow_up",
      uploaded_file_id: uploadedFileId,
      import_batch_id: importBatchId,
      source_row_number: index + 2,
      last_treatment_code: treatmentCode || null,
      last_treatment_description: treatmentDescription || null,
      last_visit_total_amount_charged: amount,
      mobile_number: mobile || null,
      alternative_number: alternative || null,
      due_for_six_month_recall: dueForSixMonthRecall,
    };
    const leadPayload = {
      company_id: payload.company_id,
      branch_id: payload.branch_id || null,
      patient_id: patientId,
      source_import_batch_id: importBatchId,
      priority_label: priorityLabel,
      priority_score: missingContact ? 25 : dueForSixMonthRecall ? 65 : 45,
      recall_reason: missingContact ? `${recallReason} Contact number is missing or incomplete.` : recallReason,
      last_visit_date: lastTreatmentDate,
      last_8101_date: treatmentCodesContain(treatmentCode, "8101") ? lastTreatmentDate : null,
      last_8159_date: treatmentCodesContain(treatmentCode, "8159") ? lastTreatmentDate : null,
      next_action_at: new Date().toISOString(),
      integration_refs: integrationRefs,
      updated_at: new Date().toISOString(),
    };

    if (existingLead) {
      const { error } = await admin.from("leads").update(leadPayload).eq("id", existingLead.id);
      if (error) throw new Error(error.message);
      updatedLeads += 1;
    } else {
      const { error } = await admin.from("leads").insert({ ...leadPayload, status: "new" });
      if (error) throw new Error(error.message);
      createdLeads += 1;
    }
    importedRows += 1;
    if (importedRows % 25 === 0) await onProgress?.(importedRows);
  }

  await onProgress?.(importedRows);
  return { importedRows, createdLeads, updatedLeads, generatedLeads: createdLeads + updatedLeads };
}

async function hasActiveImport(admin: AdminClient, companyId: string) {
  const recentCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("import_batches")
    .select("id,created_at,uploaded_files!inner(company_id,original_name,row_count)")
    .eq("status", "importing")
    .gte("created_at", recentCutoff)
    .eq("uploaded_files.company_id", companyId)
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

async function processImportBatch(
  admin: AdminClient,
  actorId: string,
  payload: ImportPayload,
  uploadedFileId: string,
  importBatchId: string,
  warningCount: number,
) {
  try {
    const result = await importLeadRows(admin, actorId, payload, uploadedFileId, importBatchId, async (importedRows) => {
      await admin.from("import_batches").update({ imported_rows: importedRows }).eq("id", importBatchId);
    });

    const { error: completeError } = await admin.from("import_batches").update({
      status: "completed",
      imported_rows: result.importedRows,
      rejected_rows: payload.rows.length - result.importedRows,
      completed_at: new Date().toISOString(),
    }).eq("id", importBatchId);
    if (completeError) throw new Error(completeError.message);

    await safeAudit(admin, {
      company_id: payload.company_id,
      actor_id: actorId,
      entity_type: "import_batch",
      entity_id: importBatchId,
      action: "imported_lead_ready_list",
      after_data: {
        uploaded_file_id: uploadedFileId,
        original_name: payload.original_name,
        upload_type: payload.upload_type,
        row_count: payload.rows.length,
        imported_rows: result.importedRows,
        created_leads: result.createdLeads,
        updated_leads: result.updatedLeads,
        warning_rows: warningCount,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import processing failed.";
    await admin.from("import_batches").update({
      status: "failed",
      rejected_rows: payload.rows.length,
      completed_at: new Date().toISOString(),
      source_metadata: {
        upload_type: payload.upload_type,
        file_hash: payload.file_hash || null,
        error: message,
      },
    }).eq("id", importBatchId);
    await safeAudit(admin, {
      company_id: payload.company_id,
      actor_id: actorId,
      entity_type: "import_batch",
      entity_id: importBatchId,
      action: "lead_ready_import_failed",
      after_data: { uploaded_file_id: uploadedFileId, original_name: payload.original_name, error: message },
    });
  }
}

function progressPercent(importedRows: number, rowCount: number) {
  if (!rowCount) return 0;
  return Math.min(100, Math.round((importedRows / rowCount) * 100));
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);
  if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required for production imports.", 500);

  try {
    const { admin } = await getActor(request, supabaseUrl, anonKey, serviceRoleKey);
    const companyId = request.nextUrl.searchParams.get("company_id");
    const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let query = admin
      .from("import_batches")
      .select(`
        id,status,imported_rows,rejected_rows,completed_at,created_at,
        uploaded_files(id,company_id,branch_id,upload_type,original_name,row_count,created_at)
      `)
      .gte("created_at", recentCutoff)
      .order("created_at", { ascending: false })
      .limit(15);
    if (companyId) query = query.eq("uploaded_files.company_id", companyId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const imports = ((data ?? []) as unknown as ImportProgressRow[])
      .map((item) => ({ ...item, uploaded_files: Array.isArray(item.uploaded_files) ? item.uploaded_files[0] ?? null : item.uploaded_files }))
      .filter((item) => item.uploaded_files?.upload_type === "lead_ready")
      .map((item) => {
        const rowCount = item.uploaded_files?.row_count ?? 0;
        const importedRows = item.imported_rows ?? 0;
        return {
          id: item.id,
          status: item.status,
          imported_rows: importedRows,
          rejected_rows: item.rejected_rows ?? 0,
          row_count: rowCount,
          progress: item.status === "completed" ? 100 : progressPercent(importedRows, rowCount),
          completed_at: item.completed_at,
          created_at: item.created_at,
          uploaded_file_id: item.uploaded_files?.id,
          company_id: item.uploaded_files?.company_id,
          branch_id: item.uploaded_files?.branch_id,
          original_name: item.uploaded_files?.original_name,
        };
      });
    return NextResponse.json({ imports });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to load import progress.", 500);
  }
}

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey) return jsonError("Supabase public environment variables are not configured.", 500);
  if (!serviceRoleKey) return jsonError("SUPABASE_SERVICE_ROLE_KEY is required for production imports.", 500);

  try {
    const payload = await request.json() as ImportPayload;
    if (payload.upload_type !== "lead_ready") return jsonError("Only lead-ready spreadsheets can be imported from the Upload Leads section.");
    if (!payload.company_id) return jsonError("Select a company before importing.");
    if (!payload.original_name?.trim()) return jsonError("Original file name is required.");
    if (!payload.rows?.length) return jsonError("No spreadsheet rows were supplied for import.");

    const headers = Object.keys(payload.rows[0] ?? {});
    const mappingIssues = validateMappings(payload.mappings, headers);
    const rowValidation = validateRows(payload.rows, payload.mappings);
    if (mappingIssues.length || rowValidation.rejected.length) {
      return jsonError("Import validation failed.", 422, {
        mappingIssues,
        rejectedRows: rowValidation.rejected.slice(0, 50),
        warnings: rowValidation.warnings.slice(0, 50),
      });
    }

    const { admin, actorId } = await getActor(request, supabaseUrl, anonKey, serviceRoleKey);
    const branches = await resolveBranches(admin, payload.company_id);
    if (payload.branch_id && !branches.some((branch) => branch.id === payload.branch_id)) {
      return jsonError("Selected branch does not belong to the selected company.", 400);
    }
    const activeImport = await hasActiveImport(admin, payload.company_id);
    if (activeImport) {
      return jsonError("A lead import is already running for this company. Wait for it to finish before starting another upload.", 409);
    }

    const { data: uploadedFile, error: fileError } = await admin.from("uploaded_files").insert({
      company_id: payload.company_id,
      branch_id: payload.branch_id || null,
      upload_type: "lead_ready",
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
        warnings: rowValidation.warnings.slice(0, 250),
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

    after(async () => {
      await processImportBatch(admin, actorId, payload, uploadedFile.id, batch.id, rowValidation.warnings.length);
    });

    return NextResponse.json({
      message: `Lead import started: ${payload.rows.length.toLocaleString()} spreadsheet row(s) are being processed in the background.`,
      uploaded_file_id: uploadedFile.id,
      import_batch_id: batch.id,
      warnings: rowValidation.warnings.slice(0, 50),
      status: "importing",
      row_count: payload.rows.length,
    }, { status: 202 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to import lead-ready list.", 500);
  }
}
