"use client";

import { useMemo, useState } from "react";
import { ArrowDownToLine, ChevronRight, Filter, Search, Shuffle, UserPlus } from "lucide-react";
import type { AssignableUser, Lead, LeadStatus, Role } from "@/lib/types";

type FilterOption = { value: string; label: string; count?: number };
type AllocationFilters = {
  medicalAids: string[];
  options: string[];
  lastVisitYears: string[];
  lastVisitMonths: string[];
  attemptBands: string[];
  statuses: string[];
  priorities: string[];
  redFlags: string[];
};

const emptyAllocationFilters: AllocationFilters = {
  medicalAids: [],
  options: [],
  lastVisitYears: [],
  lastVisitMonths: [],
  attemptBands: [],
  statuses: [],
  priorities: [],
  redFlags: [],
};

const monthOptions: FilterOption[] = [
  { value: "01", label: "January" },
  { value: "02", label: "February" },
  { value: "03", label: "March" },
  { value: "04", label: "April" },
  { value: "05", label: "May" },
  { value: "06", label: "June" },
  { value: "07", label: "July" },
  { value: "08", label: "August" },
  { value: "09", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

const attemptBandOptions: FilterOption[] = [
  { value: "0", label: "0 attempts" },
  { value: "1", label: "1 attempt" },
  { value: "2", label: "2 attempts" },
  { value: "3_plus", label: "3+ attempts" },
];

const redFlagOptions: FilterOption[] = [
  { value: "manual_contact", label: "Patient telephone must be added manually" },
  { value: "missing_mobile", label: "Missing mobile number" },
  { value: "missing_alternative", label: "Missing alternative number" },
  { value: "missing_medical_aid", label: "Missing medical aid" },
  { value: "missing_option", label: "Missing option" },
];

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

function isNotSupplied(value: string | null | undefined) {
  return !value || value.trim().toLowerCase() === "not supplied";
}

function lastVisitParts(lead: Lead) {
  if (!lead.lastVisit || lead.lastVisit === "Not supplied") return { year: "", month: "" };
  const value = lead.lastVisit.slice(0, 10);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return { year: "", month: "" };
  return { year: date.getUTCFullYear().toString(), month: String(date.getUTCMonth() + 1).padStart(2, "0") };
}

function attemptBandFor(lead: Lead) {
  if (lead.attempts >= 3) return "3_plus";
  return String(Math.max(0, lead.attempts));
}

function redFlagsFor(lead: Lead) {
  const flags: string[] = [];
  if (lead.manualContactRequired) flags.push("manual_contact");
  if (!lead.phone) flags.push("missing_mobile");
  if (!lead.alternatePhone) flags.push("missing_alternative");
  if (isNotSupplied(lead.medicalAid)) flags.push("missing_medical_aid");
  if (isNotSupplied(lead.option)) flags.push("missing_option");
  return flags;
}

function matchesSelected(selected: string[], value: string) {
  return selected.length === 0 || selected.includes(value);
}

function matchesAllocationFilters(lead: Lead, filters: AllocationFilters) {
  const visit = lastVisitParts(lead);
  const flags = redFlagsFor(lead);
  return matchesSelected(filters.medicalAids, lead.medicalAid)
    && matchesSelected(filters.options, lead.option)
    && matchesSelected(filters.lastVisitYears, visit.year)
    && matchesSelected(filters.lastVisitMonths, visit.month)
    && matchesSelected(filters.attemptBands, attemptBandFor(lead))
    && matchesSelected(filters.statuses, lead.status)
    && matchesSelected(filters.priorities, lead.priority)
    && (filters.redFlags.length === 0 || filters.redFlags.some((flag) => flags.includes(flag)));
}

function filterPayload(filters: AllocationFilters) {
  return {
    medical_aids: filters.medicalAids,
    options: filters.options,
    last_visit_years: filters.lastVisitYears,
    last_visit_months: filters.lastVisitMonths,
    attempt_bands: filters.attemptBands,
    statuses: filters.statuses,
    priorities: filters.priorities,
    red_flags: filters.redFlags,
  };
}

function optionsFromLeads(leads: Lead[], read: (lead: Lead) => string, labels?: Record<string, string>) {
  const counts = new Map<string, number>();
  leads.forEach((lead) => {
    const value = read(lead);
    if (!value) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => (labels?.[a[0]] ?? a[0]).localeCompare(labels?.[b[0]] ?? b[0]))
    .map(([value, count]) => ({ value, label: labels?.[value] ?? value, count }));
}

function MultiCheckFilter({
  title,
  options,
  selected,
  onChange,
}: {
  title: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filteredOptions = options.filter((option) => option.label.toLowerCase().includes(search.toLowerCase()));

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  }

  const summary = selected.length === 0 ? "All" : `${selected.length} selected`;

  return <div className="form-field" style={{ position: "relative" }}>
    <label>{title}</label>
    <button type="button" className="form-control" onClick={() => setOpen((value) => !value)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left", cursor: "pointer" }}>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
      <span style={{ color: "#7d918e", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
    </button>
    {open && <div style={{ position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, marginTop: 6, background: "#fff", border: "1px solid #dfe9e6", borderRadius: 16, boxShadow: "0 18px 45px rgba(32, 64, 59, .15)", padding: 10 }}>
      <input className="form-control" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}...`} style={{ minHeight: 34, marginBottom: 8 }} />
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10, fontWeight: 800, color: "#294541", padding: "7px 4px", borderBottom: "1px solid #edf3f1", marginBottom: 5 }}>
        <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
        Select all
      </label>
      <div style={{ maxHeight: 190, overflow: "auto" }}>
        {filteredOptions.length ? filteredOptions.map((option) => <label key={option.value} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10, color: "#566b67", padding: "7px 4px", borderRadius: 8 }}>
          <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggle(option.value)} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{option.label}{typeof option.count === "number" ? ` (${option.count})` : ""}</span>
        </label>) : <div style={{ fontSize: 10, color: "#8c9a98", padding: "10px 4px" }}>No matching values</div>}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px solid #edf3f1", paddingTop: 8, marginTop: 8 }}>
        <button type="button" className="btn btn-soft" onClick={() => { onChange([]); setSearch(""); }}>Clear</button>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Done</button>
      </div>
    </div>}
  </div>;
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
  const [allocationFilters, setAllocationFilters] = useState<AllocationFilters>(emptyAllocationFilters);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [allocationLimit, setAllocationLimit] = useState(25);
  const [allocating, setAllocating] = useState(false);
  const baseVisible = useMemo(() => leads.filter((lead) => {
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
    const matchesFilter = mode === "allocation" ? true : filter === "All priorities" || lead.priority.includes(filter);
    return matchesQuery && matchesMode && matchesFilter;
  }), [query, filter, leads, mode, role]);

  const isAllocationMode = mode === "allocation";
  const title = mode === "due" ? "Due today" : mode === "callbacks" ? "Patient callbacks" : mode === "completed" ? "Completed journeys" : isAllocationMode ? "Lead allocation" : mode === "review" ? "Manager review" : role === "employee" ? "My patient leads" : "Patient recall journeys";
  const sub = mode === "allocation" ? "Allocate only patient journeys that are due for follow-up. Future recall leads stay protected in the pipeline until their review date." : mode === "review" ? "Resolve journeys that need a manager's judgement or have reached three unsuccessful days." : "Find the next patient, understand their history, and keep their follow-up moving.";
  const unfilteredAllocationEligible = baseVisible.filter((lead) => lead.assignedTo === "Unallocated" && lead.status === "New" && isDueForFollowUp(lead));
  const futurePipeline = baseVisible.filter((lead) => lead.assignedTo === "Unallocated" && !finalStatuses.includes(lead.status) && !isDueForFollowUp(lead) && matchesAllocationFilters(lead, allocationFilters));
  const allocationEligible = unfilteredAllocationEligible.filter((lead) => matchesAllocationFilters(lead, allocationFilters));
  const displayedLeads = isAllocationMode && role !== "employee" ? allocationEligible : baseVisible;
  const selectedEmployee = assignableUsers.find((user) => user.id === selectedEmployeeId);
  const hasAllocationFilters = Object.values(allocationFilters).some((values) => values.length > 0);
  const allocationFilterOptions = useMemo(() => {
    const monthLabels = Object.fromEntries(monthOptions.map((option) => [option.value, option.label]));
    const attemptLabels = Object.fromEntries(attemptBandOptions.map((option) => [option.value, option.label]));
    const redFlagLabels = Object.fromEntries(redFlagOptions.map((option) => [option.value, option.label]));
    const redFlagCounts = new Map<string, number>();
    unfilteredAllocationEligible.forEach((lead) => redFlagsFor(lead).forEach((flag) => redFlagCounts.set(flag, (redFlagCounts.get(flag) ?? 0) + 1)));
    return {
      medicalAids: optionsFromLeads(unfilteredAllocationEligible, (lead) => lead.medicalAid),
      options: optionsFromLeads(unfilteredAllocationEligible, (lead) => lead.option),
      lastVisitYears: optionsFromLeads(unfilteredAllocationEligible, (lead) => lastVisitParts(lead).year),
      lastVisitMonths: optionsFromLeads(unfilteredAllocationEligible, (lead) => lastVisitParts(lead).month, monthLabels),
      attemptBands: optionsFromLeads(unfilteredAllocationEligible, attemptBandFor, attemptLabels),
      statuses: optionsFromLeads(unfilteredAllocationEligible, (lead) => lead.status),
      priorities: optionsFromLeads(unfilteredAllocationEligible, (lead) => lead.priority),
      redFlags: redFlagOptions.map((option) => ({ ...option, count: redFlagCounts.get(option.value) ?? 0 })).filter((option) => option.count > 0 || allocationFilters.redFlags.includes(option.value)),
    };
  }, [unfilteredAllocationEligible, allocationFilters.redFlags]);

  function updateAllocationFilter(key: keyof AllocationFilters, values: string[]) {
    setAllocationFilters((current) => ({ ...current, [key]: values }));
  }

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
    const leadIds = allocationEligible.map((lead) => lead.id);
    setAllocating(true);
    try {
      const response = await fetch("/api/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: selectedEmployeeId, lead_ids: leadIds, limit, allocation_mode: "random", filters: filterPayload(allocationFilters) }),
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
    const eligible = baseVisible.find(isEmployeeActionable);
    if (eligible) {
      onLead(eligible);
      notify(`${eligible.patient} opened as your next eligible patient journey`);
      return;
    }
    const reasons = [
      baseVisible.length === 0 ? "your current filter/search leaves no visible patients" : "",
      baseVisible.length > 0 && baseVisible.every((lead) => finalStatuses.includes(lead.status)) ? "all visible patients are completed" : "",
      baseVisible.some((lead) => lead.status === "Booking Recorded Pending Verification") ? "some patients are awaiting manager booking verification" : "",
      baseVisible.some((lead) => lead.status === "Manager Review") ? "some patients require manager review" : "",
      baseVisible.some((lead) => !isEmployeeActionable(lead)) ? "some patients are allocated but not due for action yet" : "",
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
          <div className="form-field full"><div className="callout" style={{ margin: 0 }}><Filter size={14}/><span>{allocationEligible.length.toLocaleString()} filtered due, unallocated lead(s) are eligible for random assignment right now from {unfilteredAllocationEligible.length.toLocaleString()} due lead(s). {futurePipeline.length.toLocaleString()} matching future lead(s) are protected until their six-month review date.{selectedEmployee ? ` Selected employee: ${selectedEmployee.name}.` : ""}</span></div></div>
        </div>
        <div className="card" style={{ boxShadow: "none", border: "1px solid #e6efec", marginTop: 14 }}>
          <div className="card-head"><div><div className="card-title">Advanced allocation filters</div><div className="card-sub">Select all is the default. Specific selections narrow the pool before the server randomly allocates leads.</div></div>{hasAllocationFilters && <button type="button" className="btn btn-secondary" onClick={() => setAllocationFilters(emptyAllocationFilters)}>Clear filters</button>}</div>
          <div className="card-body">
            <div className="form-grid">
              <MultiCheckFilter title="Medical aid" options={allocationFilterOptions.medicalAids} selected={allocationFilters.medicalAids} onChange={(values) => updateAllocationFilter("medicalAids", values)} />
              <MultiCheckFilter title="Option / plan" options={allocationFilterOptions.options} selected={allocationFilters.options} onChange={(values) => updateAllocationFilter("options", values)} />
              <MultiCheckFilter title="Last visit year" options={allocationFilterOptions.lastVisitYears} selected={allocationFilters.lastVisitYears} onChange={(values) => updateAllocationFilter("lastVisitYears", values)} />
              <MultiCheckFilter title="Last visit month" options={allocationFilterOptions.lastVisitMonths} selected={allocationFilters.lastVisitMonths} onChange={(values) => updateAllocationFilter("lastVisitMonths", values)} />
              <MultiCheckFilter title="Number of attempts" options={allocationFilterOptions.attemptBands} selected={allocationFilters.attemptBands} onChange={(values) => updateAllocationFilter("attemptBands", values)} />
              <MultiCheckFilter title="Engagement status" options={allocationFilterOptions.statuses} selected={allocationFilters.statuses} onChange={(values) => updateAllocationFilter("statuses", values)} />
              <MultiCheckFilter title="Priority type" options={allocationFilterOptions.priorities} selected={allocationFilters.priorities} onChange={(values) => updateAllocationFilter("priorities", values)} />
              <MultiCheckFilter title="Red flags" options={allocationFilterOptions.redFlags} selected={allocationFilters.redFlags} onChange={(values) => updateAllocationFilter("redFlags", values)} />
            </div>
            <div className="callout" style={{ background: "#f7fbfa", marginTop: 12, marginBottom: 0 }}><Shuffle size={14}/><span>Allocation mode: random. The selected employee receives a random selection from the filtered eligible pool, not the first available leads.</span></div>
          </div>
        </div>
        {!assignableUsers.length && <div className="callout" style={{ background: "#fff8e6", color: "#80611c", marginTop: 12 }}><Filter size={14}/><span>No active Employee / Patient Care Coordinator accounts are available in your scope. Create or reactivate an employee before allocating work.</span></div>}
        <div className="modal-actions" style={{ borderRadius: 14, marginTop: 14 }}>
          <button className="btn btn-primary" disabled={allocating || !selectedEmployeeId || allocationEligible.length === 0} onClick={allocateVisibleLeads}><UserPlus size={14}/>{allocating ? "Allocating..." : "Randomly allocate filtered leads"}</button>
        </div>
      </div>
    </div>}
    <div className="toolbar">
      <div className="searchbar"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search patient, account or phone..." /></div>
      {!isAllocationMode && <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)}><option>All priorities</option><option>Premium</option><option>High</option><option>Dormant</option><option>Missing</option></select>}
    </div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,fontSize:9,color:"#859593"}}><span><strong style={{color:"#263f3d"}}>{displayedLeads.length}</strong> {isAllocationMode && role !== "employee" ? "filtered due, unallocated patient journeys shown" : "patient journeys shown"}</span>{isAllocationMode && <button className="btn btn-soft" disabled={allocating || role === "employee"} onClick={allocateVisibleLeads}><Shuffle size={13} />Random allocation</button>}</div>
    {displayedLeads.length ? <div className="lead-grid">{displayedLeads.map((lead) => <article className="lead-card" key={lead.id} onClick={() => onLead(lead)}>
      <div className="lead-card-top"><span className={`badge ${badgeClass(lead.priority)}`}>{lead.priority}</span><span className="badge status-badge">{lead.status}</span></div>
      <div className="patient-cell"><div className="avatar">{lead.initials}</div><div><div className="patient-name">{lead.patient}</div><div className="patient-meta">{lead.account} · {lead.phone || "Missing contact number"}</div>{lead.manualContactRequired && <div style={{ marginTop: 6 }}><span className="badge missing">{lead.contactFlag ?? "Patient telephone must be added manually"}</span></div>}</div></div>
      <div className="lead-detail-grid"><div><label>Medical aid</label><span>{lead.medicalAid}</span></div><div><label>Option</label><span>{lead.option}</span></div><div><label>Last 8101</label><span>{lead.last8101}</span></div><div><label>Last 8159</label><span>{lead.last8159}</span></div></div>
      <div className="lead-card-foot"><div><div style={{fontSize:8,color:"#91a09e",marginBottom:5}}>ATTEMPTS · {lead.attempts}/3 days</div><div className="attempt-dots">{[0,1,2].map((i)=><i key={i} className={i < lead.attemptDays ? "hit" : ""} />)}</div></div><div style={{textAlign:"right"}}><strong style={{fontSize:9}}>{lead.nextAction}</strong><div style={{fontSize:8,color:"#8b9b99",marginTop:4}}>{lead.latestOutcome} <ChevronRight size={10} style={{verticalAlign:-2}} /></div></div></div>
    </article>)}</div> : <div className="card empty-page"><div className="empty-icon"><Filter size={25} /></div><h2>No eligible patient journeys shown</h2><p>{mode === "allocation" ? `No due, unallocated patient journeys are available for allocation right now. ${futurePipeline.length.toLocaleString()} future lead(s) remain in the pipeline until their six-month review date.` : "There are no patients matching this view. They may be completed, unallocated, awaiting verification, in manager review, or filtered out."}</p></div>}
  </>;
}
