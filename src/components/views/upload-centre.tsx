"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  Download,
  FileCheck2,
  FileSpreadsheet,
  Info,
  LoaderCircle,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
} from "lucide-react";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Company = { id: string; name: string };
type Branch = { id: string; company_id: string; name: string };
type UploadedList = {
  id: string;
  company_id: string;
  branch_id: string | null;
  upload_type: string;
  original_name: string;
  row_count: number | null;
  created_at: string;
};
type ImportProgress = {
  id: string;
  status: "importing" | "completed" | "failed" | "stalled" | string;
  imported_rows: number;
  rejected_rows: number;
  row_count: number;
  progress: number;
  source_metadata?: Record<string, unknown>;
  completed_at: string | null;
  created_at: string;
  uploaded_file_id: string;
  company_id: string;
  branch_id: string | null;
  original_name: string;
};

function importStatusClass(status: string) {
  if (status === "completed") return "standard";
  if (status === "failed" || status === "stalled") return "missing";
  return "high";
}

function importStatusLabel(status: string) {
  if (status === "stalled") return "stalled - needs review";
  return status;
}

type CleanupField =
  | "patient_name"
  | "account_holder"
  | "account_number"
  | "transaction_date"
  | "treatment_code"
  | "treatment_description"
  | "cellphone_number"
  | "telephone_number"
  | "private_number"
  | "alternative_number"
  | "email"
  | "medical_aid_name"
  | "medical_aid_option"
  | "branch"
  | "practitioner"
  | "amount_charged";

type LeadField =
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

type TargetField<T extends string> = {
  key: T;
  label: string;
  required?: boolean;
  aliases: string[];
};

type CleanupDataset = {
  id: string;
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
  mappings: Partial<Record<CleanupField, string>>;
};

const leadReadyColumns = [
  "Patient Name",
  "Account Number",
  "Last Treatment Date",
  "Last Treatment Code",
  "Last Treatment Description",
  "Mobile Number",
  "Alternative Number",
  "Medical Aid Name",
  "Medical Aid Option / Plan",
  "Last Visit Total Amount Charged",
] as const;
type LeadReadyColumn = typeof leadReadyColumns[number];
type LeadReadyRow = Record<LeadReadyColumn, string>;
type ReportRow = Record<string, string | number>;

const cleanupFields: TargetField<CleanupField>[] = [
  { key: "patient_name", label: "Patient name", aliases: ["patient name", "patient full name", "patient", "name", "member name"] },
  { key: "account_holder", label: "Account holder", aliases: ["account holder", "main member", "principal member", "responsible person", "holder"] },
  { key: "account_number", label: "Account number", aliases: ["account number", "account no", "account", "patient number", "file number", "acc no"] },
  { key: "transaction_date", label: "Transaction / visit date", aliases: ["transaction date", "txn date", "date", "service date", "treatment date", "visit date", "last visit date"] },
  { key: "treatment_code", label: "Treatment code", aliases: ["treatment code", "code", "tariff code", "procedure code", "item code"] },
  { key: "treatment_description", label: "Treatment description", aliases: ["treatment description", "description", "procedure description", "item description", "tariff description"] },
  { key: "cellphone_number", label: "Cellphone / mobile", aliases: ["cellphone", "cellphone number", "mobile", "mobile number", "cell", "contact number"] },
  { key: "telephone_number", label: "Telephone number", aliases: ["telephone", "telephone number", "tel", "phone", "home phone", "work phone"] },
  { key: "private_number", label: "Private number", aliases: ["private number", "private phone", "private tel"] },
  { key: "alternative_number", label: "Alternative number", aliases: ["alternative number", "alternate number", "alt phone", "other number"] },
  { key: "email", label: "Email", aliases: ["email", "email address", "patient email"] },
  { key: "medical_aid_name", label: "Medical aid name", aliases: ["medical aid", "medical aid name", "scheme", "scheme name", "medical scheme"] },
  { key: "medical_aid_option", label: "Medical aid option / plan", aliases: ["medical aid option", "option", "plan", "plan name", "benefit option"] },
  { key: "branch", label: "Branch", aliases: ["branch", "practice branch", "location", "practice"] },
  { key: "practitioner", label: "Practitioner", aliases: ["practitioner", "provider", "doctor", "dentist"] },
  { key: "amount_charged", label: "Amount charged", aliases: ["amount charged", "amount", "charge", "fee", "charged", "value"] },
];

const leadFields: TargetField<LeadField>[] = [
  { key: "patient_name", label: "Patient Name", required: true, aliases: ["patient name", "patient full name", "patient", "name"] },
  { key: "account_number", label: "Account Number", required: true, aliases: ["account number", "account no", "account", "patient number", "file number"] },
  { key: "last_treatment_date", label: "Last Treatment Date", required: true, aliases: ["last treatment date", "last visit date", "last treatment", "visit date"] },
  { key: "last_treatment_code", label: "Last Treatment Code", aliases: ["last treatment code", "treatment code", "codes", "last code"] },
  { key: "last_treatment_description", label: "Last Treatment Description", aliases: ["last treatment description", "treatment description", "description"] },
  { key: "mobile_number", label: "Mobile Number", aliases: ["mobile number", "cellphone number", "cellphone", "mobile", "primary number"] },
  { key: "alternative_number", label: "Alternative Number", aliases: ["alternative number", "alternate number", "alt phone", "secondary number"] },
  { key: "medical_aid_name", label: "Medical Aid Name", aliases: ["medical aid name", "medical aid", "scheme", "scheme name"] },
  { key: "medical_aid_option", label: "Medical Aid Option / Plan", aliases: ["medical aid option plan", "medical aid option", "option", "plan", "plan name"] },
  { key: "last_visit_total_amount_charged", label: "Last Visit Total Amount Charged", aliases: ["last visit total amount charged", "total amount", "amount charged", "last visit total", "amount"] },
];

