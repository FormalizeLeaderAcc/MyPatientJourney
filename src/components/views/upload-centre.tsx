"use client";

import { useRef, useState } from "react";
import { ArrowRight, Check, CheckCircle2, ChevronRight, FileSpreadsheet, Info, LoaderCircle, RotateCcw, Sparkles, UploadCloud } from "lucide-react";

const targetFields = [
  ["Patient Name", "Patient Full Name"], ["Account Number", "Account No"], ["Cellphone Number", "Mobile"], ["Alternate Number", "Alt Phone"],
  ["Medical Aid Name", "Scheme"], ["Medical Aid Option", "Plan"], ["Transaction Date", "Txn Date"], ["Treatment Code", "Code"],
  ["Branch", "Practice Branch"], ["Practitioner", "Provider"], ["Amount Charged", "Amount"],
];

export function UploadCentre({ notify }: { notify: (message: string) => void }) {
  const [step, setStep] = useState(1);
  const [type, setType] = useState<"transactions" | "contacts">("transactions");
  const [file, setFile] = useState<{ name: string; size: string; rowCount: number } | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [processing, setProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function readFile(selected: File) {
    setProcessing(true);
    try {
      let matrix: unknown[][];
      if (selected.name.toLowerCase().endsWith(".csv")) {
        const text = await selected.text();
        matrix = text.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
      } else {
        const { readSheet } = await import("read-excel-file/browser");
        matrix = (await readSheet(selected)) as unknown[][];
      }
      const detectedHeaders = (matrix[0] ?? []).map(String);
      const parsed = matrix.slice(1).map((row) => Object.fromEntries(detectedHeaders.map((header, index) => [header, row[index] ?? ""])));
      setHeaders(detectedHeaders);
      setRows(parsed.slice(0, 5));
      setFile({ name: selected.name, size: `${(selected.size / 1024).toFixed(1)} KB`, rowCount: parsed.length });
      notify(`${parsed.length.toLocaleString()} rows detected and ready to map`);
    } catch {
      notify("We could not read that spreadsheet. Please check the file format.");
    } finally { setProcessing(false); }
  }

  const mappedCount = targetFields.filter(([, fallback], index) => headers.find(h => h.toLowerCase().includes(fallback.split(" ")[0].toLowerCase())) || headers[index]).length;
  const steps = [[1,"Choose data","Select upload type"],[2,"Upload file","XLSX or CSV"],[3,"Map columns","Confirm detected fields"],[4,"Review & import","Validate patient data"],[5,"Generate recalls","Apply recall rules"]];
  return <>
    <div className="page-head"><div><h1>Upload Centre</h1><p>Bring transaction history or a curated contact list into a traceable recall campaign.</p></div><button className="btn btn-secondary"><RotateCcw size={14} />Import history</button></div>
    <div className="upload-shell">
      <div className="card upload-steps">{steps.map(([num,title,sub]) => <div className={`upload-step ${step === num ? "active" : step > Number(num) ? "done" : ""}`} key={title}><div className="step-num">{step > Number(num) ? <Check size={11} /> : num}</div><div><strong>{title}</strong><span>{sub}</span></div></div>)}</div>
      <div className="card">
        <div className="card-head"><div><div className="card-title">{step === 1 ? "What would you like to upload?" : step === 2 ? "Add your spreadsheet" : step === 3 ? "Confirm column mapping" : step === 4 ? "Review before import" : "Generate recall opportunities"}</div><div className="card-sub">Step {step} of 5 · Source data remains separate from operational leads</div></div></div>
        <div className="card-body">
          {step === 1 && <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:13}}>
            <button onClick={() => setType("transactions")} className="lead-card" style={{textAlign:"left",borderColor:type === "transactions" ? "#58aaa2" : undefined,background:type === "transactions" ? "#f5fbf9" : undefined}}><div className="drop-icon" style={{margin:"0 0 15px"}}><FileSpreadsheet size={22} /></div><strong style={{fontFamily:"Manrope",fontSize:13}}>Dental transaction spreadsheet</strong><p style={{fontSize:9,lineHeight:1.6,color:"#7e908d"}}>Analyse treatment codes 8101 and 8159, visit dates, medical aid options and patient activity.</p><span className="badge standard">Recommended for recall analysis</span></button>
            <button onClick={() => setType("contacts")} className="lead-card" style={{textAlign:"left",borderColor:type === "contacts" ? "#58aaa2" : undefined,background:type === "contacts" ? "#f5fbf9" : undefined}}><div className="drop-icon" style={{margin:"0 0 15px"}}><Sparkles size={22} /></div><strong style={{fontFamily:"Manrope",fontSize:13}}>Curated contact spreadsheet</strong><p style={{fontSize:9,lineHeight:1.6,color:"#7e908d"}}>Import a prepared patient follow-up list with dates, notes, priority and contact details.</p><span className="badge high">Ready follow-up list</span></button>
          </div>}
          {step === 2 && <><input ref={inputRef} hidden type="file" accept=".xlsx,.csv" onChange={(event) => event.target.files?.[0] && readFile(event.target.files[0])} /><div className="dropzone" onClick={() => inputRef.current?.click()}><div className="drop-icon">{processing ? <LoaderCircle size={24} className="animate-spin" /> : <UploadCloud size={24} />}</div><h3>Drop a spreadsheet here, or browse</h3><p>Supports .XLSX and .CSV · Maximum 25 MB</p><button className="btn btn-soft" type="button">Choose spreadsheet</button></div>{file && <div className="file-row"><div className="file-icon"><FileSpreadsheet size={19} /></div><div><strong>{file.name}</strong><span>{file.size} · {file.rowCount.toLocaleString()} rows detected · {rows.length} rows previewed</span></div><CheckCircle2 style={{marginLeft:"auto",color:"#3b9b7c"}} size={18} /></div>}<div className="callout" style={{marginTop:14,marginBottom:0}}><Info size={14} /><span>Patient transaction history is stored in a protected source layer. Employees can view summaries but cannot change imported records.</span></div></>}
          {step === 3 && <><div className="mapping-list">{targetFields.map(([target, fallback], index) => <div className="mapping-row" key={target}><div className="mapping-source">{target}</div><ChevronRight className="mapping-arrow" size={14} /><select className="form-control" defaultValue={headers.find(h => h.toLowerCase().includes(fallback.split(" ")[0].toLowerCase())) || headers[index] || ""}><option value="">Not mapped</option>{headers.map(h=><option key={h}>{h}</option>)}</select></div>)}</div><div className="mapping-status"><CheckCircle2 size={13} /> {mappedCount} of {targetFields.length} fields mapped from this file. Confirm mappings before import.</div></>}
          {step === 4 && <><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:15}}>{[["Rows detected",file?.rowCount.toLocaleString() ?? "0"],["Previewed rows",String(rows.length)],["Mapped fields",String(mappedCount)],["Needs review",String(Math.max(targetFields.length - mappedCount, 0))]].map(item=><div className="metric-card teal" key={item[0]}><div className="metric-label">{item[0]}</div><div className="metric-value" style={{fontSize:20}}>{item[1]}</div></div>)}</div>{rows.length ? <div className="table-wrap" style={{border:"1px solid #e5ecea",borderRadius:12}}><table className="data-table"><thead><tr><th>Patient</th><th>Account</th><th>Medical aid</th><th>Date</th><th>Code</th><th>Validation</th></tr></thead><tbody>{rows.slice(0,4).map((row,i)=><tr key={i}><td><strong>{String(row["Patient Full Name"] || Object.values(row)[0] || "Patient")}</strong></td><td>{String(row["Account No"] || "—")}</td><td>{String(row.Scheme || "Unknown")}</td><td>{String(row["Txn Date"] || "—")}</td><td>{String(row.Code || "—")}</td><td><span className="badge standard">Preview</span></td></tr>)}</tbody></table></div> : <div className="card empty-page"><div className="empty-icon"><FileSpreadsheet size={24}/></div><h2>No file rows to preview</h2><p>Upload a spreadsheet before importing patient source data.</p></div>}</>}
          {step === 5 && <><div className="card" style={{boxShadow:"none"}}><div className="card-body"><Sparkles size={22} color="#0b7a75" /><h3 style={{fontFamily:"Manrope",fontSize:14}}>Ready to generate recall opportunities</h3><p style={{fontSize:9,color:"#758885",lineHeight:1.6}}>The live import pipeline will apply 8101/8159 recall rules, dormancy checks and medical aid scoring to the uploaded rows.</p></div></div><div className="callout" style={{marginTop:14,marginBottom:0}}><Info size={14}/><span>For live testing, this screen now only reflects the file you uploaded. The next production step is persisting the import batch and generated leads to Supabase.</span></div></>}
        </div>
        <div className="modal-actions" style={{borderRadius:"0 0 18px 18px"}}>{step > 1 && <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>Back</button>}<button className="btn btn-primary" disabled={(step === 2 || step === 3 || step === 4) && !file} onClick={() => { if(step < 5) setStep(step + 1); else notify("Recall generation is ready for live import persistence"); }}>{step === 5 ? "Prepare recall generation" : "Continue"}<ArrowRight size={13} /></button></div>
      </div>
    </div>
  </>;
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
