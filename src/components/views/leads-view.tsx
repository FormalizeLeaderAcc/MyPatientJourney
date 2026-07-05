"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ChevronRight, Filter, Search, Shuffle, SlidersHorizontal, UserPlus } from "lucide-react";
import type { Lead, LeadStatus, Role } from "@/lib/types";

function badgeClass(priority: string) {
  if (priority.includes("Premium")) return "premium";
  if (priority.includes("High")) return "high";
  if (priority.includes("Dormant")) return "dormant";
  if (priority.includes("Missing")) return "missing";
  return "standard";
}

const finalStatuses: LeadStatus[] = [
  "Patient Booked and Verified",
  "Patient Not Interested",
  "Wrong Number Confirmed",
];

export function LeadsView({ role, mode, leads, onLead, notify }: { role: Role; mode: string; leads: Lead[]; onLead: (lead: Lead) => void; notify: (message: string) => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All priorities");
  const visible = useMemo(() => leads.filter((lead) => {
    const matchesQuery = `${lead.patient} ${lead.account} ${lead.phone}`.toLowerCase().includes(query.toLowerCase());
    const matchesMode = mode === "due"
      ? lead.nextAction.toLowerCase().includes("today")
      : mode === "callbacks"
        ? ["Callback Due", "Call Back Later"].includes(lead.status)
        : mode === "completed"
          ? finalStatuses.includes(lead.status)
          : mode === "review"
            ? lead.status === "Manager Review"
            : true;
    const matchesFilter = filter === "All priorities" || lead.priority.includes(filter);
    return matchesQuery && matchesMode && matchesFilter;
  }), [query, filter, leads, mode]);

  const title = mode === "due" ? "Due today" : mode === "callbacks" ? "Patient callbacks" : mode === "completed" ? "Completed journeys" : mode === "allocation" ? "Lead allocation" : mode === "review" ? "Manager review" : mode === "campaigns" ? "Recall campaigns" : role === "employee" ? "My patient leads" : "Patient recall journeys";
  const sub = mode === "allocation" ? "Balance patient opportunities across branches and care coordinators." : mode === "review" ? "Resolve journeys that need a manager's judgement or have reached three unsuccessful days." : "Find the next patient, understand their history, and keep their follow-up moving.";

  function openNextPatient() {
    if (role !== "employee") {
      notify("Allocation workspace ready");
      return;
    }
    if (!leads.length) {
      notify("No eligible patients are available yet because no live leads have been generated or allocated to you.");
      return;
    }
    const eligible = visible.find((lead) => !finalStatuses.includes(lead.status) && lead.status !== "Manager Review" && lead.status !== "Booking Recorded Pending Verification");
    if (eligible) {
      onLead(eligible);
      notify(`${eligible.patient} opened as your next eligible patient journey`);
      return;
    }
    const reasons = [
      visible.length === 0 ? "your current filter/search leaves no visible patients" : "",
      visible.length > 0 && visible.every((lead) => finalStatuses.includes(lead.status)) ? "all visible patients are completed" : "",
      visible.some((lead) => lead.status === "Booking Recorded Pending Verification") ? "some patients are awaiting manager booking verification" : "",
      visible.some((lead) => lead.status === "Manager Review") ? "some patients require manager review" : "",
    ].filter(Boolean).join("; ");
    notify(`No eligible patients available right now${reasons ? `: ${reasons}` : ". Check Due Today, Callbacks, or ask a manager for more allocated work."}`);
  }

  return <>
    <div className="page-head"><div><h1>{title}</h1><p>{sub}</p></div><div className="head-actions">{role !== "employee" && <button className="btn btn-secondary" onClick={() => notify("Report exported successfully")}><ArrowDownToLine size={14} /><span>Export</span></button>}<button className="btn btn-primary" onClick={openNextPatient}><UserPlus size={14} /><span>{role === "employee" ? "Open next patient" : "Allocate leads"}</span></button></div></div>
    <div className="toolbar">
      <div className="searchbar"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, account or phone..." /></div>
      <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}><option>All priorities</option><option>Premium</option><option>High</option><option>Dormant</option><option>Missing</option></select>
      <select className="select"><option>All branches</option></select>
      <button className="icon-btn"><SlidersHorizontal size={14} /></button>
    </div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,fontSize:9,color:"#859593"}}><span><strong style={{color:"#263f3d"}}>{visible.length}</strong> patient journeys shown</span>{mode === "allocation" && <button className="btn btn-soft"><Shuffle size={13} />Auto-balance allocation</button>}</div>
    {visible.length ? <div className="lead-grid">{visible.map((lead) => <article className="lead-card" key={lead.id} onClick={() => onLead(lead)}>
      <div className="lead-card-top"><span className={`badge ${badgeClass(lead.priority)}`}>{lead.priority}</span><span className="badge status-badge">{lead.status}</span></div>
      <div className="patient-cell"><div className="avatar">{lead.initials}</div><div><div className="patient-name">{lead.patient}</div><div className="patient-meta">{lead.account} · {lead.phone || "Missing contact number"}</div></div></div>
      <div className="lead-detail-grid"><div><label>Medical aid</label><span>{lead.medicalAid}</span></div><div><label>Option</label><span>{lead.option}</span></div><div><label>Last 8101</label><span>{lead.last8101}</span></div><div><label>Last 8159</label><span>{lead.last8159}</span></div></div>
      <div className="lead-card-foot"><div><div style={{fontSize:8,color:"#91a09e",marginBottom:5}}>ATTEMPTS · {lead.attempts}/3 days</div><div className="attempt-dots">{[0,1,2].map((i)=><i key={i} className={i < lead.attemptDays ? "hit" : ""} />)}</div></div><div style={{textAlign:"right"}}><strong style={{fontSize:9}}>{lead.nextAction}</strong><div style={{fontSize:8,color:"#8b9b99",marginTop:4}}>{lead.latestOutcome} <ChevronRight size={10} style={{verticalAlign:-2}} /></div></div></div>
    </article>)}</div> : <div className="card empty-page"><div className="empty-icon"><Filter size={25} /></div><h2>No eligible patient journeys shown</h2><p>{mode === "allocation" ? "Upload and generate recall leads before allocating work to employees." : "There are no patients matching this view. They may be completed, unallocated, awaiting verification, in manager review, or filtered out."}</p></div>}
  </>;
}
