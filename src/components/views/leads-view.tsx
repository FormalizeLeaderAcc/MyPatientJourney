"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ChevronRight, Filter, Search, Shuffle, UserPlus } from "lucide-react";
import type { AssignableUser, Lead, LeadStatus, Role } from "@/lib/types";

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
  "Manager Closed",
];

function isEmployeeActionable(lead: Lead) {
  return !finalStatuses.includes(lead.status)
    && lead.status !== "Manager Review"
    && lead.status !== "Booking Recorded Pending Verification"
    && (
      lead.nextAction === "Due today"
      || lead.nextAction === "Overdue"
      || lead.status === "Callback Due"
      || lead.status === "Call Back Later"
    );
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isDueForFollowUp(lead: Lead) {
  if (finalStatuses.includes(lead.status)) return false;

  if (lead.lastVisit && lead.lastVisit !== "Not supplied") {
    const lastVisit = new Date(`${lead.lastVisit.slice(0, 10)}T00:00:00.000Z`);
    if (!Number.isNaN(lastVisit.getTime())) {
      return addMonths(lastVisit, 6).toISOString().slice(0, 10) <= new Date().toISOString().slice(0, 10);
    }
  }

  if (lead.nextAction === "Due today" || lead.nextAction === "Overdue" || lead.nextAction === "Ready to allocate") return true;
  const nextActionDate = new Date(`${lead.nextAction.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(nextActionDate.getTime()) ? false : nextActionDate.toISOString().slice(0, 10) <= new Date().toISOString().slice(0, 10);
}

export function LeadsView({
  role,
  mode,
  leads,
  assignableUsers = [],
  onLead,
  notify,
  onRefresh,
}: {
  role: Role;
  mode: string;
  leads: Lead[];
  assignableUsers?: AssignableUser[];
  onLead: (lead: Lead) => void;
  notify: (message: string) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All priorities");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [allocationLimit, setAllocationLimit] = useState(25);
  const [allocating, setAllocating] = useState(false);
  const visible = useMemo(() => leads.filter((lead) => {
    const matchesQuery = `${lead.patient} ${lead.account} ${lead.phone}`.toLowerCase().includes(query.toLowerCase());
    const matchesMode = mode === "due"
      ? lead.nextAction === "Due today" || lead.nextAction === "Overdue" || lead.status === "Callback Due"
      : mode === "callbacks"
        ? ["Callback Due", "Call Back Later"].includes(lead.status)
        : mode === "completed"
          ? finalStatuses.includes(lead.status)
          : mode === "review"
            ? lead.status === "Manager Review"
            : role === "employee" && mode === "leads"
              ? !finalStatuses.includes(lead.status)
            : true;
    const matchesFilter = filter === "All priorities" || lead.priority.includes(filter);
    return matchesQuery && matchesMode && matchesFilter;
  }), [query, filter, leads, mode, role]);

  const isAllocationMode = mode === "allocation";
  const title = mode === "due" ? "Due today" : mode === "callbacks" ? "Patient callbacks" : mode === "completed" ? "Completed journeys" : isAllocationMode ? "Lead allocation" : mode === "review" ? "Manager review" : role === "employee" ? "My patient leads" : "Patient recall journeys";
  const sub = mode === "allocation" ? "Allocate only patient journeys that are due for follow-up. Future recall leads stay protected in the pipeline until their review date." : mode === "review" ? "Resolve journeys that need a manager's judgement or have reached three unsuccessful days." : "Find the next patient, understand their history, and keep their follow-up moving.";
  const futurePipeline = visible.filter((lead) => lead.assignedTo === "Unallocated" && !finalStatuses.includes(lead.status) && !isDueForFollowUp(lead));
  const allocationEligible = visible.filter((lead) => lead.assignedTo === "Unallocated" && lead.status === "New" && isDueForFollowUp(lead));
  const displayedLeads = isAllocationMode && role !== "employee" ? allocationEligible : visible;
  const selectedEmployee = assignableUsers.find((user) => user.id === selectedEmployeeId);

  function exportVisibleLeads() {
    if (!displayedLeads.length) {
      notify("There are no visible patient journeys to export.");
      return;
    }
    const headers = ["Patient Name", "Account Number", "Mobile Number", "Alternative Number", "Branch", "Medical Aid", "Option", "Priority", "Last Visit", "Last 8101", "Last 8159", "Status", "Assigned To", "Next Action", "Latest Outcome", "Source Batch"];
    const rows = displayedLeads.map((lead) => [
      lead.patient,
      lead.account,
      lead.phone,
      lead.alternatePhone ?? "",
      lead.branch,
      lead.medicalAid,
      lead.option,
      lead.priority,
      lead.lastVisit,
      lead.last8101,
      lead.last8159,
      lead.status,
      lead.assignedTo,
      lead.nextAction,
      lead.latestOutcome,
      lead.sourceBatch,
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `patient-journeys-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify(`${displayedLeads.length.toLocaleString()} visible patient journey(s) exported.`);
  }

  async function allocateVisibleLeads() {
    if (role === "employee") return;
    if (!selectedEmployeeId) {
      notify("Choose an active employee before allocating leads.");
      return;
    }
    if (!allocationEligible.length) {
      notify("No due, unallocated leads are visible. Future recall leads remain in the pipeline until their six-month review date.");
      return;
    }
    const limit = Math.max(1, Math.min(Number(allocationLimit) || 1, allocationEligible.length));
    const leadIds = allocationEligible.slice(0, limit).map((lead) => lead.id);
    setAllocating(true);
    try {
      const response = await fetch("/api/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: selectedEmployeeId, lead_ids: leadIds, limit }),
      });
      const result = await response.json();
      if (!response.ok) {
        notify(result.error ?? "Unable to allocate those patient journeys.");
        return;
      }
      notify(result.message ?? "Patient journeys allocated.");
      await onRefresh?.();
    } catch {
      notify("Unable to allocate patient journeys right now.");
    } finally {
      setAllocating(false);
    }
  }

  function openNextPatient() {
    if (role !== "employee") {
      if (isAllocationMode) {
        void allocateVisibleLeads();
        return;
      }
      const firstVisible = displayedLeads.find((lead) => !finalStatuses.includes(lead.status));
      if (firstVisible) onLead(firstVisible);
      else notify("No active patient journey is visible in this view.");
      return;
    }
    if (!leads.length) {
      notify("No eligible patients are available yet because no live leads have been generated or allocated to you.");
      return;
    }
    const eligible = visible.find(isEmployeeActionable);
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
      visible.some((lead) => !isEmployeeActionable(lead)) ? "some patients are allocated but not due for action yet" : "",
    ].filter(Boolean).join("; ");
    notify(`No eligible patients available right now${reasons ? `: ${reasons}` : ". Check Due Today, Callbacks, or ask a manager for more allocated work."}`);
  }

  return <>
    <div className="page-head"><div><h1>{title}</h1><p>{sub}</p></div><div className="head-actions">{role !== "employee" && <button className="btn btn-secondary" onClick={exportVisibleLeads}><ArrowDownToLine size={14} /><span>Export</span></button>}<button className="btn btn-primary" disabled={role !== "employee" && isAllocationMode && allocating} onClick={openNextPatient}><UserPlus size={14} /><span>{role === "employee" ? "Open next patient" : isAllocationMode ? allocating ? "Allocating..." : "Allocate leads" : "Open patient journey"}</span></button></div></div>
    {isAllocationMode && role !== "employee" && <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-head"><div><div className="card-title">Allocation controls</div><div className="card-sub">Assign visible due, unallocated patient journeys to one active employee. Company, branch and six-month recall safety rails are enforced by the server and database.</div></div></div>
      <div className="card-body">
        <div className="form-grid">
          <div className="form-field"><label>Employee *</label><select className="form-control" value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}><option value="">Choose employee</option>{assignableUsers.map((user) => <option key={user.id} value={user.id}>{user.name} - {user.email}</option>)}</select></div>
          <div className="form-field"><label>Number of leads</label><input className="form-control" type="number" min={1} max={Math.max(1, allocationEligible.length)} value={allocationLimit} onChange={(event) => setAllocationLimit(Number(event.target.value))} /></div>
          <div className="form-field full"><div className="callout" style={{ margin: 0 }}><Filter size={14}/><span>{allocationEligible.length.toLocaleString()} visible due, unallocated lead(s) are eligible for assignment right now. {futurePipeline.length.toLocaleString()} unallocated future lead(s) are protected until their six-month review date.{selectedEmployee ? ` Selected employee: ${selectedEmployee.name}.` : ""}</span></div></div>
        </div>
        {!assignableUsers.length && <div className="callout" style={{ background: "#fff8e6", color: "#80611c", marginTop: 12 }}><Filter size={14}/><span>No active Employee / Patient Care Coordinator accounts are available in your scope. Create or reactivate an employee before allocating work.</span></div>}
        <div className="modal-actions" style={{ borderRadius: 14, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={allocating || !selectedEmployeeId || allocationEligible.length === 0} onClick={allocateVisibleLeads}><UserPlus size={14}/>{allocating ? "Allocating..." : "Allocate visible leads"}</button>
        </div>
      </div>
    </div>}
    <div className="toolbar">
      <div className="searchbar"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, account or phone..." /></div>
      <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}><option>All priorities</option><option>Premium</option><option>High</option><option>Dormant</option><option>Missing</option></select>
    </div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,fontSize:9,color:"#859593"}}><span><strong style={{color:"#263f3d"}}>{displayedLeads.length}</strong> {isAllocationMode && role !== "employee" ? "due, unallocated patient journeys shown" : "patient journeys shown"}</span>{isAllocationMode && <button className="btn btn-soft" disabled={allocating || role === "employee"} onClick={allocateVisibleLeads}><Shuffle size={13} />Auto-balance allocation</button>}</div>
    {displayedLeads.length ? <div className="lead-grid">{displayedLeads.map((lead) => <article className="lead-card" key={lead.id} onClick={() => onLead(lead)}>
      <div className="lead-card-top"><span className={`badge ${badgeClass(lead.priority)}`}>{lead.priority}</span><span className="badge status-badge">{lead.status}</span></div>
      <div className="patient-cell"><div className="avatar">{lead.initials}</div><div><div className="patient-name">{lead.patient}</div><div className="patient-meta">{lead.account} · {lead.phone || "Missing contact number"}</div></div></div>
      <div className="lead-detail-grid"><div><label>Medical aid</label><span>{lead.medicalAid}</span></div><div><label>Option</label><span>{lead.option}</span></div><div><label>Last 8101</label><span>{lead.last8101}</span></div><div><label>Last 8159</label><span>{lead.last8159}</span></div></div>
      <div className="lead-card-foot"><div><div style={{fontSize:8,color:"#91a09e",marginBottom:5}}>ATTEMPTS · {lead.attempts}/3 days</div><div className="attempt-dots">{[0,1,2].map((i)=><i key={i} className={i < lead.attemptDays ? "hit" : ""} />)}</div></div><div style={{textAlign:"right"}}><strong style={{fontSize:9}}>{lead.nextAction}</strong><div style={{fontSize:8,color:"#8b9b99",marginTop:4}}>{lead.latestOutcome} <ChevronRight size={10} style={{verticalAlign:-2}} /></div></div></div>
    </article>)}</div> : <div className="card empty-page"><div className="empty-icon"><Filter size={25} /></div><h2>No eligible patient journeys shown</h2><p>{mode === "allocation" ? `No due, unallocated patient journeys are available for allocation right now. ${futurePipeline.length.toLocaleString()} future lead(s) remain in the pipeline until their six-month review date.` : "There are no patients matching this view. They may be completed, unallocated, awaiting verification, in manager review, or filtered out."}</p></div>}
  </>;
}
