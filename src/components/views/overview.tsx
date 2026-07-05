import { ArrowRight, CalendarCheck, CheckCircle2, ChevronRight, CircleAlert, Clock3, FileSpreadsheet, PhoneCall, Send, Sparkles, UserRoundCheck } from "lucide-react";
import type { Lead, Metric, Role } from "@/lib/types";
import { auditEvents, employeeMetrics, managerMetrics, superMetrics, team } from "@/lib/mock-data";

function Metrics({ items }: { items: Metric[] }) {
  return <div className="metric-grid">{items.map((item) => <div className={`metric-card ${item.tone}`} key={item.label}><div className="metric-label">{item.label}</div><div className="metric-value">{item.value}</div><div className="metric-trend">{item.trend}</div></div>)}</div>;
}

function priorityClass(priority: string) {
  if (priority.includes("Premium")) return "premium";
  if (priority.includes("High")) return "high";
  if (priority.includes("Dormant")) return "dormant";
  if (priority.includes("Missing")) return "missing";
  return "standard";
}

function statusClass(status: string) {
  if (status === "Callback Due" || status === "No Answer") return "due";
  if (status.includes("Pending")) return "pending";
  if (status.includes("Review")) return "review";
  if (status === "New") return "new";
  return "";
}

function LeadRows({ leads, onLead }: { leads: Lead[]; onLead: (lead: Lead) => void }) {
  return <div className="lead-list">{leads.slice(0, 5).map((lead) => <div className="lead-row" key={lead.id} onClick={() => onLead(lead)}>
    <div className="patient-cell"><div className="avatar">{lead.initials}</div><div style={{ minWidth: 0 }}><div className="patient-name">{lead.patient}</div><div className="patient-meta">{lead.account} · {lead.branch}</div></div></div>
    <div className="priority-stack"><strong className={`badge ${priorityClass(lead.priority)}`}>{lead.priority}</strong><span>{lead.medicalAid} · {lead.option}</span></div>
    <div className="next-action"><strong>{lead.nextAction}</strong><span>{lead.latestOutcome}</span></div>
    <span className={`badge status-badge ${statusClass(lead.status)}`}>{lead.status === "Booking Recorded Pending Verification" ? "Pending verify" : lead.status}</span>
    <ChevronRight size={14} color="#91a09e" />
  </div>)}</div>;
}

function ActivityPanel() {
  const icons = [CalendarCheck, Sparkles, UserRoundCheck, FileSpreadsheet];
  return <div className="card"><div className="card-head"><div><div className="card-title">Live activity</div><div className="card-sub">Latest across your workspace</div></div><button className="tiny-link">View audit log</button></div><div className="card-body" style={{ paddingTop: 4, paddingBottom: 4 }}><div className="activity-list">{auditEvents.map((event, i) => { const Icon = icons[i]; return <div className="activity" key={event.subject}><div className="activity-icon"><Icon size={13} /></div><div><strong>{event.action}</strong><p>{event.subject}</p><small>{event.by} · {event.time}</small></div></div>; })}</div></div></div>;
}

function ChartCard({ superMode = false }: { superMode?: boolean }) {
  const data = superMode ? [[74,48],[88,60],[66,51],[96,71],[84,64],[100,77],[79,65]] : [[65,39],[78,46],[58,44],[92,62],[74,57],[100,74],[68,52]];
  return <div className="card"><div className="card-head"><div><div className="card-title">{superMode ? "Recall performance" : "Patient contact momentum"}</div><div className="card-sub">Contacted patients and verified bookings · 7 days</div></div><div className="filter-tabs"><button className="filter-tab active">7 days</button><button className="filter-tab">30 days</button></div></div><div className="card-body"><div className="chart">{data.map((bars, i) => <div className="chart-col" key={i}><i className="bar teal" style={{ height: `${bars[0]}%` }} /><i className="bar pale" style={{ height: `${bars[1]}%` }} /><label>{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]}</label></div>)}</div><div className="chart-legend"><span><i className="legend-dot" />Patients contacted</span><span><i className="legend-dot pale" />Bookings verified</span></div></div></div>;
}