export function UploadCentre({ notify, onImported }: { notify: (message: string) => void; onImported?: () => void | Promise<void> }) {
  const [activeSection, setActiveSection] = useState<"cleanup" | "upload">("cleanup");
  const [cleanupDatasets, setCleanupDatasets] = useState<CleanupDataset[]>([]);
  const [cleanupProcessing, setCleanupProcessing] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{
    leadRows: LeadReadyRow[];
    exceptionRows: ReportRow[];
    duplicateRows: ReportRow[];
    summaryRows: ReportRow[];
  } | null>(null);

  const [leadFile, setLeadFile] = useState<{ name: string; size: string; rowCount: number; hash: string | null } | null>(null);
  const [leadHeaders, setLeadHeaders] = useState<string[]>([]);
  const [leadRows, setLeadRows] = useState<Record<string, unknown>[]>([]);
  const [leadMappings, setLeadMappings] = useState<Partial<Record<LeadField, string>>>({});
  const [leadProcessing, setLeadProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [uploadedLists, setUploadedLists] = useState<UploadedList[]>([]);
  const [importJobs, setImportJobs] = useState<ImportProgress[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [listToRecall, setListToRecall] = useState<UploadedList | null>(null);
  const [recallReason, setRecallReason] = useState("");
  const [recallPassword, setRecallPassword] = useState("");
  const [recalling, setRecalling] = useState(false);
  const [error, setError] = useState("");
  const [validationDetails, setValidationDetails] = useState<string[]>([]);
  const [importResult, setImportResult] = useState("");
  const cleanupInputRef = useRef<HTMLInputElement>(null);
  const leadInputRef = useRef<HTMLInputElement>(null);

  const loadImportProgress = useCallback(async (nextCompanyId = companyId) => {
    if (!isSupabaseConfigured) return;
    const params = nextCompanyId ? `?company_id=${encodeURIComponent(nextCompanyId)}` : "";
    const response = await fetch(`/api/imports${params}`, { cache: "no-store" });
    const result = await response.json();
    if (response.ok) setImportJobs(result.imports ?? []);
  }, [companyId]);

  async function loadScopeData() {
    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseBrowserClient();
    const [companyResult, branchResult, fileResult] = await Promise.all([
      supabase.from("companies").select("id,name").order("name"),
      supabase.from("branches").select("id,company_id,name").order("name"),
      supabase.from("uploaded_files").select("id,company_id,branch_id,upload_type,original_name,row_count,created_at").order("created_at", { ascending: false }).limit(30),
    ]);
    if (companyResult.data) {
      setCompanies(companyResult.data);
      setCompanyId((current) => current || companyResult.data[0]?.id || "");
    }
    if (branchResult.data) setBranches(branchResult.data);
    if (fileResult.data) setUploadedLists(fileResult.data as UploadedList[]);
    await loadImportProgress(companyId || companyResult.data?.[0]?.id || "");
  }

  useEffect(() => { void loadScopeData(); }, []);

  const companyById = useMemo(() => Object.fromEntries(companies.map((company) => [company.id, company])), [companies]);
  const branchById = useMemo(() => Object.fromEntries(branches.map((branch) => [branch.id, branch])), [branches]);
  const scopedBranches = branches.filter((branch) => branch.company_id === companyId);
  const scopedUploadedLists = uploadedLists.filter((item) => !companyId || item.company_id === companyId);
  const activeImport = importJobs.find((job) => job.status === "importing" && (!companyId || job.company_id === companyId));
  const leadValidation = useMemo(() => validateLeadImportReadiness(companyId, leadFile, leadRows, leadMappings), [companyId, leadFile, leadRows, leadMappings]);
  const leadWarnings = useMemo(() => leadImportWarnings(leadRows, leadMappings), [leadRows, leadMappings]);

  useEffect(() => {
    if (!activeImport) return;
    const interval = window.setInterval(() => { void loadImportProgress(); void onImported?.(); }, 3000);
    return () => window.clearInterval(interval);
  }, [activeImport, loadImportProgress, onImported]);

  function resetCleanup() {
    setCleanupDatasets([]);
    setCleanupResult(null);
    setValidationDetails([]);
    setError("");
    if (cleanupInputRef.current) cleanupInputRef.current.value = "";
  }

  function resetLeadUpload() {
    setLeadFile(null);
    setLeadHeaders([]);
    setLeadRows([]);
    setLeadMappings({});
    setValidationDetails([]);
    setImportResult("");
    setError("");
    if (leadInputRef.current) leadInputRef.current.value = "";
  }

  async function readCleanupFiles(files: FileList) {
    setCleanupProcessing(true);
    setError("");
    setCleanupResult(null);
    try {
      const datasets: CleanupDataset[] = [];
      for (const selected of Array.from(files)) {
        const sheets = await readWorkbook(selected);
        for (const sheet of sheets) {
          const headers = (sheet.data[0] ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
          if (!headers.length) continue;
          const rows = sheet.data.slice(1)
            .filter((row) => row.some((cell) => String(cell ?? "").trim()))
            .map((row) => Object.fromEntries(headers.map((header, index) => [header, serializableCell(row[index])])));
          datasets.push({
            id: `${selected.name}-${sheet.sheet}-${datasets.length}`,
            fileName: selected.name,
            sheetName: sheet.sheet,
            headers,
            rows,
            mappings: detectMappings(headers, cleanupFields),
          });
        }
      }
      setCleanupDatasets(datasets);
      notify(`${datasets.length.toLocaleString()} sheet(s) loaded for cleanup. Confirm mappings before generating the lead-ready file.`);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "We could not read one or more cleanup spreadsheets.");
    } finally {
      setCleanupProcessing(false);
    }
  }

  async function readLeadReadyFile(selected: File) {
    setLeadProcessing(true);
    setError("");
    setValidationDetails([]);
    setImportResult("");
    try {
      const sheets = await readWorkbook(selected);
      const firstSheet = sheets[0];
      if (!firstSheet) throw new Error("No readable sheet found.");
      const headers = (firstSheet.data[0] ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
      if (!headers.length) throw new Error("No header row found.");
      const parsedRows = firstSheet.data.slice(1)
        .filter((row) => row.some((cell) => String(cell ?? "").trim()))
        .map((row) => Object.fromEntries(headers.map((header, index) => [header, serializableCell(row[index])])));
      const hash = await fileHash(selected);
      setLeadHeaders(headers);
      setLeadRows(parsedRows);
      setLeadMappings(detectMappings(headers, leadFields));
      setLeadFile({ name: selected.name, size: `${(selected.size / 1024).toFixed(1)} KB`, rowCount: parsedRows.length, hash });
      notify(`${parsedRows.length.toLocaleString()} lead-ready rows detected. Confirm mappings before import.`);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "We could not read that lead-ready spreadsheet.");
    } finally {
      setLeadProcessing(false);
    }
  }

  function updateCleanupMapping(datasetId: string, field: CleanupField, source: string) {
    setCleanupDatasets((current) => current.map((dataset) => dataset.id === datasetId
      ? { ...dataset, mappings: { ...dataset.mappings, [field]: source } }
      : dataset));
  }

  function generateCleanupOutput() {
    if (!cleanupDatasets.length) {
      setError("Upload at least one messy spreadsheet before running cleanup.");
      return;
    }
    const result = cleanupToLeadRows(cleanupDatasets);
    setCleanupResult(result);
    notify(`${result.leadRows.length.toLocaleString()} upload-ready lead row(s) generated. Download the lead-ready spreadsheet, then import it under Upload Leads.`);
  }

  async function importLeadSpreadsheet() {
    setValidationDetails(leadValidation.slice(0, 30));
    if (leadValidation.length) {
      setError("Please fix the mapping and row validation issues before importing.");
      return;
    }
    setImporting(true);
    setError("");
    setImportResult("");
    const response = await fetch("/api/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        branch_id: branchId || null,
        upload_type: "lead_ready",
        original_name: leadFile?.name,
        file_hash: leadFile?.hash,
        mappings: leadMappings,
        rows: leadRows,
      }),
    });
    const result = await response.json();
    setImporting(false);
    if (!response.ok) {
      setError(result.error ?? "Lead import failed.");
      const details = result.details as { mappingIssues?: string[]; rejectedRows?: Array<{ row: number; issues: string[] }>; warnings?: Array<{ row: number; issues: string[] }> } | undefined;
      setValidationDetails([
        ...(details?.mappingIssues ?? []),
        ...(details?.rejectedRows ?? []).map((row) => `Row ${row.row}: ${row.issues.join(", ")}`),
        ...(details?.warnings ?? []).map((row) => `Warning row ${row.row}: ${row.issues.join(", ")}`),
      ].slice(0, 30));
      return;
    }
    setImportResult(result.message ?? "Lead import completed");
    notify(result.message ?? "Lead import completed");
    await loadScopeData();
    await loadImportProgress(companyId);
    await onImported?.();
  }

  async function recallUploadedList() {
    if (!listToRecall) return;
    if (recallReason.trim().length < 8) {
      setError("Please enter a clear reason before recalling this uploaded list.");
      return;
    }
    if (!recallPassword.trim()) {
      setError("Enter your Super User password to confirm this protected recall.");
      return;
    }
    setRecalling(true);
    setError("");
    const response = await fetch("/api/admin/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recall_uploaded_list", uploaded_file_id: listToRecall.id, reason: recallReason, password: recallPassword }),
    });
    const result = await response.json();
    setRecalling(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to recall uploaded list.");
      return;
    }
    notify(result.message ?? "Uploaded list recalled");
    setListToRecall(null);
    setRecallReason("");
    setRecallPassword("");
    await loadScopeData();
  }

  return <>
    <div className="page-head">
      <div>
        <h1>Upload Centre</h1>
        <p>Clean messy practice spreadsheets first, then import only upload-ready patient lead lists.</p>
      </div>
      <button className="btn btn-secondary" onClick={activeSection === "cleanup" ? resetCleanup : resetLeadUpload}><RotateCcw size={14} />Reset current section</button>
    </div>

    {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldAlert size={14}/><span>{error}</span></div>}
    {validationDetails.length > 0 && <div className="callout" style={{ background: "#fff4ed", color: "#8a5a1f", alignItems: "flex-start" }}><ShieldAlert size={14}/><span><strong>Validation feedback:</strong><br/>{validationDetails.slice(0, 12).map((issue) => <span key={issue} style={{ display: "block", marginTop: 3 }}>{issue}</span>)}</span></div>}
    {importResult && <div className="callout" style={{ background: "#edf8f4", color: "#2e765f" }}><CheckCircle2 size={14}/><span>{importResult}</span></div>}

    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <button className="lead-card" onClick={() => setActiveSection("cleanup")} style={{ textAlign: "left", borderColor: activeSection === "cleanup" ? "#58aaa2" : undefined, background: activeSection === "cleanup" ? "#f5fbf9" : undefined }}>
          <div className="drop-icon" style={{ margin: "0 0 14px" }}><Wand2 size={22}/></div>
          <strong style={{ fontFamily: "Manrope", fontSize: 14 }}>Data Cleanup Tool</strong>
          <p style={{ fontSize: 10, lineHeight: 1.6, color: "#6f837f" }}>Upload messy transaction, recall, contact or medical aid exports. Clean, merge, analyse and download a lead-ready spreadsheet.</p>
          <span className="badge high">Does not import to Supabase</span>
        </button>
        <button className="lead-card" onClick={() => setActiveSection("upload")} style={{ textAlign: "left", borderColor: activeSection === "upload" ? "#58aaa2" : undefined, background: activeSection === "upload" ? "#f5fbf9" : undefined }}>
          <div className="drop-icon" style={{ margin: "0 0 14px" }}><FileCheck2 size={22}/></div>
          <strong style={{ fontFamily: "Manrope", fontSize: 14 }}>Upload Leads</strong>
          <p style={{ fontSize: 10, lineHeight: 1.6, color: "#6f837f" }}>Import a clean, lead-ready spreadsheet into the selected company and optional branch workflow.</p>
          <span className="badge premium">Live import area</span>
        </button>
      </div>
    </div>

    {activeSection === "cleanup" ? (
      <DataCleanupSection
        datasets={cleanupDatasets}
        processing={cleanupProcessing}
        result={cleanupResult}
        inputRef={cleanupInputRef}
        onFiles={readCleanupFiles}
        onMappingChange={updateCleanupMapping}
        onRun={generateCleanupOutput}
      />
    ) : (
      <UploadLeadsSection
        companyId={companyId}
        branchId={branchId}
        companies={companies}
        companyById={companyById}
        branches={scopedBranches}
        file={leadFile}
        headers={leadHeaders}
        rows={leadRows}
        mappings={leadMappings}
        validation={leadValidation}
        warnings={leadWarnings}
        processing={leadProcessing}
        importing={importing}
        activeImport={activeImport}
        inputRef={leadInputRef}
        onCompanyChange={(nextCompanyId) => { setCompanyId(nextCompanyId); setBranchId(""); resetLeadUpload(); void loadImportProgress(nextCompanyId); }}
        onBranchChange={setBranchId}
        onFile={readLeadReadyFile}
        onMappingChange={(field, source) => setLeadMappings((current) => ({ ...current, [field]: source }))}
        onImport={importLeadSpreadsheet}
      />
    )}

    {activeSection === "upload" && <ImportReportsSection
      jobs={importJobs}
      companyById={companyById}
      branchById={branchById}
      onRefresh={() => loadImportProgress(companyId)}
    />}

    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head"><div><div className="card-title">Recall / withdraw uploaded lists</div><div className="card-sub">Primary Super User only. This removes one selected imported list and records the reason in the audit log.</div></div></div>
      <div className="table-wrap">
        <table className="data-table"><thead><tr><th>List</th><th>Company</th><th>Branch</th><th>Type</th><th>Rows</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>{scopedUploadedLists.map((item) => <tr key={item.id}><td><strong>{item.original_name}</strong></td><td>{companyById[item.company_id]?.name ?? "Unknown"}</td><td>{item.branch_id ? branchById[item.branch_id]?.name ?? "Unknown" : "Company-wide"}</td><td>{item.upload_type}</td><td>{item.row_count ?? "-"}</td><td>{new Date(item.created_at).toLocaleDateString()}</td><td><button className="btn btn-danger-soft" onClick={() => setListToRecall(item)}><Trash2 size={12}/>Recall list</button></td></tr>)}</tbody></table>
        {!scopedUploadedLists.length && <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><FileSpreadsheet size={25}/></div><h2>No uploaded lists found</h2><p>Persisted live imports will appear here for controlled recall/withdrawal.</p></div>}
      </div>
    </div>

    {listToRecall && <div className="modal-backdrop" onClick={() => { setListToRecall(null); setRecallPassword(""); }}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><strong>Recall uploaded list</strong><button className="icon-btn" onClick={() => { setListToRecall(null); setRecallPassword(""); }}>x</button></div><div className="modal-body"><div className="callout" style={{ background: "#fff4ed" }}><ShieldAlert size={14}/><span>This is destructive and primary-Super-User-only. It removes records created from this imported list only; audit history remains. Password confirmation is required.</span></div><p style={{ fontSize: 11, color: "#657875", lineHeight: 1.6 }}><strong>{listToRecall.original_name}</strong><br/>{companyById[listToRecall.company_id]?.name ?? "Unknown company"} - {listToRecall.row_count ?? 0} rows</p><div className="form-field"><label>Reason for recall *</label><textarea className="form-control" value={recallReason} onChange={(event) => setRecallReason(event.target.value)} placeholder="Example: Wrong company list uploaded in error"/></div><div className="form-field" style={{ marginTop: 12 }}><label>Confirm with your Super User password *</label><input className="form-control" type="password" value={recallPassword} onChange={(event) => setRecallPassword(event.target.value)} placeholder="Enter your login password" autoComplete="current-password"/></div></div><div className="modal-actions"><button className="btn btn-secondary" onClick={() => { setListToRecall(null); setRecallPassword(""); }}>Cancel</button><button className="btn btn-danger-soft" disabled={recalling || recallReason.trim().length < 8 || !recallPassword.trim()} onClick={recallUploadedList}>{recalling ? "Recalling..." : "Confirm recall"}</button></div></div></div>}
  </>;
}

