"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity, Bell, Building2, CalendarCheck, CalendarClock, ChevronDown, ClipboardCheck,
  CloudUpload, FileBarChart, HeartHandshake, LayoutDashboard, ListChecks, LogOut, Menu, Network,
  Search, Settings, ShieldCheck, Sparkles, Stethoscope, Users, X
} from "lucide-react";
import type { Lead, Role } from "@/lib/types";
import { Overview } from "./views/overview";
import { LeadsView } from "./views/leads-view";
import { UploadCentre } from "./views/upload-centre";
import { BookingVerification } from "./views/booking-verification";
import { CompaniesView } from "./views/companies-view";
import { MedicalAidView } from "./views/medical-aid-view";
import { TeamActivity } from "./views/team-activity";
import { PlaceholderView } from "./views/placeholder-view";
import { AccountSettingsView } from "./views/account-settings-view";
import { LeadDrawer } from "./lead-drawer";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type NavItem = { id: string; label: string; icon: typeof Activity };
type CurrentUser = { name: string; roleLabel: string; email: string; initials: string; workspace: string; avatarUrl?: string | null; preferences?: Record<string, unknown> };

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
      { id: "allocation", label: "Lead Allocation", icon: ListChecks },
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
      { id: "verification", label: "Booking Verification", icon: CalendarCheck },
      { id: "review", label: "Manager Review", icon: ClipboardCheck },
      { id: "reports", label: "Reports", icon: FileBarChart },
      { id: "settings", label: "Settings", icon: Settings },
    ]},
  ],
  employee: [
    { section: "My recall work", items: [
      { id: "dashboard", label: "My Dashboard", icon: LayoutDashboard },
      { id: "leads", label: "My Leads", icon: HeartHandshake },
      { id: "due", label: "Due Today", icon: CalendarClock },
      { id: "callbacks", label: "Callbacks", icon: Activity },
      { id: "completed", label: "Completed", icon: ClipboardCheck },
      { id: "settings", label: "Settings", icon: Settings },
    ]},
  ],
};

function initialsFrom(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "MP";
}

function roleLabel(role: Role) {
  if (role === "super") return "Super User";
  if (role === "manager") return "Manager";
  return "Patient Care Coordinator";
}

function userPatchInitials(name: string) {
  return initialsFrom(name);
}

