"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, CheckCircle2, FileSpreadsheet, LoaderCircle, Search, ShieldCheck, Sparkles, UploadCloud } from "lucide-react";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Company = { id: string; name: string };
type Scheme = { id: string; company_id: string | null; name: string; notes: string | null };
type Option = { id: string; scheme_id: string; option_name: string; quality_score: number; category: string; notes: string | null; updated_at: string };
type ImportRow = { scheme_name: string; option_name: string; quality_score: number; category: "unknown" | "low" | "medium" | "high" | "premium"; notes?: string | null };

const templateHeaders = ["scheme_name", "option_name", "quality_score", "category", "notes"];
const categoryOptions = ["unknown", "low", "medium", "high", "premium"] as const;

export function MedicalAidView({ notify }: { notify:(message:string)=>void }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [options, setOptions] = useState<Option[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadData() {
    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseBrowserClient();
    const [companyResult, schemeResult, optionResult] = await Promise.all([
      supabase.from("companies").select("id,name").order("name"),
      supabase.from("medical_aid_schemes").select("id,company_id,name,notes").order("name"),
      supabase.from("medical_aid_options").select("id,scheme_id,option_name,quality_score,category,notes,updated_at").order("quality_score", { ascending: false }),
    ]);
    if (companyResult.data) setCompanies(companyResult.data);
    if (schemeResult.data) setSchemes(schemeResult.data as Scheme[]);
    if (optionResult.data) setOptions(optionResult.data as Option[]);
  }

  useEffect(() => { void loadData(); }, []);

  function downloadTemplate() {
    const allRows = [templateHeaders];
    const xmlRows = allRows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join("")}</Row>`).join("");
    const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Medical Aid Scoring"><Table>${xmlRows}</Table></Worksheet>
</Workbook>`;
    const blob = new Blob([workbook], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "medical-aid-intelligence-template.xls";
    link.click();
    URL.revokeObjectURL(url);
    notify("Medical aid Excel template downloaded");
  }

  async function readFile(selected: File) {
    setProcessing(true);
    setError("");
    setRows([]);
    setFileName(selected.name);
    try {
      let matrix: unknown[][];
      if (selected.name.toLowerCase().endsWith(".csv")) {
        const text = await selected.text();
        matrix = text.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
      } else {
        const { readSheet } = await import("read-excel-file/browser");
        matrix = (await readSheet(selected)) as unknown[][];
      }
      const headers = (matrix[0] ?? []).map((value) => normalizeHeader(String(value)));
      const parsed = matrix.slice(1).map((row) => {
        const item = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
        return {
          scheme_name: String(item.scheme_name ?? item.scheme ?? "").trim(),
          option_name: String(item.option_name ?? item.option ?? "").trim(),
          quality_score: Number(item.quality_score ?? item.score ?? 0),
          category: normalizeCategory(String(item.category ?? "")),
          notes: String(item.notes ?? "").trim() || null,
        } satisfies ImportRow;
      }).filter((row) => row.scheme_name || row.option_name);

      const validation = validateRows(parsed);
      if (validation.length) {
        setError(validation.slice(0, 4).join(" · "));
      }
      setRows(parsed);
      notify(`${parsed.length} medical aid scoring row(s) detected`);
    } catch {
      setError("We could not read that medical aid spreadsheet.");
    } finally {
      setProcessing(false);
    }
  }

  async function importRows() {
    const validation = validateRows(rows);
    if (validation.length) {
      setError(validation.slice(0, 4).join(" · "));
      return;
    }
    setSaving(true);
    setError("");
    const response = await fetch("/api/admin/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "import_medical_aids", company_id: companyId || null, original_name: fileName || "medical-aid-import.xlsx", rows }),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to import medical aid scoring rows.");
      return;
    }
    notify(result.message ?? "Medical aid scoring imported");
    setRows([]);
    setFileName("");
    await loadData();
  }

  const schemeById = useMemo(() => Object.fromEntries(schemes.map((scheme) => [scheme.id, scheme])), [schemes]);
  const visibleOptions = options.filter((option) => {
    const scheme = schemeById[option.scheme_id];
    const matchesCompany = !companyId || !scheme?.company_id || scheme.company_id === companyId;
    const matchesQuery = !query || `${scheme?.name ?? ""} ${option.option_name}`.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = category === "All categories" || option.category.toLowerCase() === category.toLowerCase();
    return matchesCompany && matchesQuery && matchesCategory;
  });
  const premiumCount = visibleOptions.filter((option) => ["premium", "high"].includes(option.category)).length;
  const averageScore = visibleOptions.length ? Math.round(visibleOptions.reduce((sum, option) => sum + option.quality_score, 0) / visibleOptions.length) : null;

  return <>
    <div className="page-head"><div><h1>Medical Aid Intelligence</h1><p>Configurable opportunity scoring — kept in your database, never buried in code.</p></div><div className="head-actions"><button className="btn btn-secondary" onClick={downloadTemplate}><ArrowDownToLine size={14}/>Download Template</button><button className="btn btn-primary" onClick={()=>inputRef.current?.click()}><UploadCloud size={14}/>Import Excel</button></div></div>
    {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldCheck size={14}/><span>{error}</span></div>}
    <input ref={inputRef} hidden type="file" accept=".xlsx,.xls,.csv" onChange={(event) => event.target.files?.[0] && readFile(event.target.files[0])}/>

    <div className="metric-grid" style={{gridTemplateColumns:"repeat(4,1fr)"}}>{[["Configured options",String(visibleOptions.length),"Scoring rows available"],["Premium/high options",String(premiumCount),"Prioritises better recall opportunities"],["Pending import rows",String(rows.length),"Validated before saving"],["Average quality score",averageScore === null ? "—" : String(averageScore),"Across visible options"]].map((row,i)=><div className={`metric-card ${["teal","orange","rose","violet"][i]}`} key={row[0]}><div className="metric-label">{row[0]}</div><div className="metric-value">{row[1]}</div><div className="metric-trend">{row[2]}</div></div>)}</div>

    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head"><div><div className="card-title">Import medical aid scoring</div><div className="card-sub">Required fields: scheme_name, option_name, quality_score, category, notes.</div></div></div>
      <div className="card-body form-grid">
        <div className="form-field"><label>Company scope</label><select className="form-control" value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">Global scoring list</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
        <div className="form-field"><label>Selected file</label><div className="file-row" style={{ margin: 0 }}><div className="file-icon">{processing ? <LoaderCircle className="animate-spin" size={18}/> : <FileSpreadsheet size={18}/>}</div><div><strong>{fileName || "No file selected"}</strong><span>{rows.length ? `${rows.length} rows ready for validation` : "Download the template first for best results"}</span></div></div></div>
        <div className="form-field full"><button className="btn btn-primary" disabled={saving || processing || !rows.length} onClick={importRows}>{saving ? "Importing..." : <><CheckCircle2 size={13}/>Import scoring rows</>}</button></div>
      </div>
    </div>

    <div className="toolbar"><div className="searchbar"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search scheme or option..."/></div><select className="select" value={category} onChange={(event) => setCategory(event.target.value)}><option>All categories</option><option>Premium</option><option>High</option><option>Medium</option><option>Low</option><option>Unknown</option></select></div>
    <div className="card"><div className="card-head"><div><div className="card-title">Option scoring table</div><div className="card-sub">Scores influence prioritisation, but never close or delete a patient journey</div></div><Sparkles size={16} color="#c19038"/></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Scheme</th><th>Option</th><th>Score</th><th>Category</th><th>Notes</th><th>Updated</th></tr></thead><tbody>{visibleOptions.map((option) => <tr key={option.id}><td><strong>{schemeById[option.scheme_id]?.name ?? "Unknown scheme"}</strong></td><td>{option.option_name}</td><td>{option.quality_score}</td><td><span className="badge high">{option.category}</span></td><td>{option.notes ?? "—"}</td><td>{new Date(option.updated_at).toLocaleDateString()}</td></tr>)}</tbody></table>{!visibleOptions.length && <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><Sparkles size={25}/></div><h2>No medical aid scoring options yet</h2><p>Download the template, complete the rows, then import medical aid schemes and options before generating prioritised recall opportunities.</p></div>}</div></div>
  </>;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normalizeCategory(value: string): ImportRow["category"] {
  const normalized = value.toLowerCase().trim();
  return categoryOptions.includes(normalized as ImportRow["category"]) ? normalized as ImportRow["category"] : "unknown";
}

function validateRows(rows: ImportRow[]) {
  const errors: string[] = [];
  rows.forEach((row, index) => {
    if (!row.scheme_name) errors.push(`Row ${index + 2}: scheme_name is required`);
    if (!row.option_name) errors.push(`Row ${index + 2}: option_name is required`);
    if (!Number.isFinite(row.quality_score) || row.quality_score < 0 || row.quality_score > 100) errors.push(`Row ${index + 2}: quality_score must be 0-100`);
  });
  return errors;
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

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