function DataCleanupSection({
  datasets,
  processing,
  result,
  inputRef,
  onFiles,
  onMappingChange,
  onRun,
}: {
  datasets: CleanupDataset[];
  processing: boolean;
  result: { leadRows: LeadReadyRow[]; exceptionRows: ReportRow[]; duplicateRows: ReportRow[]; summaryRows: ReportRow[] } | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFiles: (files: FileList) => void;
  onMappingChange: (datasetId: string, field: CleanupField, source: string) => void;
  onRun: () => void;
}) {
  const totalRows = datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0);
  return <div className="card">
    <div className="card-head"><div><div className="card-title">Data Cleanup Tool</div><div className="card-sub">Prepare messy files into one clean Upload-Ready Lead Spreadsheet. This section does not write to the live database.</div></div></div>
    <div className="card-body">
      <input ref={inputRef} hidden multiple type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files && onFiles(event.target.files)} />
      <div className="dropzone" onClick={() => inputRef.current?.click()}>
        <div className="drop-icon">{processing ? <LoaderCircle size={24} className="animate-spin" /> : <UploadCloud size={24} />}</div>
        <h3>Upload messy practice spreadsheets</h3>
        <p>Supports multiple files, multiple workbook sheets, transaction lists, contact lists, recall exports and medical aid exports.</p>
        <button className="btn btn-soft" type="button">Choose cleanup files</button>
      </div>

      {datasets.length > 0 && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 16 }}>
          <Metric label="Sheets loaded" value={datasets.length.toLocaleString()} />
          <Metric label="Rows detected" value={totalRows.toLocaleString()} />
          <Metric label="Mapped patient fields" value={String(datasets.filter((dataset) => dataset.mappings.patient_name || dataset.mappings.account_holder).length)} />
          <Metric label="Mapped date fields" value={String(datasets.filter((dataset) => dataset.mappings.transaction_date).length)} />
        </div>

        <div className="callout" style={{ marginTop: 14 }}>
          <Info size={14}/><span>Repeated transaction line items are preserved during analysis. True duplicate rows are removed only when the mapped row values are identical.</span>
        </div>

        <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
          {datasets.map((dataset) => (
            <div className="lead-card" key={dataset.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                <div><strong style={{ fontFamily: "Manrope", fontSize: 13 }}>{dataset.fileName}</strong><p style={{ fontSize: 10, color: "#738582", marginTop: 4 }}>{dataset.sheetName} - {dataset.rows.length.toLocaleString()} rows</p></div>
                <span className="badge standard">{dataset.headers.length} columns</span>
              </div>
              <div className="mapping-list" style={{ marginTop: 12 }}>
                {cleanupFields.map((field) => <div className="mapping-row" key={field.key}><div className="mapping-source">{field.label}</div><ChevronRight className="mapping-arrow" size={14}/><select className="form-control" value={dataset.mappings[field.key] ?? ""} onChange={(event) => onMappingChange(dataset.id, field.key, event.target.value)}><option value="">Not mapped</option>{dataset.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></div>)}
              </div>
            </div>
          ))}
        </div>

        <div className="modal-actions" style={{ borderRadius: 14, marginTop: 16 }}>
          <button className="btn btn-primary" onClick={onRun}><Wand2 size={14}/>Generate upload-ready spreadsheet</button>
        </div>
      </>}

      {result && <div className="card" style={{ marginTop: 16, boxShadow: "none", border: "1px solid #e5ecea" }}>
        <div className="card-head"><div><div className="card-title">Cleanup output</div><div className="card-sub">Download the lead-ready file for Upload Leads. Reports are for review only and should not be imported as lead data.</div></div></div>
        <div className="card-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 14 }}>
            <Metric label="Lead rows produced" value={result.leadRows.length.toLocaleString()} />
            <Metric label="Exceptions" value={result.exceptionRows.length.toLocaleString()} />
            <Metric label="Duplicates removed" value={result.duplicateRows.length.toLocaleString()} />
            <Metric label="Summary rows" value={result.summaryRows.length.toLocaleString()} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button className="btn btn-primary" onClick={() => downloadCsv("Upload-Ready Lead Spreadsheet.csv", result.leadRows, leadReadyColumns)}><Download size={14}/>Upload-Ready Lead Spreadsheet</button>
            <button className="btn btn-secondary" onClick={() => downloadCsv("Exception Report.csv", result.exceptionRows)}><Download size={14}/>Exception Report</button>
            <button className="btn btn-secondary" onClick={() => downloadCsv("Duplicate Report.csv", result.duplicateRows)}><Download size={14}/>Duplicate Report</button>
            <button className="btn btn-secondary" onClick={() => downloadCsv("Cleanup Summary Report.csv", result.summaryRows)}><Download size={14}/>Cleanup Summary Report</button>
          </div>
        </div>
      </div>}
    </div>
  </div>;
}

