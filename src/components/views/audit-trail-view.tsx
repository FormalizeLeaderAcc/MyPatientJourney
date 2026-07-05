"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, RefreshCw, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { AuditEvent } from "@/lib/types";

function actionLabel(value: string) {
  return value.replace(/^lead_action_/, "lead_").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(date);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(fileName: string, events: AuditEvent[]) {
  const headers = ["Date", "Actor", "Actor Email", "Company", "Action", "Entity Type", "Entity ID", "Before", "After", "Request ID", "IP Address"];
  const rows = events.map((event) => [
    dateTime(event.createdAt),
    event.actorName,
    event.actorEmail,
    event.companyName,
    actionLabel(event.action),
    event.entityType,
    event.entityId ?? "",
    event.beforeData ? JSON.stringify(event.beforeData) : "",
    event.afterData ? JSON.stringify(event.afterData) : "",
    event.requestId ?? "",
    event.ipAddress ?? "",
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatJson(value: Record<string, unknown> | null) {
  if (!value) return "No payload stored for this side of the event.";
  return JSON.stringify(value, null, 2);
}

export function AuditTrailView({ notify }: { notify: (message: string) => void }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [action, setAction] = useState("all");
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  async function loadAudit() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/audit?limit=1000", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Unable to load audit history.");
        setEvents([]);
        return;
      }
      setEvents(result.events ?? []);
      setSelected((current) => current ?? result.events?.[0] ?? null);
    } catch {
      setError("Unable to load audit history.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAudit(); }, []);

  const entityTypes = useMemo(() => Array.from(new Set(events.map((event) => event.entityType))).sort(), [events]);
  const actions = useMemo(() => Array.from(new Set(events.map((event) => event.action))).sort(), [events]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (entityType !== "all" && event.entityType !== entityType) return false;
      if (action !== "all" && event.action !== action) return false;
      if (!needle) return true;
      return [
        event.actorName,
        event.actorEmail,
        event.companyName,
        event.action,
        actionLabel(event.action),
        event.entityType,
        event.entityId ?? "",
        event.beforeData ? JSON.stringify(event.beforeData) : "",
        event.afterData ? JSON.stringify(event.afterData) : "",
      ].join(" ").toLowerCase().includes(needle);
    });
  }, [action, entityType, events, query]);

  const todayCount = events.filter((event) => event.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length;
  const recallCount = events.filter((event) => event.action.includes("recall")).length;
  const userActionCount = events.filter((event) => event.entityType === "user").length;

  function exportFiltered() {
    downloadCsv(`my-patient-journey-audit-${new Date().toISOString().slice(0, 10)}.csv`, filtered);
    notify("Audit trail exported.");
  }

  return <>
    <div className="page-head">
      <div>
        <h1>Audit Trail</h1>
        <p>Super User view of recorded system activity, including setup, uploads, recalls, allocations, patient actions and booking checks.</p>
      </div>
      <div className="head-actions">
        <button className="btn btn-secondary" onClick={() => void loadAudit()} disabled={loading}><RefreshCw size={14}/>{loading ? "Refreshing..." : "Refresh"}</button>
        <button className="btn btn-primary" onClick={exportFiltered} disabled={!filtered.length}><ArrowDownToLine size={14}/>Export CSV</button>
      </div>
    </div>

    <div className="metric-grid">
      <div className="metric-card teal"><div className="metric-label">Audit events</div><div className="metric-value">{events.length.toLocaleString()}</div><div className="metric-trend">Latest records loaded</div></div>
      <div className="metric-card blue"><div className="metric-label">Today</div><div className="metric-value">{todayCount.toLocaleString()}</div><div className="metric-trend">Events recorded today</div></div>
      <div className="metric-card orange"><div className="metric-label">List recalls</div><div className="metric-value">{recallCount.toLocaleString()}</div><div className="metric-trend">Withdraw/recall actions</div></div>
      <div className="metric-card violet"><div className="metric-label">User actions</div><div className="metric-value">{userActionCount.toLocaleString()}</div><div className="metric-trend">Account management records</div></div>
    </div>

    {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850", marginTop: 14 }}><ShieldCheck size={14}/><span>{error}</span></div>}
    {loading && <div className="callout" style={{ marginTop: 14 }}><ShieldCheck size={14}/><span>Loading audit history from Supabase...</span></div>}

    <div className="card" style={{ marginTop: 18 }}>
      <div className="card-head">
        <div><div className="card-title">Audit log explorer</div><div className="card-sub">Use filters to isolate who did what, when, and against which system record.</div></div>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 12 }}>
        <div className="form-grid">
          <div className="form-field full">
            <label>Search audit history</label>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 12, top: 12, color: "#7f918f" }}/>
              <input className="form-control" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actor, company, action, entity or payload..." style={{ paddingLeft: 34 }}/>
            </div>
          </div>
          <div className="form-field">
            <label>Entity type</label>
            <select className="form-control" value={entityType} onChange={(event) => setEntityType(event.target.value)}>
              <option value="all">All entity types</option>
              {entityTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div className="form-field">
            <label>Action</label>
            <select className="form-control" value={action} onChange={(event) => setAction(event.target.value)}>
              <option value="all">All actions</option>
              {actions.map((item) => <option key={item} value={item}>{actionLabel(item)}</option>)}
            </select>
          </div>
        </div>
        <div className="callout" style={{ margin: 0 }}>
          <SlidersHorizontal size={14}/>
          <span>Showing {filtered.length.toLocaleString()} of {events.length.toLocaleString()} loaded audit event(s). Audit records remain in Supabase even when an uploaded lead list is recalled.</span>
        </div>
      </div>
    </div>

    <div className="dashboard-grid" style={{ marginTop: 18, alignItems: "start" }}>
      <div className="card">
        <div className="card-head"><div><div className="card-title">Events</div><div className="card-sub">Newest first</div></div></div>
        {filtered.length ? <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Date</th><th>Actor</th><th>Company</th><th>Action</th><th>Entity</th><th></th></tr></thead>
          <tbody>{filtered.map((event) => <tr key={event.id}>
            <td><strong>{dateTime(event.createdAt)}</strong></td>
            <td><strong>{event.actorName}</strong><br/><small>{event.actorEmail || "System action"}</small></td>
            <td>{event.companyName}</td>
            <td><span className="badge standard">{actionLabel(event.action)}</span></td>
            <td><strong>{event.entityType}</strong><br/><small>{event.entityId ?? "No entity id"}</small></td>
            <td><button className="btn btn-secondary" onClick={() => setSelected(event)}>View</button></td>
          </tr>)}</tbody>
        </table></div> : <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><ShieldCheck size={25}/></div><h2>No audit events found</h2><p>{events.length ? "Adjust the filters to see matching audit records." : "No audit records have been created yet."}</p></div>}
      </div>

      <div className="card">
        <div className="card-head"><div><div className="card-title">Selected event detail</div><div className="card-sub">Before and after payload stored for traceability</div></div></div>
        {selected ? <div className="card-body" style={{ display: "grid", gap: 12 }}>
          <div className="lead-card" style={{ boxShadow: "none" }}>
            <strong>{actionLabel(selected.action)}</strong>
            <p style={{ fontSize: 10, color: "#667b77", marginTop: 4 }}>{dateTime(selected.createdAt)} · {selected.actorName} · {selected.companyName}</p>
          </div>
          <div className="form-field"><label>Entity</label><input className="form-control" value={`${selected.entityType}${selected.entityId ? ` · ${selected.entityId}` : ""}`} readOnly /></div>
          <div className="form-field"><label>Before data</label><pre className="form-control" style={{ minHeight: 120, overflow: "auto", whiteSpace: "pre-wrap" }}>{formatJson(selected.beforeData)}</pre></div>
          <div className="form-field"><label>After data</label><pre className="form-control" style={{ minHeight: 160, overflow: "auto", whiteSpace: "pre-wrap" }}>{formatJson(selected.afterData)}</pre></div>
        </div> : <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><ShieldCheck size={25}/></div><h2>No event selected</h2><p>Select an audit event to inspect the stored payload.</p></div>}
      </div>
    </div>
  </>;
}
