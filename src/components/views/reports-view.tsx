"use client";

import { ArrowDownToLine, BarChart3, FileBarChart } from "lucide-react";
import type { Lead, Role } from "@/lib/types";

const finalStatuses = new Set(["Patient Booked and Verified", "Patient Not Interested", "Wrong Number Confirmed", "Manager Closed"]);

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isDueForFollowUp(lead: Lead) {
  if (finalStatuses.has(lead.status)) return false;

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

function downloadCsv(fileName: string, headers: string[], rows: Array<Array<string | number>>) {
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function metric(label: string, value: number, trend: string, tone: string) {
  return <div className={`metric-card ${tone}`} key={label}><div className="metric-label">{label}</div><div className="metric-value">{value.toLocaleString()}</div><div className="metric-trend">{trend}</div></div>;
}

export function ReportsView({ leads, role, notify }: { leads: Lead[]; role: Role; notify: (message: string) => void }) {
  const active = leads.filter((lead) => !finalStatuses.has(lead.status));
  const dueForFollowUp = active.filter(isDueForFollowUp);
  const dueAllocated = dueForFollowUp.filter((lead) => lead.assignedTo !== "Unallocated");
  const dueUnallocated = dueForFollowUp.filter((lead) => lead.assignedTo === "Unallocated");
  const futurePipeline = active.filter((lead) => !isDueForFollowUp(lead));
  const contacted = leads.filter((lead) => lead.attempts > 0);
  const pendingVerification = leads.filter((lead) => lead.status === "Booking Recorded Pending Verification");
  const verified = leads.filter((lead) => lead.status === "Patient Booked and Verified");
  const managerReview = leads.filter((lead) => lead.status === "Manager Review");
  const managerClosed = leads.filter((lead) => lead.status === "Manager Closed");
  const conversionRate = contacted.length ? Math.round((verified.length / contacted.length) * 100) : 0;

  const byBranch = Array.from(leads.reduce((map, lead) => {
    const current = map.get(lead.branch) ?? { total: 0, active: 0, due: 0, dueAllocated: 0, dueUnallocated: 0, future: 0, verified: 0, review: 0 };
    current.total += 1;
    if (!finalStatuses.has(lead.status)) current.active += 1;
    if (isDueForFollowUp(lead)) current.due += 1;
    if (isDueForFollowUp(lead) && lead.assignedTo !== "Unallocated") current.dueAllocated += 1;
    if (isDueForFollowUp(lead) && lead.assignedTo === "Unallocated") current.dueUnallocated += 1;
    if (!finalStatuses.has(lead.status) && !isDueForFollowUp(lead)) current.future += 1;
    if (lead.status === "Patient Booked and Verified") current.verified += 1;
    if (lead.status === "Manager Review") current.review += 1;
    map.set(lead.branch, current);
    return map;
  }, new Map<string, { total: number; active: number; due: number; dueAllocated: number; dueUnallocated: number; future: number; verified: number; review: number }>()).entries());

  const byLeadType = Array.from(active.reduce((map, lead) => {
    const current = map.get(lead.priority) ?? { total: 0, due: 0, allocated: 0, unallocated: 0, future: 0, review: 0 };
    current.total += 1;
    if (isDueForFollowUp(lead)) current.due += 1;
    if (lead.assignedTo !== "Unallocated") current.allocated += 1;
    if (lead.assignedTo === "Unallocated") current.unallocated += 1;
    if (!isDueForFollowUp(lead)) current.future += 1;
    if (lead.status === "Manager Review") current.review += 1;
    map.set(lead.priority, current);
    return map;
  }, new Map<string, { total: number; due: number; allocated: number; unallocated: number; future: number; review: number }>()).entries());

  function exportReport() {
    downloadCsv(
      `my-patient-journey-report-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Branch", "Total Leads", "Active Leads", "Due For Follow-Up", "Due Allocated", "Due Unallocated", "Future Pipeline", "Verified Bookings", "Manager Review"],
      byBranch.map(([branch, stats]) => [branch, stats.total, stats.active, stats.due, stats.dueAllocated, stats.dueUnallocated, stats.future, stats.verified, stats.review]),
    );
    notify("Report exported.");
  }

  return <>
    <div className="page-head"><div><h1>Reports</h1><p>Operational recall performance, allocation coverage and booking verification outcomes.</p></div><button className="btn btn-primary" onClick={exportReport}><FileBarChart size={14}/>Export report</button></div>
    <div className="metric-grid">
      {metric("Total leads", leads.length, "All visible patient journeys", "teal")}
      {metric("Due for follow-up", dueForFollowUp.length, "Ready for employee allocation/work", "blue")}
      {metric("Due allocated", dueAllocated.length, `${dueUnallocated.length.toLocaleString()} due still unallocated`, "violet")}
      {metric("Future pipeline", futurePipeline.length, "Stored until six-month review date", "teal")}
      {metric("Verified bookings", verified.length, `${conversionRate}% conversion from contacted`, "orange")}
    </div>
    <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginTop: 12 }}>
      {metric("Contacted", contacted.length, "At least one attempt recorded", "teal")}
      {metric("Pending verification", pendingVerification.length, "Needs calendar check", "rose")}
      {metric("Manager review", managerReview.length, "Needs operational decision", "blue")}
      {metric("Manager closed", managerClosed.length, "Closed by manager decision", "violet")}
    </div>
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head"><div><div className="card-title">Branch allocation readiness</div><div className="card-sub">Counts are calculated from the live lead list currently visible to your role: {role === "super" ? "all organisations" : "assigned scope"}. Future leads remain excluded from allocation until they are due.</div></div><button className="btn btn-secondary" onClick={exportReport}><ArrowDownToLine size={13}/>CSV</button></div>
      {byBranch.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Branch</th><th>Total leads</th><th>Active</th><th>Due now</th><th>Due allocated</th><th>Due unallocated</th><th>Future pipeline</th><th>Verified bookings</th><th>Manager review</th></tr></thead><tbody>{byBranch.map(([branch, stats]) => <tr key={branch}><td><strong>{branch}</strong></td><td>{stats.total.toLocaleString()}</td><td>{stats.active.toLocaleString()}</td><td>{stats.due.toLocaleString()}</td><td>{stats.dueAllocated.toLocaleString()}</td><td>{stats.dueUnallocated.toLocaleString()}</td><td>{stats.future.toLocaleString()}</td><td>{stats.verified.toLocaleString()}</td><td>{stats.review.toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><BarChart3 size={25}/></div><h2>No report data yet</h2><p>Upload and allocate live recall leads to populate operational reporting.</p></div>}
    </div>
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head"><div><div className="card-title">Lead type breakdown</div><div className="card-sub">Shows the current mix of recall opportunity types, due coverage and future pipeline volume.</div></div></div>
      {byLeadType.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Lead type</th><th>Active</th><th>Due now</th><th>Allocated</th><th>Unallocated</th><th>Future pipeline</th><th>Manager review</th></tr></thead><tbody>{byLeadType.map(([type, stats]) => <tr key={type}><td><strong>{type}</strong></td><td>{stats.total.toLocaleString()}</td><td>{stats.due.toLocaleString()}</td><td>{stats.allocated.toLocaleString()}</td><td>{stats.unallocated.toLocaleString()}</td><td>{stats.future.toLocaleString()}</td><td>{stats.review.toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><BarChart3 size={25}/></div><h2>No lead type data yet</h2><p>Lead type reporting will populate once lead-ready lists are imported.</p></div>}
    </div>
  </>;
}
