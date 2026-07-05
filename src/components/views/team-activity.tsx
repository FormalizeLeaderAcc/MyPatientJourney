"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import type { AssignableUser, Lead } from "@/lib/types";

const finalStatuses = new Set(["Patient Booked and Verified", "Patient Not Interested", "Wrong Number Confirmed"]);

export function TeamActivity({
  leads,
  employees,
  onNavigate,
}: {
  leads: Lead[];
  employees: AssignableUser[];
  onNavigate?: (page: string) => void;
}) {
  const [query, setQuery] = useState("");
  const activeLeads = leads.filter((lead) => !finalStatuses.has(lead.status));
  const contactedLeads = leads.filter((lead) => lead.attempts > 0);
  const whatsappSent = leads.filter((lead) => lead.status === "WhatsApp Sent").length;
  const verifiedBookings = leads.filter((lead) => lead.status === "Patient Booked and Verified").length;

  const rows = useMemo(() => employees.map((employee) => {
    const allocated = leads.filter((lead) => lead.assignedTo === employee.name);
    const active = allocated.filter((lead) => !finalStatuses.has(lead.status));
    const contacted = allocated.filter((lead) => lead.attempts > 0);
    const attempts = allocated.reduce((sum, lead) => sum + lead.attempts, 0);
    const bookingsRecorded = allocated.filter((lead) => lead.status === "Booking Recorded Pending Verification" || lead.status === "Patient Booked and Verified").length;
    const bookingsVerified = allocated.filter((lead) => lead.status === "Patient Booked and Verified").length;
    const conversionRate = contacted.length ? Math.round((bookingsVerified / contacted.length) * 100) : 0;
    return {
      employee,
      allocated: allocated.length,
      active: active.length,
      contacted: contacted.length,
      attempts,
      whatsapp: allocated.filter((lead) => lead.status === "WhatsApp Sent").length,
      callbacks: allocated.filter((lead) => ["Callback Due", "Call Back Later"].includes(lead.status)).length,
      bookingsRecorded,
      bookingsVerified,
      conversionRate,
    };
  }).filter((row) => {
    if (!query.trim()) return true;
    return `${row.employee.name} ${row.employee.email}`.toLowerCase().includes(query.toLowerCase());
  }), [employees, leads, query]);

  return <>
    <div className="page-head"><div><h1>Team activity</h1><p>Real contact effort, patient outcomes and conversion quality across your branch.</p></div><button className="btn btn-primary" onClick={() => onNavigate?.("allocation")}><Users size={14}/>Manage allocation</button></div>
    <div className="metric-grid" style={{gridTemplateColumns:"repeat(4,1fr)"}}>
      {[
        ["Team members", String(employees.length), employees.length ? "Active employees in scope" : "No active employees found"],
        ["Active leads", String(activeLeads.length), "Live recall journeys"],
        ["Recorded attempts", String(contactedLeads.reduce((sum, lead) => sum + lead.attempts, 0)), contactedLeads.length ? `${contactedLeads.length} contacted lead(s)` : "No activity yet"],
        ["Verified bookings", String(verifiedBookings), whatsappSent ? `${whatsappSent} WhatsApp sent` : "No bookings verified"],
      ].map((row,i)=><div className={`metric-card ${["teal","blue","violet","orange"][i]}`} key={row[0]}><div className="metric-label">{row[0]}</div><div className="metric-value">{row[1]}</div><div className="metric-trend">{row[2]}</div></div>)}
    </div>
    <div className="toolbar"><div className="searchbar"><Search size={14}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search employee..."/></div></div>
    <div className="card">
      <div className="card-head"><div><div className="card-title">Employee performance</div><div className="card-sub">Calculated from live patient journeys currently visible in your manager scope</div></div></div>
      {rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Employee</th><th>Allocated</th><th>Active</th><th>Contacted</th><th>Attempts</th><th>WhatsApp</th><th>Callbacks</th><th>Bookings recorded</th><th>Verified</th><th>Conversion</th></tr></thead><tbody>{rows.map((row)=><tr key={row.employee.id}><td><strong>{row.employee.name}</strong><br/><small>{row.employee.email}</small></td><td>{row.allocated.toLocaleString()}</td><td>{row.active.toLocaleString()}</td><td>{row.contacted.toLocaleString()}</td><td>{row.attempts.toLocaleString()}</td><td>{row.whatsapp.toLocaleString()}</td><td>{row.callbacks.toLocaleString()}</td><td>{row.bookingsRecorded.toLocaleString()}</td><td>{row.bookingsVerified.toLocaleString()}</td><td>{row.conversionRate}%</td></tr>)}</tbody></table></div> : <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><Users size={25}/></div><h2>No employee activity shown</h2><p>{query ? "No employee matches your search." : "Create or activate employees in this branch, then allocate live recall leads to measure productivity."}</p></div>}
    </div>
  </>;
}