export function Overview({ role, leads, onLead, onNavigate }: { role: Role; leads: Lead[]; onLead: (lead: Lead) => void; onNavigate: (page: string) => void }) {
  const metrics = role === "super" ? superMetrics : role === "manager" ? managerMetrics : employeeMetrics;
  const title = role === "employee" ? "Good morning, Naledi" : role === "manager" ? "Branch overview" : "Organisation overview";
  const sub = role === "employee" ? "Here’s where your patient follow-up needs attention today." : role === "manager" ? "Polokwane Central · Sunday, 5 July 2026" : "Continuity of care across all companies and branches.";
  return <>
    <div className="page-head"><div><h1>{title}</h1><p>{sub}</p></div><div className="head-actions">{role === "super" && <button className="btn btn-secondary" onClick={() => onNavigate("upload")}><FileSpreadsheet size={14} /><span>Import data</span></button>}<button className="btn btn-primary" onClick={() => onNavigate(role === "manager" ? "verification" : "leads")}><HeartIcon /><span>{role === "manager" ? "Verify bookings" : "Open recall work"}</span></button></div></div>
    <Metrics items={metrics} />

    {role === "employee" && <>
      <div className="dashboard-grid">
        <div className="card">
          <div className="card-head"><div><div className="card-title">Next patients to support</div><div className="card-sub">Prioritised by due time, recall value and follow-up history</div></div><div className="filter-tabs"><button className="filter-tab active">Priority</button><button className="filter-tab">Due today</button></div></div>
          <LeadRows leads={leads} onLead={onLead} />
        </div>
        <div className="card">
          <div className="card-head"><div><div className="card-title">Weekly care goal</div><div className="card-sub">Verified patient bookings</div></div></div>
          <div className="card-body"><div className="goal-wrap"><div className="goal-top"><div><strong>18</strong> <span>of 25</span></div><span>72% complete</span></div><div className="goal-bar"><i /></div><div className="goal-legend"><span>Mon, 29 Jun</span><span>Sun, 5 Jul</span></div></div><div className="attention"><div className="attention-icon"><CircleAlert size={15} /></div><div><strong>3 callbacks overdue</strong><span>Bring these patients back into view.</span></div><button className="tiny-link" onClick={() => onNavigate("callbacks")}>Review</button></div></div>
        </div>
      </div>
      <div className="dashboard-grid"><ChartCard /><ActivityPanel /></div>
    </>}

    {role === "manager" && <>
      <div className="dashboard-grid">
        <ChartCard />
        <div className="card">
          <div className="card-head"><div><div className="card-title">Verification health</div><div className="card-sub">Booking authenticity · this month</div></div></div>
          <div className="card-body"><div className="goal-wrap"><div className="goal-top"><div><strong>91.4%</strong></div><span>+2.8% vs June</span></div><div className="goal-bar"><i style={{ width: "91.4%" }} /></div></div><div className="attention"><div className="attention-icon"><Clock3 size={15} /></div><div><strong>14 awaiting verification</strong><span>Oldest recorded 22 hours ago.</span></div><button className="tiny-link" onClick={() => onNavigate("verification")}>Open</button></div></div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 18 }}><div className="card-head"><div><div className="card-title">Employee productivity</div><div className="card-sub">Activity and verified care outcomes · this month</div></div><button className="tiny-link" onClick={() => onNavigate("team")}>Full team <ArrowRight size={10} /></button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Employee</th><th>Allocated</th><th>Contacted</th><th>Attempts</th><th>WhatsApps</th><th>Bookings</th><th>Verified</th><th>Conversion</th></tr></thead><tbody>{team.map((member) => <tr key={member.name}><td><span className={`online ${member.status === "Away" ? "away" : ""}`} /><strong>{member.name}</strong></td><td>{member.allocated}</td><td>{member.contacted}</td><td>{member.attempts}</td><td>{member.whatsapp}</td><td>{member.recorded}</td><td>{member.verified}</td><td><strong>{member.conversion}</strong></td></tr>)}</tbody></table></div></div>
    </>}

    {role === "super" && <>
      <div className="dashboard-grid"><ChartCard superMode /><ActivityPanel /></div>
      <div className="dashboard-grid"><div className="card"><div className="card-head"><div><div className="card-title">Recall opportunities by branch</div><div className="card-sub">Generated, allocated and converted this month</div></div><button className="tiny-link">View report</button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Branch</th><th>Company</th><th>Opportunities</th><th>Allocated</th><th>Verified</th><th>Conversion</th></tr></thead><tbody>{[["Polokwane Central","Dr KY Sepeng Inc","418","386","74","19.2%"],["Seshego","Dr KY Sepeng Inc","294","270","51","18.9%"],["Mankweng","Dr KY Sepeng Inc","236","221","38","17.2%"],["Burgersfort","Talane & Associates","322","288","42","14.6%"]].map(row => <tr key={row[0]}>{row.map((cell,i)=><td key={cell}>{i===0?<strong>{cell}</strong>:cell}</td>)}</tr>)}</tbody></table></div></div><div className="card"><div className="card-head"><div><div className="card-title">Medical aid quality</div><div className="card-sub">Active recall opportunities</div></div></div><div className="card-body">{[["Premium",398,"34%","#d3a243"],["High",426,"37%","#7656c9"],["Medium",245,"21%","#3b8fc1"],["Low / Unknown",92,"8%","#a9b8b5"]].map(row=><div key={row[0]} style={{display:"grid",gridTemplateColumns:"80px 1fr 32px",gap:10,alignItems:"center",marginBottom:16,fontSize:9}}><strong>{row[0]}</strong><div className="goal-bar"><i style={{width:String(row[2]),background:String(row[3])}} /></div><span>{row[2]}</span></div>)}</div></div></div>
    </>}
  </>;
}

function HeartIcon() { return <PhoneCall size={14} />; }