export default function DashboardClient({ initialRole }: { initialRole: Role }) {
  const [role, setRole] = useState<Role>(initialRole);
  const [active, setActive] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [leadData, setLeadData] = useState<Lead[]>([]);
  const [toast, setToast] = useState("");
  const [user, setUser] = useState<CurrentUser>({
    name: "MyPatient Journey User",
    roleLabel: roleLabel(initialRole),
    email: "",
    initials: "MP",
    workspace: initialRole === "super" ? "All organisations" : "Assigned workspace",
  });

  useEffect(() => {
    async function loadIdentity() {
      if (!isSupabaseConfigured) return;
      const supabase = createSupabaseBrowserClient();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;

      const { data: profile } = await supabase
        .from("users")
        .select("full_name,email,company_id,branch_id,avatar_url,preferences")
        .eq("id", authData.user.id)
        .maybeSingle();
      const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", authData.user.id);
      const nextRole: Role = roleRows?.some((row) => row.role === "super_user" || row.role === "sub_super_user")
        ? "super"
        : roleRows?.some((row) => row.role === "manager")
          ? "manager"
          : "employee";

      const displayName = profile?.full_name || authData.user.user_metadata?.full_name || authData.user.email || "MyPatient Journey User";
      setRole(nextRole);
      const secureCookie = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `mpj_role=${nextRole}; path=/; max-age=86400; SameSite=Lax${secureCookie}`;
      setUser({
        name: displayName,
        roleLabel: roleLabel(nextRole),
        email: profile?.email || authData.user.email || "",
        initials: initialsFrom(displayName),
        workspace: nextRole === "super" ? "All organisations" : "Assigned workspace",
        avatarUrl: profile?.avatar_url ?? authData.user.user_metadata?.avatar_url ?? null,
        preferences: (profile?.preferences ?? {}) as Record<string, unknown>,
      });
    }

    void loadIdentity();
  }, []);

  const flatNav = useMemo(() => roleNav[role].flatMap((section) => section.items), [role]);
  const activeLabel = flatNav.find((item) => item.id === active)?.label ?? "Dashboard";

  function navigate(id: string) { setActive(id); setMenuOpen(false); }
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 3200); }
  function updateLead(next: Lead) {
    setLeadData((current) => current.map((lead) => lead.id === next.id ? next : lead));
    setSelectedLead(next);
  }
  function updateCurrentUser(next: Partial<CurrentUser>) {
    setUser((current) => {
      const nextName = next.name ?? current.name;
      return { ...current, ...next, initials: next.name ? userPatchInitials(nextName) : current.initials };
    });
  }
  async function logout() {
    if (isSupabaseConfigured) await createSupabaseBrowserClient().auth.signOut();
    document.cookie = "mpj_role=; path=/; max-age=0";
    window.location.href = "/login";
  }

  function renderView() {
    if (active === "dashboard") return <Overview role={role} userName={user.name} leads={leadData} onLead={setSelectedLead} onNavigate={navigate} />;
    if (["leads", "due", "callbacks", "completed", "allocation", "campaigns", "review"].includes(active)) return <LeadsView role={role} mode={active} leads={leadData} onLead={setSelectedLead} notify={notify} />;
    if (active === "upload") return <UploadCentre notify={notify} />;
    if (active === "verification") return <BookingVerification leads={leadData} notify={notify} onUpdate={updateLead} />;
    if (active === "companies" || active === "branches" || active === "users") return <CompaniesView mode={active} notify={notify} />;
    if (active === "medical-aid") return <MedicalAidView notify={notify} />;
    if (active === "team") return <TeamActivity />;
    if (active === "settings") return <AccountSettingsView user={user} onUserUpdate={updateCurrentUser} notify={notify} />;
    return <PlaceholderView title={activeLabel} role={role} />;
  }

  return (
    <div className="app">
      {menuOpen && <div className="drawer-backdrop" style={{ zIndex: 35 }} onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark"><Stethoscope size={19} /></div><div className="brand-word">MyPatient Journey</div></div>
        <div className="workspace-chip"><span>Current workspace</span><strong>{user.workspace}<ChevronDown size={13} /></strong></div>
        {roleNav[role].map((section) => <div key={section.section}>
          <div className="nav-section">{section.section}</div>
          <nav className="nav-list">{section.items.map((item) => <button key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}><item.icon size={16} strokeWidth={1.8} /><span>{item.label}</span></button>)}</nav>
        </div>)}
        <div className="sidebar-footer">
          <div className="user-mini"><div className="avatar">{user.initials}</div><div><strong>{user.name}</strong><span>{user.roleLabel}</span></div><button aria-label="Sign out" onClick={logout} className="nav-item" style={{ marginLeft: "auto", width: 32, padding: 8 }}><LogOut size={14} /></button></div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}><button aria-label={menuOpen ? "Close navigation" : "Open navigation"} className="icon-btn mobile-menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={17} /> : <Menu size={17} />}</button><div className="crumb">MyPatient Journey &nbsp;/&nbsp; <strong>{activeLabel}</strong></div></div>
          <div className="top-actions">
            <button className="icon-btn" aria-label="Search"><Search size={16} /></button>
            <button className="icon-btn" aria-label="Notifications"><Bell size={16} /></button>
            {user.avatarUrl ? <img alt="Profile" src={user.avatarUrl} style={{ width: 34, height: 34, borderRadius: 12, objectFit: "cover" }} /> : <div className="avatar">{user.initials}</div>}
          </div>
        </header>
        <div className="content">{renderView()}</div>
      </main>
      {selectedLead && <LeadDrawer lead={selectedLead} employeeName={user.name} onClose={() => setSelectedLead(null)} onUpdate={updateLead} notify={notify} />}
      {toast && <div className="toast"><ShieldCheck size={17} />{toast}</div>}
    </div>
  );
}
