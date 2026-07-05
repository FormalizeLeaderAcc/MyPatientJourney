"use client";

import { useMemo, useState } from "react";
import {
  Activity, BarChart3, Bell, Building2, CalendarCheck, CalendarClock, ChevronDown, ClipboardCheck,
  CloudUpload, FileBarChart, HeartHandshake, LayoutDashboard, ListChecks, LogOut, Menu, Network,
  Search, Settings, ShieldCheck, Sparkles, Stethoscope, Users, X
} from "lucide-react";
import type { Lead, Role } from "@/lib/types";
import { demoUsers, leads as initialLeads } from "@/lib/mock-data";
import { Overview } from "./views/overview";
import { LeadsView } from "./views/leads-view";
import { UploadCentre } from "./views/upload-centre";
import { BookingVerification } from "./views/booking-verification";
import { CompaniesView } from "./views/companies-view";
import { MedicalAidView } from "./views/medical-aid-view";
import { TeamActivity } from "./views/team-activity";
import { PlaceholderView } from "./views/placeholder-view";
import { LeadDrawer } from "./lead-drawer";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type NavItem = { id: string; label: string; icon: typeof Activity; count?: number };

const roleNav: Record<Role, { section: string; items: NavItem[] }[]> = {
  super: [
    { section: "Command centre", items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "companies", label: "Companies", icon: Building2 },
      { id: "branches", label: "Branches", icon: Network },
      { id: "users", label: "Users", icon: Users },
    ]},
    { section: "Patient journeys", items: [
      { id: "upload", label: "Upload Centre", icon: CloudUpload },
      { id: "campaigns", label: "Recall Campaigns", icon: HeartHandshake },
      { id: "allocation", label: "Lead Allocation", icon: ListChecks, count: 46 },
      { id: "medical-aid", label: "Medical Aid Intelligence", icon: Sparkles },
    ]},
    { section: "Insights", items: [
      { id: "reports", label: "Reports", icon: FileBarChart },
      { id: "settings", label: "Settings", icon: Settings },
    ]},
  ],
  manager: [
    { section: "Your branch", items: [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { id: "team", label: "Team Activity", icon: Users },
      { id: "leads", label: "Patient Journeys", icon: HeartHandshake },
      { id: "verification", label: "Booking Verification", icon: CalendarCheck, count: 14 },
      { id: "review", label: "Manager Review", icon: ClipboardCheck, count: 9 },
      { id: "reports", label: "Reports", icon: FileBarChart },
    ]},
  ],
  employee: [
    { section: "My recall work", items: [
      { id: "dashboard", label: "My Dashboard", icon: LayoutDashboard },
      { id: "leads", label: "My Leads", icon: HeartHandshake, count: 48 },
      { id: "due", label: "Due Today", icon: CalendarClock, count: 12 },
      { id: "callbacks", label: "Callbacks", icon: Activity, count: 3 },
      { id: "completed", label: "Completed", icon: ClipboardCheck },
    ]},
  ],
};

export default function DashboardClient({ initialRole }: { initialRole: Role }) {
  const [role, setRole] = useState<Role>(initialRole);
  const [active, setActive] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadData, setLeadData] = useState(initialLeads);
  const [toast, setToast] = useState("");
  const user = demoUsers[role];

  const flatNav = useMemo(() => roleNav[role].flatMap((section) => section.items), [role]);
  const activeLabel = flatNav.find((item) => item.id === active)?.label ?? "Dashboard";

  function switchRole(next: Role) {
    setRole(next); setActive("dashboard");
    document.cookie = `mpj_demo_session=${next}; path=/; max-age=86400; SameSite=Lax`;
  }
  function navigate(id: string) { setActive(id); setMenuOpen(false); }
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3200); }
  function updateLead(next: Lead) {
    setLeadData((current) => current.map((lead) => lead.id === next.id ? next : lead));
    setSelectedLead(next);
  }
  async function logout() {
    if (isSupabaseConfigured) await createSupabaseBrowserClient().auth.signOut();
    document.cookie = "mpj_demo_session=; path=/; max-age=0";
    document.cookie = "mpj_role=; path=/; max-age=0";
    window.location.href = "/login";
  }

  function renderView() {
    if (active === "dashboard") return <Overview role={role} leads={leadData} onLead={setSelectedLead} onNavigate={navigate} />;
    if (["leads", "due", "callbacks", "completed", "allocation", "campaigns", "review"].includes(active)) return <LeadsView role={role} mode={active} leads={leadData} onLead={setSelectedLead} notify={notify} />;
    if (active === "upload") return <UploadCentre notify={notify} />;
    if (active === "verification") return <BookingVerification leads={leadData} notify={notify} onUpdate={updateLead} />;
    if (active === "companies" || active === "branches" || active === "users") return <CompaniesView mode={active} notify={notify} />;
    if (active === "medical-aid") return <MedicalAidView notify={notify} />;
    if (active === "team") return <TeamActivity />;
    return <PlaceholderView title={activeLabel} role={role} />;
  }

  return (
    <div className="app">
      {menuOpen && <div className="drawer-backdrop" style={{ zIndex: 35 }} onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark"><Stethoscope size={19} /></div><div className="brand-word">MyPatient Journey</div></div>
        <div className="workspace-chip"><span>Current workspace</span><strong>{role === "super" ? "All organisations" : "Dr KY Sepeng Inc"}<ChevronDown size={13} /></strong></div>
        {roleNav[role].map((section) => <div key={section.section}>
          <div className="nav-section">{section.section}</div>
          <nav className="nav-list">{section.items.map((item) => <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}><item.icon size={16} strokeWidth={1.8} /><span>{item.label}</span>{item.count ? <span className="count">{item.count}</span> : null}</button>)}</nav>
        </div>)}
        <div className="sidebar-footer">
          <div className="user-mini"><div className="avatar">{user.initials}</div><div><strong>{user.name}</strong><span>{user.roleLabel}</span></div><button aria-label="Sign out" onClick={logout} className="nav-item" style={{ marginLeft: "auto", width: 32, padding: 8 }}><LogOut size={14} /></button></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}><button aria-label={menuOpen ? "Close navigation" : "Open navigation"} className="icon-btn mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={17} /> : <Menu size={17} />}</button><div className="crumb">MyPatient Journey &nbsp;/&nbsp; <strong>{activeLabel}</strong></div></div>
          <div className="top-actions">
            <select aria-label="Switch demo role" className="role-switch" value={role} onChange={(e) => switchRole(e.target.value as Role)}><option value="employee">Employee demo</option><option value="manager">Manager demo</option><option value="super">Super User demo</option></select>
            <button className="icon-btn" aria-label="Search"><Search size={16} /></button>
            <button className="icon-btn" aria-label="Notifications"><Bell size={16} /><span className="dot" /></button>
            <div className="avatar">{user.initials}</div>
          </div>
        </header>
        <div className="content">{renderView()}</div>
      </main>
      {selectedLead && <LeadDrawer lead={selectedLead} employeeName={user.name} onClose={() => setSelectedLead(null)} onUpdate={updateLead} notify={notify} />}
      {toast && <div className="toast"><ShieldCheck size={17} />{toast}</div>}
    </div>
  );
}
