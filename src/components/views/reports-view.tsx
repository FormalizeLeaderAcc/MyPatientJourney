"use client";

import { ArrowDownToLine, BarChart3, FileBarChart } from "lucide-react";
import type { Lead, Role } from "@/lib/types";

const finalStatuses = new Set(["Patient Booked and Verified", "Patient Not Interested", "Wrong Number Confirmed", "Manager Closed"]);

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
  const allocated = active.filter((lead) => lead.assignedTo !== "Unallocated");
  const contacted = leads.filter((lead) => lead.attempts > 0);
  const pendingVerification = leads.filter((lead) => lead.status === "Booking Recorded Pending Verification");
  const verified = leads.filter((lead) => lead.status === "Patient Booked and Verified");
  const managerReview = leads.filter((lead) => lead.status === "Manager Review");
  const managerClosed = leads.filter((lead) => lead.status === "Manager Closed");
  const conversionRate = contacted.length ? Math.round((verified.length / contacted.length) * 100) : 0;

  const byBranch = Array.from(leads.reduce((map, lead) => {
    const current = map.get(lead.branch) ?? { total: 0, active: 0, allocated: 0, verified: 0, review: 0 };
    current.total += 1;
    if (!finalStatuses.has(lead.status)) current.active += 1;
    if (lead.assignedTo !== "Unallocated") current.allocated += 1;
    if (lead.status === "Patient Booked and Verified") current.verified += 1;
    if (lead.status === "Manager Review") current.review += 1;
    map.set(lead.branch, current);
    return map;
  }, new Map<string, { total: number; active: number; allocated: number; verified: number; review: number }>()).entries());

  function exportReport() {
    downloadCsv(
      `my-patient-journey-report-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Branch", "Total Leads", "Active Leads", "Allocated", "Verified Bookings", "Manager Review"],
      byBranch.map(([branch, stats]) => [branch, stats.total, stats.active, stats.allocated, stats.verified, stats.review]),
    );
    notify("Report exported.");
  }

  return <>
    <div className="page-head"><div><h1>Reports</h1><p>Operational recall performance, allocation coverage and booking verification outcomes.</p></div><button className="btn btn-primary" onClick={exportReport}><FileBarChart size={14}/>Export report</button></div>
    <div className="metric-grid">
      {metric("Total leads", leads.length, "All visible patient journeys", "teal")}
      {metric("Active leads", active.length, "Still in workflow", "blue")}
      {metric("Allocated", allocated.length, "Assigned to employees", "violet")}
      {metric("Verified bookings", verified.length, `${conversionRate}% conversion from contacted`, "orange")}
    </div>
    <div className="metric-grid" style={{ gridTemplateColumns: "repeat(4,1fr)", marginTop: 12 }}>
      {metric("Contacted", contacted.length, "At least one attempt recorded", "teal")}
      {metric("Pending verification", pendingVerification.length, "Needs calendar check", "rose")}
      {metric("Manager review", managerReview.length, "Needs operational decision", "blue")}
      {metric("Manager closed", managerClosed.length, "Closed by manager decision", "violet")}
    </div>
    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head"><div><div className="card-title">Branch performance</div><div className="card-sub">Counts are calculated from the live lead list currently visible to your role: {role === "super" ? "all organisations" : "assigned scope"}.</div></div><button className="btn btn-secondary" onClick={exportReport}><ArrowDownToLine size={13}/>CSV</button></div>
      {byBranch.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Branch</th><th>Total leads</th><th>Active</th><th>Allocated</th><th>Verified bookings</th><th>Manager review</th></tr></thead><tbody>{byBranch.map(([branch, stats]) => <tr key={branch}><td><strong>{branch}</strong></td><td>{stats.total.toLocaleString()}</td><td>{stats.active.toLocaleString()}</td><td>{stats.allocated.toLocaleString()}</td><td>{stats.verified.toLocaleString()}</td><td>{stats.review.toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><BarChart3 size={25}/></div><h2>No report data yet</h2><p>Upload and allocate live recall leads to populate operational reporting.</p></div>}
    </div>
  </>;
}
