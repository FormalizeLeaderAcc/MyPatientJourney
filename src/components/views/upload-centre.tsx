"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Building2, Check, CheckCircle2, ChevronRight, FileSpreadsheet, Info, LoaderCircle, RotateCcw, ShieldAlert, Sparkles, Trash2, UploadCloud } from "lucide-react";
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

type TargetField = {
  key: SystemField;
  label: string;
  requiredFor: UploadType[];
  aliases: string[];
};

const targetFields: TargetField[] = [
  { key: "patient_name", label: "Patient name", requiredFor: ["transactions", "curated_contacts"], aliases: ["patient name", "patient full name", "name", "member name"] },
  { key: "account_number", label: "Account number", requiredFor: ["transactions", "curated_contacts"], aliases: ["account number", "account no", "account", "patient number", "file number"] },
  { key: "cellphone_number", label: "Cellphone number", requiredFor: ["curated_contacts"], aliases: ["cellphone", "cellphone number", "mobile", "mobile number", "phone", "contact number"] },
  { key: "alternate_number", label: "Alternate number", requiredFor: [], aliases: ["alternate number", "alt phone", "home phone", "work phone"] },
  { key: "whatsapp_number", label: "WhatsApp number", requiredFor: [], aliases: ["whatsapp", "whatsapp number", "wa number"] },
  { key: "email", label: "Email address", requiredFor: [], aliases: ["email", "email address", "patient email"] },
  { key: "medical_aid_name", label: "Medical aid name", requiredFor: [], aliases: ["medical aid", "medical aid name", "scheme", "scheme name"] },
  { key: "medical_aid_option", label: "Medical aid option", requiredFor: [], aliases: ["medical aid option", "option", "plan", "benefit option"] },
  { key: "transaction_date", label: "Transaction date", requiredFor: ["transactions"], aliases: ["transaction date", "txn date", "date", "service date", "treatment date"] },
  { key: "treatment_code", label: "Treatment code", requiredFor: ["transactions"], aliases: ["treatment code", "code", "tariff code", "procedure code"] },
  { key: "branch", label: "Branch", requiredFor: [], aliases: ["branch", "practice branch", "location", "practice"] },
  { key: "practitioner", label: "Practitioner", requiredFor: [], aliases: ["practitioner", "provider", "doctor", "dentist"] },
  { key: "amount_charged", label: "Amount charged", requiredFor: [], aliases: ["amount charged", "amount", "charge", "fee"] },
  { key: "last_visit_date", label: "Last visit date", requiredFor: [], aliases: ["last visit date", "last visit", "last seen"] },
  { key: "last_8101_date", label: "Last 8101 date", requiredFor: [], aliases: ["last 8101", "last 8101 date", "consultation date"] },
  { key: "last_8159_date", label: "Last 8159 date", requiredFor: [], aliases: ["last 8159", "last 8159 date", "oral hygiene date", "scaling date"] },
  { key: "notes", label: "Notes", requiredFor: [], aliases: ["notes", "comment", "comments", "remarks"] },
  { key: "priority", label: "Priority", requiredFor: [], aliases: ["priority", "priority tag", "recall priority"] },
];