function UploadLeadsSection({
  companyId,
  branchId,
  companies,
  companyById,
  branches,
  file,
  headers,
  rows,
  mappings,
  validation,
  warnings,
  processing,
  importing,
  activeImport,
  inputRef,
  onCompanyChange,
  onBranchChange,
  onFile,
  onMappingChange,
  onImport,
}: {
  companyId: string;
  branchId: string;
  companies: Company[];
  companyById: Record<string, Company>;
  branches: Branch[];
  file: { name: string; size: string; rowCount: number; hash: string | null } | null;
  headers: string[];
  rows: Record<string, unknown>[];
  mappings: Partial<Record<LeadField, string>>;
  validation: string[];
  warnings: string[];
  processing: boolean;
  importing: boolean;
  activeImport?: ImportProgress;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onCompanyChange: (companyId: string) => void;
  onBranchChange: (branchId: string) => void;
  onFile: (file: File) => void;
  onMappingChange: (field: LeadField, source: string) => void;
  onImport: () => void;
}) {
  const requiredMapped = leadFields.filter((field) => field.required && mappings[field.key]).length;
  const totalRequired = leadFields.filter((field) => field.required).length;

  return <div className="card">
    <div className="card-head"><div><div className="card-title">Upload Leads</div><div className="card-sub">Only clean lead-ready spreadsheets are accepted here. Company and branch are selected outside the spreadsheet.</div></div></div>
    <div className="card-body">
      <div className="form-grid">
        <div className="form-field"><label>Company *</label><select className="form-control" value={companyId} onChange={(event) => onCompanyChange(event.target.value)} required><option value="">Select company before upload</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
        <div className="form-field"><label>Branch</label><select className="form-control" value={branchId} onChange={(event) => onBranchChange(event.target.value)} disabled={!companyId}><option value="">Company-wide list</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>
        <div className="form-field full"><div className="callout" style={{ margin: 0 }}><Building2 size={14}/><span>Safety rail: the selected company applies to the whole upload. Spreadsheet branch columns are ignored for live import and cannot move patients into another company.</span></div></div>
      </div>

      <input ref={inputRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])} />
      {activeImport && <ImportProgressPanel job={activeImport} />}

      <div className="dropzone" onClick={() => companyId && !activeImport ? inputRef.current?.click() : undefined} style={{ opacity: companyId && !activeImport ? 1 : 0.58, marginTop: 16 }}>
        <div className="drop-icon">{processing ? <LoaderCircle size={24} className="animate-spin" /> : <UploadCloud size={24} />}</div>
        <h3>{activeImport ? "Import currently running" : companyId ? "Upload a clean lead-ready spreadsheet" : "Select a company first"}</h3>
        <p>{activeImport ? "You can leave this page and return later. The server will continue processing and the progress bar will update when you come back." : "Required columns: Patient Name, Account Number, Last Treatment Date. Mobile number is recommended but not blocking."}</p>
        <button className="btn btn-soft" type="button" disabled={!companyId || Boolean(activeImport)}>Choose lead-ready spreadsheet</button>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <button className="btn btn-secondary" onClick={() => downloadCsv("Upload Leads Template.csv", [emptyLeadReadyRow()], leadReadyColumns)}><Download size={14}/>Download template</button>
        <span className="badge standard">Selected scope: {companyById[companyId]?.name ?? "No company selected"}</span>
      </div>

      {file && <div className="file-row"><div className="file-icon"><FileSpreadsheet size={19}/></div><div><strong>{file.name}</strong><span>{file.size} - {file.rowCount.toLocaleString()} rows detected - {companyById[companyId]?.name}</span></div><CheckCircle2 style={{ marginLeft: "auto", color: "#3b9b7c" }} size={18}/></div>}

      {headers.length > 0 && <div className="lead-card" style={{ marginTop: 14 }}>
        <strong style={{ fontFamily: "Manrope", fontSize: 13 }}>Confirm lead column mapping</strong>
        <div className="mapping-list" style={{ marginTop: 12 }}>
          {leadFields.map((field) => <div className="mapping-row" key={field.key}><div className="mapping-source">{field.label}{field.required ? " *" : ""}</div><ChevronRight className="mapping-arrow" size={14}/><select className="form-control" value={mappings[field.key] ?? ""} onChange={(event) => onMappingChange(field.key, event.target.value)}><option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></div>)}
        </div>
        <div className="mapping-status"><CheckCircle2 size={13}/> Required mapped: {requiredMapped} of {totalRequired}. One source column cannot be reused for multiple target fields.</div>
      </div>}

      {warnings.length > 0 && <div className="callout" style={{ background: "#fff8e6", color: "#80611c", marginTop: 14, alignItems: "flex-start" }}><AlertTriangle size={14}/><span><strong>Non-blocking warnings:</strong><br/>{warnings.slice(0, 8).map((warning) => <span key={warning} style={{ display: "block", marginTop: 3 }}>{warning}</span>)}</span></div>}

      {rows.length > 0 && <div className="table-wrap" style={{ border: "1px solid #e5ecea", borderRadius: 12, marginTop: 14 }}>
        <table className="data-table"><thead><tr><th>Patient</th><th>Account</th><th>Last treatment date</th><th>Codes</th><th>Mobile</th><th>Status</th></tr></thead><tbody>{rows.slice(0, 6).map((row, index) => {
          const lastDate = parseDate(valueFor(row, mappings.last_treatment_date));
          const due = lastDate ? isSixMonthRecallDue(lastDate) : false;
          return <tr key={index}><td><strong>{valueFor(row, mappings.patient_name) || "Missing"}</strong></td><td>{valueFor(row, mappings.account_number) || "Missing"}</td><td>{lastDate || "Invalid / missing"}</td><td>{valueFor(row, mappings.last_treatment_code) || "Not supplied"}</td><td>{valueFor(row, mappings.mobile_number) || "Missing"}</td><td><span className={`badge ${validation.length ? "missing" : due ? "high" : "standard"}`}>{validation.length ? "Review" : due ? "Six-month due" : "Not yet due"}</span></td></tr>;
        })}</tbody></table>
      </div>}

      <div className="modal-actions" style={{ borderRadius: 14, marginTop: 16 }}>
        <button className="btn btn-primary" disabled={importing || Boolean(activeImport) || !file || validation.length > 0} onClick={onImport}>{activeImport ? "Import already running" : importing ? "Starting import..." : "Import lead-ready list"}<ArrowRight size={13}/></button>
      </div>
    </div>
  </div>;
}

