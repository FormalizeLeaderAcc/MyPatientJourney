"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Bell, Building2, CalendarCheck, CalendarClock, ChevronDown, ClipboardCheck,
  CloudUpload, FileBarChart, HeartHandshake, LayoutDashboard, ListChecks, LogOut, Menu, Network,
  Search, Settings, ShieldCheck, Sparkles, Stethoscope, Users, X
} from "lucide-react";
import type { AssignableUser, Lead, Role } from "@/lib/types";
import { Overview } from "./views/overview";
import { LeadsView } from "./views/leads-view";
import { UploadCentre } from "./views/upload-centre";
import { BookingVerification } from "./views/booking-verification";
import { CompaniesView } from "./views/companies-view";
import { MedicalAidView } from "./views/medical-aid-view";
import { TeamActivity } from "./views/team-activity";
import { RecallCampaignsView } from "./views/recall-campaigns-view";
import { PlaceholderView } from "./views/placeholder-view";
import { AccountSettingsView } from "./views/account-settings-view";
import { ReportsView } from "./views/reports-view";
import { LeadDrawer } from "./lead-drawer";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type NavItem = { id: string; label: string; icon: typeof Activity };
type CurrentUser = { name: string; roleLabel: string; email: string; initials: string; workspace: string; avatarUrl?: string | null; preferences?: Record<string, unknown> };
type SetupStats = { companyCount: number; branchCount: number; userCount: number };

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
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [setupStats, setSetupStats] = useState<SetupStats>({ companyCount: 0, branchCount: 0, userCount: 0 });
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadsError, setLeadsError] = useState("");
  const [toast, setToast] = useState("");
  const [user, setUser] = useState<CurrentUser>({
    name: "MyPatient Journey User",
    roleLabel: roleLabel(initialRole),
    email: "",
    initials: "MP",
    workspace: initialRole === "super" ? "All organisations" : "Assigned workspace",
  });

  const loadLeads = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLeadsLoading(false);
      return;
    }
    setLeadsLoading(true);
    setLeadsError("");
    try {
      const response = await fetch("/api/leads", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) {
        setLeadsError(result.error ?? "Unable to load live patient journeys.");
        setLeadData([]);
        return;
      }
      setLeadData(result.leads ?? []);
    } catch {
      setLeadsError("Unable to load live patient journeys.");
      setLeadData([]);
    } finally {
      setLeadsLoading(false);
    }
  }, []);

  const loadAssignableUsers = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const response = await fetch("/api/allocations", { cache: "no-store" });
      const result = await response.json();
      if (response.ok) setAssignableUsers(result.users ?? []);
    } catch {
      setAssignableUsers([]);
    }
  }, []);

  const loadSetupStats = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const supabase = createSupabaseBrowserClient();
      const [companyResult, branchResult, userResult] = await Promise.all([
        supabase.from("companies").select("id", { count: "exact", head: true }),
        supabase.from("branches").select("id", { count: "exact", head: true }),
        supabase.from("users").select("id", { count: "exact", head: true }),
      ]);
      setSetupStats({
        companyCount: companyResult.count ?? 0,
        branchCount: branchResult.count ?? 0,
        userCount: userResult.count ?? 0,
      });
    } catch {
      setSetupStats({ companyCount: 0, branchCount: 0, userCount: 0 });
    }
  }, []);

  useEffect(() => {
    async function loadIdentity() {
      if (!isSupabaseConfigured) return;
      const supabase = createSupabaseBrowserClient();
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;

      await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "activate_invited_user" }),
      }).catch(() => undefined);

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

  useEffect(() => { void loadLeads(); }, [loadLeads]);
  useEffect(() => { void loadSetupStats(); }, [loadSetupStats]);
  useEffect(() => { if (role !== "employee") void loadAssignableUsers(); }, [role, loadAssignableUsers]);

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
    if (active === "dashboard") return <Overview role={role} userName={user.name} leads={leadData} stats={setupStats} onLead={setSelectedLead} onNavigate={navigate} />;
    if (active === "campaigns") return <RecallCampaignsView leads={leadData} onNavigate={navigate} />;
    if (["leads", "due", "callbacks", "completed", "allocation", "review"].includes(active)) return <>
      {leadsError && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850", marginBottom: 14 }}><ShieldCheck size={14} /><span>{leadsError}</span></div>}
      {leadsLoading && <div className="callout" style={{ marginBottom: 14 }}><ShieldCheck size={14} /><span>Loading live patient journeys from Supabase...</span></div>}
      <LeadsView role={role} mode={active} leads={leadData} assignableUsers={assignableUsers} onLead={setSelectedLead} notify={notify} onRefresh={loadLeads} />
    </>;
    if (active === "upload") return <UploadCentre notify={notify} onImported={loadLeads} />;
    if (active === "verification") return <BookingVerification notify={notify} onRefresh={loadLeads} />;
    if (active === "companies" || active === "branches" || active === "users") return <CompaniesView mode={active} notify={notify} leads={leadData} />;
    if (active === "medical-aid") return <MedicalAidView notify={notify} />;
    if (active === "team") return <TeamActivity onNavigate={navigate} />;
    if (active === "reports") return <ReportsView leads={leadData} role={role} notify={notify} />;
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
            <button className="icon-btn" aria-label="Search" onClick={() => notify("Use the search box inside the current page to find patients, employees, companies or reports.")}><Search size={16} /></button>
            <button className="icon-btn" aria-label="Notifications" onClick={() => notify("Notification centre is not connected yet. Critical import and allocation messages appear inside each workspace for now.")}><Bell size={16} /></button>
            {user.avatarUrl ? <img alt="Profile" src={user.avatarUrl} style={{ width: 34, height: 34, borderRadius: 12, objectFit: "cover" }} /> : <div className="avatar">{user.initials}</div>}
          </div>
        </header>
        <div className="content">{renderView()}</div>
      </main>
      {selectedLead && <LeadDrawer lead={selectedLead} employeeName={user.name} onClose={() => setSelectedLead(null)} onUpdate={updateLead} onRefresh={loadLeads} notify={notify} />}
      {toast && <div className="toast"><ShieldCheck size={17} />{toast}</div>}
    </div>
  );
}
