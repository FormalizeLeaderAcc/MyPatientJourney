"use client";

import { ArrowRight, BarChart3, CloudUpload, ListChecks, Sparkles } from "lucide-react";
import type { Lead } from "@/lib/types";

const finalStatuses = ["Patient Booked and Verified", "Patient Not Interested", "Wrong Number Confirmed", "Manager Closed"];

function isActiveLead(lead: Lead) {
  return !finalStatuses.includes(lead.status);
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isDueForFollowUp(lead: Lead) {
  if (!isActiveLead(lead)) return false;

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

function MetricCard({ label, value, trend, tone }: { label: string; value: string; trend: string; tone: "teal" | "blue" | "violet" | "orange" | "rose" }) {
  return <div className={`metric-card ${tone}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-trend">{trend}</div></div>;
}

export function RecallCampaignsView({ leads, onNavigate }: { leads: Lead[]; onNavigate: (page: string) => void }) {
  const activeLeads = leads.filter(isActiveLead);
  const dueForFollowUp = activeLeads.filter(isDueForFollowUp);
  const dueUnallocated = dueForFollowUp.filter((lead) => lead.assignedTo === "Unallocated");
  const futurePipeline = activeLeads.filter((lead) => !isDueForFollowUp(lead));
  const allocated = activeLeads.filter((lead) => lead.assignedTo !== "Unallocated");
  const managerReview = activeLeads.filter((lead) => lead.status === "Manager Review");
  const batches = Array.from(leads.reduce((map, lead) => {
    const existing = map.get(lead.sourceBatch) ?? { total: 0, active: 0, dueUnallocated: 0, future: 0, allocated: 0 };
    existing.total += 1;
    if (isActiveLead(lead)) existing.active += 1;
    if (isDueForFollowUp(lead) && lead.assignedTo === "Unallocated") existing.dueUnallocated += 1;
    if (isActiveLead(lead) && !isDueForFollowUp(lead)) existing.future += 1;
    if (lead.assignedTo !== "Unallocated") existing.allocated += 1;
    map.set(lead.sourceBatch, existing);
    return map;
  }, new Map<string, { total: number; active: number; dueUnallocated: number; future: number; allocated: number }>()).entries());

  return <>
    <div className="page-head">
      <div>
        <h1>Recall Campaigns</h1>
        <p>Campaign-level command centre for uploaded recall lists, readiness, allocation progress and follow-up health.</p>
      </div>
      <div className="head-actions">
        <button className="btn btn-secondary" onClick={() => onNavigate("upload")}><CloudUpload size={14}/>Upload / reports</button>
        <button className="btn btn-primary" onClick={() => onNavigate("allocation")}><ListChecks size={14}/>Allocate leads</button>
      </div>
    </div>

    <div className="metric-grid">
      <MetricCard label="Total campaign leads" value={leads.length.toLocaleString()} trend="All imported recall opportunities" tone="teal" />
      <MetricCard label="Active leads" value={activeLeads.length.toLocaleString()} trend="Still in the recall journey" tone="blue" />
      <MetricCard label="Due unallocated" value={dueUnallocated.length.toLocaleString()} trend="Ready for Lead Allocation" tone="orange" />
      <MetricCard label="Manager review" value={managerReview.length.toLocaleString()} trend="Needs operational decision" tone="rose" />
    </div>

    <div className="dashboard-grid">
      <div className="card">
        <div className="card-head"><div><div className="card-title">Campaign workflow</div><div className="card-sub">This page tracks campaign health. Actual employee assignment happens in Lead Allocation.</div></div></div>
        <div className="card-body" style={{ display: "grid", gap: 12 }}>
          <div className="callout"><Sparkles size={14}/><span><strong>Purpose:</strong> monitor uploaded recall campaigns, identify unallocated work, and move clean leads into operational follow-up.</span></div>
          <button className="lead-card" style={{ textAlign: "left" }} onClick={() => onNavigate("upload")}>
            <strong style={{ fontFamily: "Manrope", fontSize: 13 }}>1. Prepare or import a recall list</strong>
            <p style={{ fontSize: 10, color: "#6f837f", lineHeight: 1.6 }}>Use Upload Centre for cleanup, lead-ready imports, import reports and recalled/withdrawn lists.</p>
          </button>
          <button className="lead-card" style={{ textAlign: "left" }} onClick={() => onNavigate("allocation")}>
            <strong style={{ fontFamily: "Manrope", fontSize: 13 }}>2. Allocate unassigned leads</strong>
            <p style={{ fontSize: 10, color: "#6f837f", lineHeight: 1.6 }}>{dueUnallocated.length.toLocaleString()} due lead(s) currently need allocation to employees. {futurePipeline.length.toLocaleString()} future lead(s) are protected until their recall date.</p>
          </button>
          <button className="lead-card" style={{ textAlign: "left" }} onClick={() => onNavigate("reports")}>
            <strong style={{ fontFamily: "Manrope", fontSize: 13 }}>3. Review campaign performance</strong>
            <p style={{ fontSize: 10, color: "#6f837f", lineHeight: 1.6 }}>Reports will summarise contacted patients, bookings, verification and stuck journeys.</p>
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><div><div className="card-title">Follow-up readiness</div><div className="card-sub">Current state across active campaign work</div></div></div>
        <div className="card-body">
          <div style={{ display: "grid", gap: 10 }}>
            <div className="lead-card" style={{ boxShadow: "none" }}><strong>{allocated.length.toLocaleString()} allocated</strong><p style={{ fontSize: 10, color: "#6f837f" }}>Already assigned to employees for patient follow-up.</p></div>
            <div className="lead-card" style={{ boxShadow: "none" }}><strong>{dueUnallocated.length.toLocaleString()} due unallocated</strong><p style={{ fontSize: 10, color: "#6f837f" }}>Ready to move into employee work queues.</p></div>
            <div className="lead-card" style={{ boxShadow: "none" }}><strong>{futurePipeline.length.toLocaleString()} future pipeline</strong><p style={{ fontSize: 10, color: "#6f837f" }}>Stored safely until six-month recall review.</p></div>
            <div className="lead-card" style={{ boxShadow: "none" }}><strong>{activeLeads.filter((lead) => lead.nextAction === "Overdue").length.toLocaleString()} overdue</strong><p style={{ fontSize: 10, color: "#6f837f" }}>Needs attention before campaign momentum stalls.</p></div>
          </div>
        </div>
      </div>
    </div>

    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head"><div><div className="card-title">Imported campaign batches</div><div className="card-sub">Each batch remains traceable to its upload/import source.</div></div></div>
      {batches.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Source batch</th><th>Total leads</th><th>Active</th><th>Allocated</th><th>Due unallocated</th><th>Future pipeline</th><th>Next step</th></tr></thead><tbody>{batches.map(([batch, stats]) => <tr key={batch}><td><strong>{batch}</strong></td><td>{stats.total.toLocaleString()}</td><td>{stats.active.toLocaleString()}</td><td>{stats.allocated.toLocaleString()}</td><td>{stats.dueUnallocated.toLocaleString()}</td><td>{stats.future.toLocaleString()}</td><td>{stats.dueUnallocated > 0 ? <button className="btn btn-soft" onClick={() => onNavigate("allocation")}>Allocate <ArrowRight size={12}/></button> : <span className="badge standard">No due allocation</span>}</td></tr>)}</tbody></table></div> : <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><BarChart3 size={25}/></div><h2>No recall campaigns yet</h2><p>Upload a lead-ready list to create the first traceable recall campaign.</p><button className="btn btn-primary" onClick={() => onNavigate("upload")}><CloudUpload size={14}/>Open Upload Centre</button></div>}
    </div>
  </>;
}