function ImportProgressPanel({ job }: { job: ImportProgress }) {
  const percentage = Math.max(0, Math.min(100, job.progress || 0));
  return <div className="lead-card" style={{ marginTop: 14, borderColor: "#b7ded8", background: "#f6fbfa" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
      <div><strong style={{ fontFamily: "Manrope", fontSize: 13 }}>Import in progress</strong><p style={{ fontSize: 10, color: "#637774", marginTop: 4 }}>{job.original_name} - {job.imported_rows.toLocaleString()} of {job.row_count.toLocaleString()} spreadsheet rows processed</p></div>
      <span className="badge high">{percentage}%</span>
    </div>
    <div style={{ height: 9, borderRadius: 999, background: "#dcebe8", overflow: "hidden", marginTop: 12 }}>
      <div style={{ width: `${percentage}%`, height: "100%", background: "linear-gradient(90deg,#0b7a75,#58aaa2)", transition: "width .35s ease" }} />
    </div>
    <div className="callout" style={{ marginTop: 12, marginBottom: 0 }}>
      <Info size={14}/><span>This company is locked for new lead imports until the current import finishes. You may safely leave this page and return later.</span>
    </div>
  </div>;
}

function ImportReportsSection({
  jobs,
  companyById,
  branchById,
  onRefresh,
}: {
  jobs: ImportProgress[];
  companyById: Record<string, Company>;
  branchById: Record<string, Branch>;
  onRefresh: () => void | Promise<void>;
}) {
  const [selectedJob, setSelectedJob] = useState<ImportProgress | null>(null);
  return <>
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head">
        <div><div className="card-title">Import reports</div><div className="card-sub">Persistent history for importing, completed and failed lead-ready uploads. Click a row to view status details.</div></div>
        <button className="btn btn-secondary" onClick={() => void onRefresh()}><RotateCcw size={13}/>Refresh</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Import</th><th>Company</th><th>Branch</th><th>Status</th><th>Progress</th><th>Rows uploaded</th><th>Rows processed</th><th>Rejected</th><th>Completed</th><th>Action</th></tr></thead>
          <tbody>{jobs.map((job) => {
            const progress = Math.max(0, Math.min(100, job.progress || 0));
            return <tr key={job.id} onClick={() => setSelectedJob(job)} style={{ cursor: "pointer" }}>
              <td><strong>{job.original_name}</strong><div style={{ fontSize: 8, color: "#82918f", marginTop: 3 }}>{job.id}</div></td>
              <td>{companyById[job.company_id]?.name ?? "Unknown"}</td>
              <td>{job.branch_id ? branchById[job.branch_id]?.name ?? "Unknown" : "Company-wide"}</td>
              <td><span className={`badge ${importStatusClass(job.status)}`}>{importStatusLabel(job.status)}</span></td>
              <td style={{ minWidth: 130 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#617471", marginBottom: 5 }}><span>{progress}%</span><span>{job.imported_rows.toLocaleString()} / {job.row_count.toLocaleString()}</span></div>
                <div style={{ height: 7, borderRadius: 999, background: "#dcebe8", overflow: "hidden" }}><div style={{ width: `${progress}%`, height: "100%", background: job.status === "failed" || job.status === "stalled" ? "#c9656c" : "linear-gradient(90deg,#0b7a75,#58aaa2)" }} /></div>
              </td>
              <td>{job.row_count.toLocaleString()}</td>
              <td>{job.imported_rows.toLocaleString()}</td>
              <td>{job.rejected_rows.toLocaleString()}</td>
              <td>{job.completed_at ? new Date(job.completed_at).toLocaleString() : job.status === "stalled" ? "Stalled - safe to review" : "Still running"}</td>
              <td><button className="btn btn-soft" onClick={(event) => { event.stopPropagation(); setSelectedJob(job); }}>View status</button></td>
            </tr>;
          })}</tbody>
        </table>
        {!jobs.length && <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><FileSpreadsheet size={25}/></div><h2>No import reports yet</h2><p>Once a lead-ready list is imported, progress and completion details will appear here even after completion.</p></div>}
      </div>
    </div>
    {selectedJob && <ImportReportModal job={selectedJob} company={companyById[selectedJob.company_id]?.name ?? "Unknown"} branch={selectedJob.branch_id ? branchById[selectedJob.branch_id]?.name ?? "Unknown" : "Company-wide"} onClose={() => setSelectedJob(null)} />}
  </>;
}

function ImportReportModal({ job, company, branch, onClose }: { job: ImportProgress; company: string; branch: string; onClose: () => void }) {
  const warnings = Array.isArray(job.source_metadata?.warnings) ? job.source_metadata?.warnings as Array<{ row?: number; issues?: string[] }> : [];
  const error = typeof job.source_metadata?.error === "string" ? job.source_metadata.error : "";
  const mappings = job.source_metadata?.mappings && typeof job.source_metadata.mappings === "object" ? job.source_metadata.mappings as Record<string, unknown> : {};
  const progress = Math.max(0, Math.min(100, job.progress || 0));
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><strong>Import status report</strong><button className="icon-btn" onClick={onClose}>x</button></div>
      <div className="modal-body">
        <div className="lead-card" style={{ boxShadow: "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div><strong style={{ fontFamily: "Manrope", fontSize: 13 }}>{job.original_name}</strong><p style={{ fontSize: 10, color: "#6d7f7c", marginTop: 4 }}>{company} - {branch}</p></div>
            <span className={`badge ${importStatusClass(job.status)}`}>{importStatusLabel(job.status)}</span>
          </div>
          <div style={{ height: 9, borderRadius: 999, background: "#dcebe8", overflow: "hidden", marginTop: 12 }}>
            <div style={{ width: `${progress}%`, height: "100%", background: job.status === "failed" || job.status === "stalled" ? "#c9656c" : "linear-gradient(90deg,#0b7a75,#58aaa2)" }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginTop: 12 }}>
          <Metric label="Rows uploaded" value={job.row_count.toLocaleString()} />
          <Metric label="Rows processed" value={job.imported_rows.toLocaleString()} />
          <Metric label="Rejected / skipped" value={job.rejected_rows.toLocaleString()} />
          <Metric label="Progress" value={`${progress}%`} />
        </div>
        {job.status === "stalled" && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850", marginTop: 12 }}><ShieldAlert size={14}/><span>This import stopped updating and is no longer locking new imports. Recall the uploaded list if you want to remove partial records before retrying.</span></div>}
        {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850", marginTop: 12 }}><ShieldAlert size={14}/><span>{error}</span></div>}
        <div className="table-wrap" style={{ border: "1px solid #e5ecea", borderRadius: 12, marginTop: 12 }}>
          <table className="data-table"><tbody>
            <tr><th>Started</th><td>{new Date(job.created_at).toLocaleString()}</td></tr>
            <tr><th>Completed</th><td>{job.completed_at ? new Date(job.completed_at).toLocaleString() : "Still running"}</td></tr>
            <tr><th>Import batch</th><td>{job.id}</td></tr>
            <tr><th>Uploaded file</th><td>{job.uploaded_file_id}</td></tr>
          </tbody></table>
        </div>
        {Object.keys(mappings).length > 0 && <div className="lead-card" style={{ marginTop: 12, boxShadow: "none" }}>
          <strong style={{ fontFamily: "Manrope", fontSize: 12 }}>Confirmed mappings</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 8, marginTop: 10 }}>
            {Object.entries(mappings).map(([target, source]) => <div key={target} style={{ fontSize: 9, color: "#5f716e" }}><strong>{target}</strong><br/>{String(source || "Not mapped")}</div>)}
          </div>
        </div>}
        {warnings.length > 0 && <div className="callout" style={{ background: "#fff8e6", color: "#80611c", marginTop: 12, alignItems: "flex-start" }}><AlertTriangle size={14}/><span><strong>Warnings stored with this import:</strong><br/>{warnings.slice(0, 10).map((warning, index) => <span key={`${warning.row ?? index}-${index}`} style={{ display: "block", marginTop: 3 }}>Row {warning.row ?? "?"}: {(warning.issues ?? []).join(", ")}</span>)}</span></div>}
      </div>
      <div className="modal-actions"><button className="btn btn-primary" onClick={onClose}>Close report</button></div>
    </div>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card teal"><div className="metric-label">{label}</div><div className="metric-value" style={{ fontSize: 20 }}>{value}</div></div>;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

function detectMappings<T extends string>(headers: string[], fields: TargetField<T>[]) {
  const normalizedHeaders = headers.map((header) => ({ header, normalized: normalizeHeader(header) }));
  return Object.fromEntries(fields.map((field) => {
    const aliases = field.aliases.map(normalizeHeader);
    const exact = normalizedHeaders.find((item) => aliases.some((alias) => item.normalized === alias));
    const partial = normalizedHeaders.find((item) => aliases.some((alias) => item.normalized.includes(alias) || alias.includes(item.normalized)));
    return [field.key, exact?.header ?? partial?.header ?? ""];
  })) as Partial<Record<T, string>>;
}

async function readWorkbook(file: File): Promise<Array<{ sheet: string; data: unknown[][] }>> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = await file.text();
    return [{ sheet: "CSV", data: text.split(/\r?\n/).filter(Boolean).map(parseCsvRow) }];
  }
  const readXlsxFile = (await import("read-excel-file/browser")).default;
  const sheets = await readXlsxFile(file) as Array<{ sheet: string; data: unknown[][] }>;
  return sheets.filter((sheet) => sheet.data?.length);
}

function serializableCell(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ?? "";
}

function valueFor<T extends string>(row: Record<string, unknown>, header?: string) {
  return header ? String(row[header] ?? "").trim() : "";
}

function cleanupValue(row: Record<string, unknown>, mappings: Partial<Record<CleanupField, string>>, field: CleanupField) {
  return valueFor(row, mappings[field]);
}

function parseDate(value: unknown) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const fullYear = Number(year.length === 2 ? `20${year}` : year);
  const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function parseAmount(value: unknown) {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
  if (!cleaned) return 0;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function cleanPhone(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("27") && digits.length === 11) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+27${digits.slice(1)}`;
  if (digits.length === 9) return `+27${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return "";
}

function isMobileLooking(value: string) {
  return /^\+27[678]/.test(value);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isSixMonthRecallDue(lastTreatmentDate: string) {
  return lastTreatmentDate <= addMonths(new Date(), -6).toISOString().slice(0, 10);
}

function cleanupToLeadRows(datasets: CleanupDataset[]) {
  const exceptionRows: ReportRow[] = [];
  const duplicateRows: ReportRow[] = [];
  const groups = new Map<string, Array<{
    source: string;
    rowNumber: number;
    patientName: string;
    accountHolder: string;
    accountNumber: string;
    date: string | null;
    treatmentCode: string;
    treatmentDescription: string;
    amount: number;
    contacts: string[];
    medicalAidName: string;
    medicalAidOption: string;
  }>>();
  const signatures = new Map<string, string>();
  let totalRows = 0;
  let transactionRowsAnalysed = 0;

  for (const dataset of datasets) {
    dataset.rows.forEach((row, index) => {
      totalRows += 1;
      const source = `${dataset.fileName} / ${dataset.sheetName}`;
      const rowNumber = index + 2;
      const values = Object.fromEntries(cleanupFields.map((field) => [field.key, cleanupValue(row, dataset.mappings, field.key)])) as Record<CleanupField, string>;
      const signature = JSON.stringify(values);
      const existingSignature = signatures.get(signature);
      if (existingSignature) {
        duplicateRows.push({ Source: source, Row: rowNumber, "Duplicate Of": existingSignature, Reason: "Mapped row values are identical" });
        return;
      }
      signatures.set(signature, `${source} row ${rowNumber}`);

      const patientName = values.patient_name || values.account_holder;
      const accountHolder = values.account_holder;
      const accountNumber = values.account_number;
      const date = parseDate(values.transaction_date);
      const treatmentCode = values.treatment_code.toUpperCase();
      const treatmentDescription = values.treatment_description;
      const amount = parseAmount(values.amount_charged);
      const contacts = [values.cellphone_number, values.telephone_number, values.private_number, values.alternative_number].map(cleanPhone).filter(Boolean);
      const issues: string[] = [];

      if (!patientName) issues.push("Missing patient name");
      if (!accountNumber) issues.push("Missing account number");
      if (!contacts.length) issues.push("Missing contact number");
      if (values.transaction_date && !date) issues.push("Invalid date");
      if (treatmentCode && !/^[A-Z0-9 ._-]+$/i.test(treatmentCode)) issues.push("Invalid treatment code");
      if (!values.patient_name && values.account_holder) issues.push("Patient name filled from account holder");
      if (!accountNumber && patientName) issues.push("Low-confidence match; account number is required for upload-ready output");
      if (issues.length) exceptionRows.push({ Source: source, Row: rowNumber, "Patient Name": patientName || "", "Account Number": accountNumber || "", Reason: issues.join("; ") });

      if (!patientName || !accountNumber) return;
      if (date || treatmentCode || treatmentDescription || amount) transactionRowsAnalysed += 1;

      const groupKey = `account:${normalizeKey(accountNumber)}`;
      const current = groups.get(groupKey) ?? [];
      current.push({
        source,
        rowNumber,
        patientName,
        accountHolder,
        accountNumber,
        date,
        treatmentCode,
        treatmentDescription,
        amount,
        contacts,
        medicalAidName: values.medical_aid_name,
        medicalAidOption: values.medical_aid_option,
      });
      groups.set(groupKey, current);
    });
  }

  const leadRows: LeadReadyRow[] = [];
  let matchedContactRecords = 0;
  let unmatchedRecords = 0;
  let missingContactRecords = 0;

  for (const rows of groups.values()) {
    const first = rows[0];
    const names = Array.from(new Set(rows.map((row) => normalizeKey(row.patientName)).filter(Boolean)));
    if (names.length > 1) {
      exceptionRows.push({ Source: "Merged patient group", Row: first.rowNumber, "Patient Name": rows.map((row) => row.patientName).join(" | "), "Account Number": first.accountNumber, Reason: "Conflicting patient names share the same account number; review before trusting merged output" });
    }

    const datedRows = rows.filter((row) => row.date);
    if (!datedRows.length) {
      unmatchedRecords += rows.length;
      exceptionRows.push({ Source: "Merged patient group", Row: first.rowNumber, "Patient Name": first.patientName, "Account Number": first.accountNumber, Reason: "No valid treatment or visit date found; row excluded from upload-ready output" });
      continue;
    }
    const lastDate = datedRows.map((row) => row.date).sort().at(-1)!;
    const lastDateRows = rows.filter((row) => row.date === lastDate);
    const codes = Array.from(new Set(lastDateRows.map((row) => row.treatmentCode).filter(Boolean))).join(", ");
    const descriptions = Array.from(new Set(lastDateRows.map((row) => row.treatmentDescription).filter(Boolean))).join("; ");
    const total = lastDateRows.reduce((sum, row) => sum + row.amount, 0);
    const allContacts = Array.from(new Set(rows.flatMap((row) => row.contacts))).filter(Boolean);
    const mobile = allContacts.find(isMobileLooking) ?? allContacts[0] ?? "";
    const alternative = allContacts.filter((contact) => contact !== mobile)[0] ?? "";
    if (mobile || alternative) matchedContactRecords += 1;
    else missingContactRecords += 1;

    const medicalAidName = rows.find((row) => row.medicalAidName)?.medicalAidName ?? "";
    const medicalAidOption = rows.find((row) => row.medicalAidOption)?.medicalAidOption ?? "";
    leadRows.push({
      "Patient Name": first.patientName,
      "Account Number": first.accountNumber,
      "Last Treatment Date": lastDate,
      "Last Treatment Code": codes,
      "Last Treatment Description": descriptions,
      "Mobile Number": mobile,
      "Alternative Number": alternative,
      "Medical Aid Name": medicalAidName,
      "Medical Aid Option / Plan": medicalAidOption,
      "Last Visit Total Amount Charged": total ? total.toFixed(2) : "",
    });
  }

  const summaryRows: ReportRow[] = [
    { Metric: "Total uploaded rows", Value: totalRows },
    { Metric: "Total unique patients/leads produced", Value: leadRows.length },
    { Metric: "Total transaction rows analysed", Value: transactionRowsAnalysed },
    { Metric: "Total duplicate rows removed", Value: duplicateRows.length },
    { Metric: "Total matched contact records", Value: matchedContactRecords },
    { Metric: "Total unmatched records", Value: unmatchedRecords },
    { Metric: "Total records missing contact numbers", Value: missingContactRecords },
    { Metric: "Total records requiring manual review", Value: exceptionRows.length },
  ];

  return { leadRows, exceptionRows, duplicateRows, summaryRows };
}

function validateLeadImportReadiness(companyId: string, file: { name: string } | null, rows: Record<string, unknown>[], mappings: Partial<Record<LeadField, string>>) {
  const issues: string[] = [];
  if (!companyId) issues.push("Company is required.");
  if (!file) issues.push("Lead-ready spreadsheet is required.");
  const headers = Object.keys(rows[0] ?? {});
  const headerSet = new Set(headers);
  for (const field of leadFields.filter((item) => item.required)) {
    if (!mappings[field.key]) issues.push(`${field.label} must be mapped.`);
  }
  for (const [field, source] of Object.entries(mappings)) {
    if (source && !headerSet.has(source)) issues.push(`${field} is mapped to a column that does not exist: ${source}`);
  }
  const selected = Object.values(mappings).filter(Boolean);
  const duplicates = selected.filter((value, index) => selected.indexOf(value) !== index);
  if (duplicates.length) issues.push(`One source column cannot be used for multiple fields: ${Array.from(new Set(duplicates)).join(", ")}`);
  rows.slice(0, 500).forEach((row, index) => {
    const rowNumber = index + 2;
    if (!valueFor(row, mappings.patient_name)) issues.push(`Row ${rowNumber}: Patient Name is blank.`);
    if (!valueFor(row, mappings.account_number)) issues.push(`Row ${rowNumber}: Account Number is blank.`);
    const lastDate = valueFor(row, mappings.last_treatment_date);
    if (!lastDate || !parseDate(lastDate)) issues.push(`Row ${rowNumber}: Last Treatment Date is invalid or blank.`);
    const mobile = valueFor(row, mappings.mobile_number);
    if (mobile && !cleanPhone(mobile)) issues.push(`Row ${rowNumber}: Mobile Number format is invalid.`);
    const alternative = valueFor(row, mappings.alternative_number);
    if (alternative && !cleanPhone(alternative)) issues.push(`Row ${rowNumber}: Alternative Number format is invalid.`);
    const amount = valueFor(row, mappings.last_visit_total_amount_charged);
    if (amount && Number.isNaN(Number(amount.replace(/[^\d.-]/g, "")))) issues.push(`Row ${rowNumber}: Last Visit Total Amount Charged must be numeric.`);
  });
  return Array.from(new Set(issues));
}

function leadImportWarnings(rows: Record<string, unknown>[], mappings: Partial<Record<LeadField, string>>) {
  const warnings: string[] = [];
  const recommended = leadFields.filter((field) => !field.required);
  for (const field of recommended) {
    if (!mappings[field.key]) warnings.push(`${field.label} is recommended but not mapped.`);
  }
  rows.slice(0, 100).forEach((row, index) => {
    const mobile = valueFor(row, mappings.mobile_number);
    const alternative = valueFor(row, mappings.alternative_number);
    if (!mobile && !alternative) warnings.push(`Row ${index + 2}: Patient telephone must be added manually. Import is allowed and the recall lead will stay active.`);
    else if (!mobile) warnings.push(`Row ${index + 2}: Mobile Number is missing. Alternative Number will be used if available.`);
  });
  return Array.from(new Set(warnings));
}

function normalizeKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function emptyLeadReadyRow(): LeadReadyRow {
  return {
    "Patient Name": "",
    "Account Number": "",
    "Last Treatment Date": "",
    "Last Treatment Code": "",
    "Last Treatment Description": "",
    "Mobile Number": "",
    "Alternative Number": "",
    "Medical Aid Name": "",
    "Medical Aid Option / Plan": "",
    "Last Visit Total Amount Charged": "",
  };
}

function downloadCsv(fileName: string, rows: Record<string, unknown>[], preferredColumns?: readonly string[]) {
  const columns = preferredColumns?.length ? [...preferredColumns] : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const body = [columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))]
    .map((line) => line.map(csvCell).join(","))
    .join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function fileHash(file: File) {
  if (!crypto.subtle) return null;
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}