export function UploadCentre({ notify }: { notify: (message: string) => void }) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<UploadType>("transactions");
  const [file, setFile] = useState<{ name: string; size: string; rowCount: number; hash: string | null } | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mappings, setMappings] = useState<Partial<Record<SystemField, string>>>({});
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [uploadedLists, setUploadedLists] = useState<UploadedList[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [listToRecall, setListToRecall] = useState<UploadedList | null>(null);
  const [recallReason, setRecallReason] = useState("");
  const [recalling, setRecalling] = useState(false);
  const [error, setError] = useState("");
  const [validationDetails, setValidationDetails] = useState<string[]>([]);
  const [importResult, setImportResult] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
  }

  useEffect(() => { void loadScopeData(); }, []);

  function resetFileState() {
    setFile(null);
    setHeaders([]);
    setRows([]);
    setMappings({});
    setValidationDetails([]);
    setImportResult("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function detectMappings(detectedHeaders: string[]) {
    const normalizedHeaders = detectedHeaders.map((header) => ({ header, normalized: normalizeHeader(header) }));
    return Object.fromEntries(targetFields.map((field) => {
      const exact = normalizedHeaders.find((item) => field.aliases.some((alias) => item.normalized === normalizeHeader(alias)));
      const partial = normalizedHeaders.find((item) => field.aliases.some((alias) => item.normalized.includes(normalizeHeader(alias)) || normalizeHeader(alias).includes(item.normalized)));
      return [field.key, exact?.header ?? partial?.header ?? ""];
    })) as Partial<Record<SystemField, string>>;
  }

  async function readFile(selected: File) {
    if (!companyId) {
      notify("Select the company before uploading. Patient lists must be locked to one company.");
      return;
    }
    setProcessing(true);
    setError("");
    setValidationDetails([]);
    setImportResult("");
    try {
      let matrix: unknown[][];
      if (selected.name.toLowerCase().endsWith(".csv")) {
        const text = await selected.text();
        matrix = text.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
      } else {
        const { readSheet } = await import("read-excel-file/browser");
        matrix = (await readSheet(selected)) as unknown[][];
      }
      const detectedHeaders = (matrix[0] ?? []).map((value) => String(value ?? "").trim()).filter(Boolean);
      if (!detectedHeaders.length) throw new Error("No header row found.");
      const parsed = matrix.slice(1)
        .map((row) => Object.fromEntries(detectedHeaders.map((header, index) => [header, serializableCell(row[index])])));
      const hash = await fileHash(selected);
      const nextMappings = detectMappings(detectedHeaders);
      setHeaders(detectedHeaders);
      setRows(parsed);
      setMappings(nextMappings);
      setFile({ name: selected.name, size: `${(selected.size / 1024).toFixed(1)} KB`, rowCount: parsed.length, hash });
      notify(`${parsed.length.toLocaleString()} rows detected and locked to ${companyById[companyId]?.name ?? "selected company"}`);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "We could not read that spreadsheet. Please check the file format.");
    } finally {
      setProcessing(false);
    }
  }

  function validateImportReadiness() {
    const issues: string[] = [];
    if (!companyId) issues.push("Company is required.");
    if (!file) issues.push("Spreadsheet file is required.");
    const required = targetFields.filter((field) => field.requiredFor.includes(type));
    for (const field of required) {
      if (!mappings[field.key]) issues.push(`${field.label} must be mapped.`);
    }
    const selected = Object.values(mappings).filter(Boolean);
    const duplicates = selected.filter((value, index) => selected.indexOf(value) !== index);
    if (duplicates.length) issues.push(`One source column cannot be used for multiple fields: ${Array.from(new Set(duplicates)).join(", ")}`);
    rows.slice(0, 100).forEach((row, index) => {
      for (const field of required) {
        const source = mappings[field.key];
        if (source && !String(row[source] ?? "").trim()) issues.push(`Row ${index + 2}: ${field.label} is blank.`);
      }
      if (type === "transactions") {
        const dateSource = mappings.transaction_date;
        const codeSource = mappings.treatment_code;
        if (dateSource && !parseDate(row[dateSource])) issues.push(`Row ${index + 2}: Transaction date is invalid.`);
        if (codeSource && !String(row[codeSource] ?? "").trim().match(/^\d{3,8}[A-Z]?$/i)) issues.push(`Row ${index + 2}: Treatment code is invalid.`);
      }
    });
    return Array.from(new Set(issues));
  }

  async function importSpreadsheet() {
    const issues = validateImportReadiness();
    setValidationDetails(issues.slice(0, 25));
    if (issues.length) {
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
        upload_type: type,
        original_name: file?.name,
        file_hash: file?.hash,
        mappings,
        rows,
      }),
    });
    const result = await response.json();
    setImporting(false);
    if (!response.ok) {
      setError(result.error ?? "Import failed.");
      const details = result.details as { mappingIssues?: string[]; rejectedRows?: Array<{ row: number; issues: string[] }> } | undefined;
      setValidationDetails([
        ...(details?.mappingIssues ?? []),
        ...(details?.rejectedRows ?? []).map((row) => `Row ${row.row}: ${row.issues.join(", ")}`),
      ].slice(0, 25));
      return;
    }
    setImportResult(result.message ?? "Import completed");
    notify(result.message ?? "Import completed");
    await loadScopeData();
  }

  async function recallUploadedList() {
    if (!listToRecall) return;
    if (recallReason.trim().length < 8) {
      setError("Please enter a clear reason before recalling this uploaded list.");
      return;
    }
    setRecalling(true);
    setError("");
    const response = await fetch("/api/admin/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recall_uploaded_list", uploaded_file_id: listToRecall.id, reason: recallReason }),
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
    await loadScopeData();
  }

  const companyById = useMemo(() => Object.fromEntries(companies.map((company) => [company.id, company])), [companies]);
  const branchById = useMemo(() => Object.fromEntries(branches.map((branch) => [branch.id, branch])), [branches]);
  const scopedBranches = branches.filter((branch) => branch.company_id === companyId);
  const scopedUploadedLists = uploadedLists.filter((item) => !companyId || item.company_id === companyId);
  const requiredMappedCount = targetFields.filter((field) => field.requiredFor.includes(type) && mappings[field.key]).length;
  const totalRequired = targetFields.filter((field) => field.requiredFor.includes(type)).length;
  const optionalMappedCount = targetFields.filter((field) => !field.requiredFor.includes(type) && mappings[field.key]).length;
  const steps = [[1,"Choose data","Select upload type"],[2,"Upload file","XLSX or CSV"],[3,"Map columns","Confirm detected fields"],[4,"Validate import","Review mapped data"],[5,"Import & generate","Persist records"]];

  return <>
    <div className="page-head"><div><h1>Upload Centre</h1><p>Bring transaction history or a curated contact list into a traceable recall campaign.</p></div><button className="btn btn-secondary" onClick={resetFileState}><RotateCcw size={14} />Reset upload</button></div>
    {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldAlert size={14}/><span>{error}</span></div>}
    {validationDetails.length > 0 && <div className="callout" style={{ background: "#fff4ed", color: "#8a5a1f", alignItems: "flex-start" }}><ShieldAlert size={14}/><span><strong>Validation feedback:</strong><br/>{validationDetails.slice(0, 10).map((issue) => <span key={issue} style={{ display: "block", marginTop: 3 }}>{issue}</span>)}</span></div>}
    {importResult && <div className="callout" style={{ background: "#edf8f4", color: "#2e765f" }}><CheckCircle2 size={14}/><span>{importResult}</span></div>}

    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head"><div><div className="card-title">Company isolation boundary</div><div className="card-sub">Every upload is locked to one company before file handling begins.</div></div></div>
      <div className="card-body form-grid">
        <div className="form-field"><label>Company *</label><select className="form-control" value={companyId} onChange={(event) => { setCompanyId(event.target.value); setBranchId(""); resetFileState(); }} required><option value="">Select company before upload</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
        <div className="form-field"><label>Branch</label><select className="form-control" value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={!companyId}><option value="">Company-wide / detect from file</option>{scopedBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>
        <div className="form-field full"><div className="callout" style={{ margin: 0 }}><Building2 size={14}/><span>Safety rail: branch choices are filtered by company, and the database migration rejects cross-company leads, transactions, imports and assignments.</span></div></div>
      </div>
    </div>

    <div className="upload-shell">
      <div className="card upload-steps">{steps.map(([num,title,sub]) => <div className={`upload-step ${step === num ? "active" : step > Number(num) ? "done" : ""}`} key={title}><div className="step-num">{step > Number(num) ? <Check size={11} /> : num}</div><div><strong>{title}</strong><span>{sub}</span></div></div>)}</div>
      <div className="card">
        <div className="card-head"><div><div className="card-title">{step === 1 ? "What would you like to upload?" : step === 2 ? "Add your spreadsheet" : step === 3 ? "Confirm column mapping" : step === 4 ? "Review validation" : "Import and generate recall work"}</div><div className="card-sub">Step {step} of 5 - Source data remains separate from operational leads</div></div></div>
        <div className="card-body">
          {step === 1 && <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:13}}>
            <button onClick={() => { setType("transactions"); resetFileState(); }} className="lead-card" style={{textAlign:"left",borderColor:type === "transactions" ? "#58aaa2" : undefined,background:type === "transactions" ? "#f5fbf9" : undefined}}><div className="drop-icon" style={{margin:"0 0 15px"}}><FileSpreadsheet size={22} /></div><strong style={{fontFamily:"Manrope",fontSize:13}}>Dental transaction spreadsheet</strong><p style={{fontSize:9,lineHeight:1.6,color:"#7e908d"}}>Analyse treatment codes 8101 and 8159, visit dates, medical aid options and patient activity.</p><span className="badge standard">Recommended for recall analysis</span></button>
            <button onClick={() => { setType("curated_contacts"); resetFileState(); }} className="lead-card" style={{textAlign:"left",borderColor:type === "curated_contacts" ? "#58aaa2" : undefined,background:type === "curated_contacts" ? "#f5fbf9" : undefined}}><div className="drop-icon" style={{margin:"0 0 15px"}}><Sparkles size={22} /></div><strong style={{fontFamily:"Manrope",fontSize:13}}>Curated contact spreadsheet</strong><p style={{fontSize:9,lineHeight:1.6,color:"#7e908d"}}>Import a prepared patient follow-up list with dates, notes, priority and contact details.</p><span className="badge high">Ready follow-up list</span></button>
          </div>}
          {step === 2 && <><input ref={inputRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && readFile(event.target.files[0])} /><div className="dropzone" onClick={() => companyId ? inputRef.current?.click() : notify("Select a company before choosing a spreadsheet.")} style={{ opacity: companyId ? 1 : 0.58 }}><div className="drop-icon">{processing ? <LoaderCircle size={24} className="animate-spin" /> : <UploadCloud size={24} />}</div><h3>{companyId ? "Drop a spreadsheet here, or browse" : "Select a company first"}</h3><p>Supports .XLSX, .XLS and .CSV - maximum 25 MB</p><button className="btn btn-soft" type="button" disabled={!companyId}>Choose spreadsheet</button></div>{file && <div className="file-row"><div className="file-icon"><FileSpreadsheet size={19} /></div><div><strong>{file.name}</strong><span>{file.size} - {file.rowCount.toLocaleString()} rows detected - {companyById[companyId]?.name}</span></div><CheckCircle2 style={{marginLeft:"auto",color:"#3b9b7c"}} size={18} /></div>}<div className="callout" style={{marginTop:14,marginBottom:0}}><Info size={14} /><span>Rows are parsed in the browser, then persisted through a server-side import that creates the upload file, import batch, mappings, patients, contacts, transactions, leads and audit log.</span></div></>}
          {step === 3 && <><div className="mapping-list">{targetFields.map((field) => <div className="mapping-row" key={field.key}><div className="mapping-source">{field.label}{field.requiredFor.includes(type) ? " *" : ""}</div><ChevronRight className="mapping-arrow" size={14} /><select className="form-control" value={mappings[field.key] ?? ""} onChange={(event) => setMappings((current) => ({ ...current, [field.key]: event.target.value }))}><option value="">Not mapped</option>{headers.map(h=><option key={h} value={h}>{h}</option>)}</select></div>)}</div><div className="mapping-status"><CheckCircle2 size={13} /> Required mapped: {requiredMappedCount} of {totalRequired}. Optional mapped: {optionalMappedCount}. Confirm mappings before import.</div></>}
          {step === 4 && <><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:15}}>{[["Rows detected",file?.rowCount.toLocaleString() ?? "0"],["Preview rows",String(Math.min(rows.length, 5))],["Required mapped",`${requiredMappedCount}/${totalRequired}`],["Validation issues",String(validateImportReadiness().length)]].map(item=><div className="metric-card teal" key={item[0]}><div className="metric-label">{item[0]}</div><div className="metric-value" style={{fontSize:20}}>{item[1]}</div></div>)}</div>{rows.length ? <div className="table-wrap" style={{border:"1px solid #e5ecea",borderRadius:12}}><table className="data-table"><thead><tr><th>Patient</th><th>Account</th><th>Contact</th><th>{type === "transactions" ? "Date" : "Last visit"}</th><th>{type === "transactions" ? "Code" : "Priority"}</th><th>Validation</th></tr></thead><tbody>{rows.slice(0,5).map((row,i)=><tr key={i}><td><strong>{valueFor(row, mappings.patient_name) || "Missing"}</strong></td><td>{valueFor(row, mappings.account_number) || "Missing"}</td><td>{valueFor(row, mappings.cellphone_number) || "Not supplied"}</td><td>{valueFor(row, type === "transactions" ? mappings.transaction_date : mappings.last_visit_date) || "Not supplied"}</td><td>{valueFor(row, type === "transactions" ? mappings.treatment_code : mappings.priority) || "Not supplied"}</td><td><span className={`badge ${validateImportReadiness().length ? "missing" : "standard"}`}>{validateImportReadiness().length ? "Review" : "Ready"}</span></td></tr>)}</tbody></table></div> : <div className="card empty-page"><div className="empty-icon"><FileSpreadsheet size={24}/></div><h2>No file rows to preview</h2><p>Upload a spreadsheet before importing patient source data.</p></div>}</>}
          {step === 5 && <><div className="card" style={{boxShadow:"none"}}><div className="card-body"><Sparkles size={22} color="#0b7a75" /><h3 style={{fontFamily:"Manrope",fontSize:14}}>Ready for production import</h3><p style={{fontSize:9,color:"#758885",lineHeight:1.6}}>This will create an uploaded file record, import batch, confirmed mappings, source records and patient follow-up leads for {companyById[companyId]?.name ?? "the selected company"}.</p><button className="btn btn-primary" style={{marginTop:12}} disabled={importing || !file} onClick={importSpreadsheet}>{importing ? "Importing..." : "Import and generate recall work"}<ArrowRight size={13}/></button></div></div><div className="callout" style={{marginTop:14,marginBottom:0}}><Info size={14}/><span>Traceability: every generated lead is linked to the import batch and uploaded file that created it. The audit log records the import summary.</span></div></>}
        </div>
        <div className="modal-actions" style={{borderRadius:"0 0 18px 18px"}}>{step > 1 && <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>Back</button>}<button className="btn btn-primary" disabled={!companyId || ((step === 2 || step === 3 || step === 4) && !file)} onClick={() => { if(step === 4) setValidationDetails(validateImportReadiness().slice(0, 25)); if(step < 5) setStep(step + 1); else void importSpreadsheet(); }}>{step === 5 ? "Import now" : "Continue"}<ArrowRight size={13} /></button></div>
      </div>
    </div>

    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head"><div><div className="card-title">Recall / withdraw uploaded lists</div><div className="card-sub">Primary Super User only. This removes one selected list and records the reason in the audit log.</div></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>List</th><th>Company</th><th>Branch</th><th>Type</th><th>Rows</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>{scopedUploadedLists.map((item) => <tr key={item.id}><td><strong>{item.original_name}</strong></td><td>{companyById[item.company_id]?.name ?? "Unknown"}</td><td>{item.branch_id ? branchById[item.branch_id]?.name ?? "Unknown" : "Company-wide"}</td><td>{item.upload_type}</td><td>{item.row_count ?? "-"}</td><td>{new Date(item.created_at).toLocaleDateString()}</td><td><button className="btn btn-danger-soft" onClick={() => setListToRecall(item)}><Trash2 size={12}/>Recall list</button></td></tr>)}</tbody></table>{!scopedUploadedLists.length && <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><FileSpreadsheet size={25}/></div><h2>No uploaded lists found</h2><p>Persisted live imports will appear here for controlled recall/withdrawal.</p></div>}</div>
    </div>

    {listToRecall && <div className="modal-backdrop" onClick={() => setListToRecall(null)}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><strong>Recall uploaded list</strong><button className="icon-btn" onClick={() => setListToRecall(null)}>x</button></div><div className="modal-body"><div className="callout" style={{ background: "#fff4ed" }}><ShieldAlert size={14}/><span>This is destructive and primary-Super-User-only. It removes records created from this list only; audit history remains.</span></div><p style={{ fontSize: 11, color: "#657875", lineHeight: 1.6 }}><strong>{listToRecall.original_name}</strong><br/>{companyById[listToRecall.company_id]?.name ?? "Unknown company"} - {listToRecall.row_count ?? 0} rows</p><div className="form-field"><label>Reason for recall *</label><textarea className="form-control" value={recallReason} onChange={(event) => setRecallReason(event.target.value)} placeholder="Example: Wrong company list uploaded in error"/></div></div><div className="modal-actions"><button className="btn btn-secondary" onClick={() => setListToRecall(null)}>Cancel</button><button className="btn btn-danger-soft" disabled={recalling || recallReason.trim().length < 8} onClick={recallUploadedList}>{recalling ? "Recalling..." : "Confirm recall"}</button></div></div></div>}
  </>;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

function serializableCell(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ?? "";
}

function valueFor(row: Record<string, unknown>, header?: string) {
  return header ? String(row[header] ?? "").trim() : "";
}

function parseDate(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  const match = String(value).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const fullYear = Number(year.length === 2 ? `20${year}` : year);
  const date = new Date(Date.UTC(fullYear, Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
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
