import { ArrowRight, BarChart3, CalendarCheck, CircleAlert, FileSpreadsheet, PhoneCall, Sparkles, UserRoundCheck } from "lucide-react";
import type { Lead, Metric, Role } from "@/lib/types";

function Metrics({ items }: { items: Metric[] }) {
  return <div className="metric-grid">{items.map((item) => <div className={`metric-card ${item.tone}`} key={item.label}><div className="metric-label">{item.label}</div><div className="metric-value">{item.value}</div><div className="metric-trend">{item.trend}</div></div>)}</div>;
}

function EmptyCard({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="card empty-page"><div className="empty-icon"><Sparkles size={25} /></div><h2>{title}</h2><p>{body}</p>{action && <button className="btn btn-soft" onClick={onAction}>{action}</button>}</div>;
}

function LeadRows({ leads, onLead }: { leads: Lead[]; onLead: (lead: Lead) => void }) {
  if (!leads.length) return <EmptyCard title="No patient journeys yet" body="Once leads are generated and allocated, the next patients to support will appear here." />;
  return <div className="lead-list">{leads.slice(0, 5).map((lead) => <div className="lead-row" key={lead.id} onClick={() => onLead(lead)}>
    <div className="patient-cell"><div className="avatar">{lead.initials}</div><div style={{ minWidth: 0 }}><div className="patient-name">{lead.patient}</div><div className="patient-meta">{lead.account} · {lead.branch}</div></div></div>
    <div className="priority-stack"><strong className="badge standard">{lead.priority}</strong><span>{lead.medicalAid} · {lead.option}</span></div>
    <div className="next-action"><strong>{lead.nextAction}</strong><span>{lead.latestOutcome}</span></div>
  </div>)}</div>;
}

function ActivityPanel() {
  const events: { action: string; subject: string; by: string; time: string }[] = [];
  const icons = [CalendarCheck, Sparkles, UserRoundCheck, FileSpreadsheet];
  return <div className="card"><div className="card-head"><div><div className="card-title">Live activity</div><div className="card-sub">Latest across your workspace</div></div></div><div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}>{events.length ? <div className="activity-list">{events.map((event, i) => { const Icon = icons[i] ?? Sparkles; return <div className="activity" key={event.subject}><div className="activity-icon"><Icon size={13} /></div><div><strong>{event.action}</strong><p>{event.subject}</p><small>{event.by} · {event.time}</small></div></div>; })}</div> : <div className="empty-page" style={{ boxShadow: "none", padding: 28 }}><div className="empty-icon"><BarChart3 size={24} /></div><h2>No activity yet</h2><p>Audit events will appear after companies, users, uploads, lead actions, and booking verifications begin.</p></div>}</div></div>;
}

function ChartCard({ superMode = false }: { superMode?: boolean }) {
  return <div className="card"><div className="card-head"><div><div className="card-title">{superMode ? "Recall performance" : "Patient contact momentum"}</div><div className="card-sub">Live patient journey activity</div></div></div><div className="card-body"><div className="empty-page" style={{ boxShadow: "none", padding: 28 }}><div className="empty-icon"><BarChart3 size={24} /></div><h2>No trend data yet</h2><p>Charts will populate after the first live upload, allocation, contact attempt, and booking verification.</p></div></div></div>;
}

export function Overview({ role, userName, leads, onLead, onNavigate }: { role: Role; userName: string; leads: Lead[]; onLead: (lead: Lead) => void; onNavigate: (page: string) => void }) {
  const metrics: Metric[] = role === "super"
    ? [
      { label: "Companies", value: "0", trend: "Add your first client", tone: "teal" },
      { label: "Branches", value: "0", trend: "Create branch workspaces", tone: "blue" },
      { label: "Users", value: "0", trend: "Invite managers and employees", tone: "violet" },
      { label: "Active leads", value: "0", trend: "Upload data to generate recalls", tone: "orange" },
    ]
    : role === "manager"
      ? [
        { label: "Allocated leads", value: "0", trend: "Awaiting allocation", tone: "teal" },
        { label: "Pending verification", value: "0", trend: "No bookings recorded yet", tone: "orange" },
        { label: "Overdue callbacks", value: "0", trend: "No callbacks scheduled", tone: "rose" },
        { label: "Team activity", value: "0", trend: "No activity yet", tone: "blue" },
      ]
      : [
        { label: "My active leads", value: "0", trend: "No leads allocated yet", tone: "teal" },
        { label: "Due today", value: "0", trend: "Nothing due", tone: "blue" },
        { label: "Callbacks", value: "0", trend: "No callbacks scheduled", tone: "violet" },
        { label: "Bookings recorded", value: "0", trend: "No bookings yet", tone: "orange" },
      ];
  const title = role === "employee" ? `Welcome, ${userName.split(" ")[0] || "there"}` : role === "manager" ? "Branch overview" : "Organisation overview";
  const sub = role === "employee" ? "Your allocated patient follow-ups will appear here." : role === "manager" ? "Live branch activity will appear after allocation starts." : "Start by adding a company, branch and team, then upload patient transaction data.";
  return <>
    <div className="page-head"><div><h1>{title}</h1><p>{sub}</p></div><div className="head-actions">{role === "super" && <button className="btn btn-secondary" onClick={() => onNavigate("upload")}><FileSpreadsheet size={14} /><span>Import data</span></button>}<button className="btn btn-primary" onClick={() => onNavigate(role === "super" ? "companies" : role === "manager" ? "verification" : "leads")}><HeartIcon /><span>{role === "super" ? "Start setup" : role === "manager" ? "Verify bookings" : "Open recall work"}</span></button></div></div>
    <Metrics items={metrics} />

    {role === "employee" && <>
      <div className="dashboard-grid">
        <div className="card">
          <div className="card-head"><div><div className="card-title">Next patients to support</div><div className="card-sub">Allocated patient journeys</div></div></div>
          <LeadRows leads={leads} onLead={onLead} />
        </div>
        <EmptyCard title="No care goal yet" body="Weekly targets will be shown once your manager allocates live recall journeys." />
      </div>
      <div className="dashboard-grid"><ChartCard /><ActivityPanel /></div>
    </>}

    {role === "manager" && <>
      <div className="dashboard-grid"><ChartCard /><EmptyCard title="Nothing to verify yet" body="Employee-recorded bookings will appear here for manager verification." action="Open verification" onAction={() => onNavigate("verification")} /></div>
      <EmptyCard title="No employee activity yet" body="Once employees are added and leads are allocated, productivity will appear here." action="View team activity" onAction={() => onNavigate("team")} />
    </>}

    {role === "super" && <>
      <div className="dashboard-grid"><ChartCard superMode /><ActivityPanel /></div>
      <div className="dashboard-grid">
        <EmptyCard title="No recall opportunities yet" body="Upload a transaction spreadsheet to generate the first traceable recall campaign." action="Open Upload Centre" onAction={() => onNavigate("upload")} />
        <EmptyCard title="Medical aid scoring is empty" body="Configure schemes and options so priority scoring is driven by the database." action="Configure scoring" onAction={() => onNavigate("medical-aid")} />
      </div>
    </>}
  </>;
}

function HeartIcon() { return <PhoneCall size={14} />; }
