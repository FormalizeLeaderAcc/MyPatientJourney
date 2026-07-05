"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Building2, Edit3, KeyRound, LoaderCircle, Plus, RotateCcw, Search, ShieldAlert, ShieldCheck, Trash2, UserX, Users } from "lucide-react";
import type { Lead } from "@/lib/types";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Company = { id: string; name: string; registration_number: string | null; is_active: boolean; created_at: string };
type Branch = { id: string; company_id: string; name: string; practice_phone: string | null; is_active: boolean; created_at: string };
type UserStatus = "active" | "invited" | "blocked" | "suspended" | "deleted";
type UserProfile = {
  id: string;
  full_name: string;
  email: string;
  company_id: string | null;
  branch_id: string | null;
  is_active: boolean;
  account_status?: UserStatus | null;
  is_primary_super?: boolean | null;
};
type UserRole = { user_id: string; role: "super_user" | "sub_super_user" | "manager" | "employee"; company_id: string | null; branch_id: string | null };
type WorkMode = "reassign" | "return_to_pool" | "leave_pending";
type PendingUserAction = { type: "suspend" | "block" | "reactivate" | "delete" | "reset" | "edit-email"; user: UserProfile } | null;
type PendingOrgAction =
  | { type: "delete-company"; company: Company }
  | { type: "delete-branch"; branch: Branch }
  | null;

const roleLabels: Record<UserRole["role"], string> = {
  super_user: "Super User",
  sub_super_user: "Sub Super User",
  manager: "Manager",
  employee: "Employee",
};

const statusStyles: Record<UserStatus, string> = {
  active: "standard",
  invited: "high",
  blocked: "missing",
  suspended: "dormant",
  deleted: "missing",
};

const finalLeadStatuses = new Set(["Patient Booked and Verified", "Patient Not Interested", "Wrong Number Confirmed", "Manager Closed"]);

export function CompaniesView({ mode, notify, leads = [] }: { mode:string; notify:(message:string)=>void; leads?: Lead[] }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchCompanyId, setBranchCompanyId] = useState("");
  const [practicePhone, setPracticePhone] = useState("");
  const [editingCompanyId, setEditingCompanyId] = useState("");
  const [editingBranchId, setEditingBranchId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole["role"]>("employee");
  const [userCompanyId, setUserCompanyId] = useState("");
  const [userBranchId, setUserBranchId] = useState("");
  const [editingUserId, setEditingUserId] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingUserAction>(null);
  const [replacementUserId, setReplacementUserId] = useState("");
  const [workMode, setWorkMode] = useState<WorkMode>("return_to_pool");
  const [newEmail, setNewEmail] = useState("");
  const [pendingOrgAction, setPendingOrgAction] = useState<PendingOrgAction>(null);
  const [confirmPassword, setConfirmPassword] = useState("");

  const title = mode === "users" ? "Users & access" : mode === "branches" ? "Branches" : "Companies";
  const noun = mode === "users" ? "user" : mode === "branches" ? "branch" : "company";

  async function loadData() {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setError("Live Supabase is not configured.");
      return;
    }
    setLoading(true);
    setError("");
    const supabase = createSupabaseBrowserClient();
    const [companyResult, branchResult, userResult, roleResult] = await Promise.all([
      supabase.from("companies").select("id,name,registration_number,is_active,created_at").order("created_at", { ascending: false }),
      supabase.from("branches").select("id,company_id,name,practice_phone,is_active,created_at").order("created_at", { ascending: false }),
      supabase.from("users").select("id,full_name,email,company_id,branch_id,is_active,account_status,is_primary_super").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id,role,company_id,branch_id"),
    ]);

    let loadedUsers = userResult.data as UserProfile[] | null;
    if (userResult.error) {
      const fallback = await supabase.from("users").select("id,full_name,email,company_id,branch_id,is_active").order("created_at", { ascending: false });
      loadedUsers = fallback.data as UserProfile[] | null;
      if (fallback.error) setError(fallback.error.message);
    }

    if (companyResult.error || branchResult.error || roleResult.error) {
      setError(companyResult.error?.message || branchResult.error?.message || roleResult.error?.message || "Unable to load setup data.");
    } else {
      setCompanies(companyResult.data ?? []);
      setBranches(branchResult.data ?? []);
      setUsers(loadedUsers ?? []);
      setRoles((roleResult.data ?? []) as UserRole[]);
      setBranchCompanyId((companyResult.data ?? [])[0]?.id ?? "");
      setUserCompanyId((companyResult.data ?? [])[0]?.id ?? "");
    }
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, [mode]);

  async function adminAction(payload: Record<string, unknown>) {
    setSaving(true);
    setError("");
    const response = await fetch("/api/admin/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to save. Please try again.");
      return false;
    }
    notify(result.message ?? "Saved successfully");
    await loadData();
    return true;
  }

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    const payload = editingCompanyId
      ? { action: "update_company", company_id: editingCompanyId, name: companyName, registration_number: registrationNumber || null }
      : { action: "create_company", name: companyName, registration_number: registrationNumber || null };
    const ok = await adminAction(payload);
    if (ok) resetCompanyForm();
  }

  async function createBranch(event: FormEvent) {
    event.preventDefault();
    const payload = editingBranchId
      ? { action: "update_branch", branch_id: editingBranchId, name: branchName, practice_phone: practicePhone || null }
      : { action: "create_branch", company_id: branchCompanyId, name: branchName, practice_phone: practicePhone || null };
    const ok = await adminAction(payload);
    if (ok) resetBranchForm();
  }

  function resetCompanyForm() {
    setEditingCompanyId("");
    setCompanyName("");
    setRegistrationNumber("");
  }

  function resetBranchForm() {
    setEditingBranchId("");
    setBranchName("");
    setPracticePhone("");
  }

  function editCompany(company: Company) {
    setEditingCompanyId(company.id);
    setCompanyName(company.name);
    setRegistrationNumber(company.registration_number ?? "");
  }

  function editBranch(branch: Branch) {
    setEditingBranchId(branch.id);
    setBranchCompanyId(branch.company_id);
    setBranchName(branch.name);
    setPracticePhone(branch.practice_phone ?? "");
  }

  async function inviteOrUpdateUser(event: FormEvent) {
    event.preventDefault();
    const payload = editingUserId
      ? { action: "update_user_profile", user_id: editingUserId, full_name: fullName, role, company_id: userCompanyId || null, branch_id: userBranchId || null }
      : { action: "invite_user", full_name: fullName, email, role, company_id: userCompanyId || null, branch_id: userBranchId || null };
    const ok = await adminAction(payload);
    if (ok) resetUserForm();
  }

  function resetUserForm() {
    setEditingUserId("");
    setFullName("");
    setEmail("");
    setRole("employee");
    setUserBranchId("");
  }

  function editUser(user: UserProfile) {
    const userRole = roles.find((item) => item.user_id === user.id);
    setEditingUserId(user.id);
    setFullName(user.full_name);
    setEmail(user.email);
    setRole(userRole?.role ?? "employee");
    setUserCompanyId(user.company_id ?? "");
    setUserBranchId(user.branch_id ?? "");
  }

  async function runPendingAction() {
    if (!pendingAction) return;
    const work_handling = pendingAction.type === "reactivate" || pendingAction.type === "reset" || pendingAction.type === "edit-email"
      ? undefined
      : workMode === "reassign"
        ? { mode: "reassign", replacement_user_id: replacementUserId }
        : { mode: workMode };
    const payload =
      pendingAction.type === "reset" ? { action: "send_password_reset", user_id: pendingAction.user.id } :
      pendingAction.type === "edit-email" ? { action: "change_user_email", user_id: pendingAction.user.id, email: newEmail } :
      pendingAction.type === "delete" ? { action: "delete_user", user_id: pendingAction.user.id, work_handling } :
      { action: "set_user_status", user_id: pendingAction.user.id, status: pendingAction.type === "reactivate" ? "active" : pendingAction.type === "block" ? "blocked" : "suspended", work_handling };

    const ok = await adminAction(payload);
    if (ok) {
      setPendingAction(null);
      setReplacementUserId("");
      setNewEmail("");
      setWorkMode("return_to_pool");
    }
  }

  async function runPendingOrgAction() {
    if (!pendingOrgAction) return;
    const payload = pendingOrgAction.type === "delete-company"
      ? { action: "delete_company", company_id: pendingOrgAction.company.id, password: confirmPassword }
      : { action: "delete_branch", branch_id: pendingOrgAction.branch.id, password: confirmPassword };
    const ok = await adminAction(payload);
    if (ok) {
      setPendingOrgAction(null);
      setConfirmPassword("");
    }
  }

  const companyById = useMemo(() => Object.fromEntries(companies.map((company) => [company.id, company])), [companies]);
  const branchById = useMemo(() => Object.fromEntries(branches.map((branch) => [branch.id, branch])), [branches]);
  const activeLeadCountForCompany = (companyId: string) => leads.filter((lead) => lead.companyId === companyId && !finalLeadStatuses.has(lead.status)).length;
  const verifiedLeadCountForCompany = (companyId: string) => leads.filter((lead) => lead.companyId === companyId && lead.status === "Patient Booked and Verified").length;
  const activeLeadCountForBranch = (branchId: string) => leads.filter((lead) => lead.branchId === branchId && !finalLeadStatuses.has(lead.status)).length;
  const filteredBranches = branches.filter((branch) => !query || `${branch.name} ${companyById[branch.company_id]?.name}`.toLowerCase().includes(query.toLowerCase()));
  const filteredUsers = users.filter((user) => !query || `${user.full_name} ${user.email}`.toLowerCase().includes(query.toLowerCase()));
  const activeReplacementUsers = users.filter((user) => user.id !== pendingAction?.user.id && user.is_active && (user.account_status ?? "active") === "active");

  return <>
    <div className="page-head"><div><h1>{title}</h1><p>Manage the live organisational structure, assignments and access boundaries.</p></div><button className="btn btn-primary" onClick={()=>notify(`Use the form below to add a ${noun}.`)}><Plus size={14}/>Add {noun}</button></div>
    {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldCheck size={14}/><span>{error}</span></div>}
    {loading ? <div className="card empty-page"><div className="empty-icon"><LoaderCircle className="animate-spin" size={25}/></div><h2>Loading live setup data</h2><p>Checking Supabase for companies, branches and user access.</p></div> : null}

    {!loading && mode === "companies" && <>
      <form className="card" onSubmit={createCompany} style={{ marginBottom: 18 }}>
        <div className="card-head"><div><div className="card-title">{editingCompanyId ? "Edit company" : "Add company"}</div><div className="card-sub">{editingCompanyId ? "Update the client organisation name or registration notes." : "Create the client organisation before adding branches and users."}</div></div>{editingCompanyId && <button type="button" className="btn btn-secondary" onClick={resetCompanyForm}><RotateCcw size={13}/>Cancel edit</button>}</div>
        <div className="card-body form-grid">
          <div className="form-field"><label>Company name</label><input className="form-control" value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Practice or group name" required /></div>
          <div className="form-field"><label>Registration / notes</label><input className="form-control" value={registrationNumber} onChange={(event) => setRegistrationNumber(event.target.value)} placeholder="Optional" /></div>
          <div className="form-field full"><button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : editingCompanyId ? "Save company changes" : "Create company"}</button></div>
        </div>
      </form>
      <div className="callout" style={{ marginBottom: 14 }}><ShieldAlert size={14}/><span>Protected delete rule: a company can only be deleted by the primary Super User, with password confirmation, and only when it has no active leads.</span></div>
      {companies.length ? <div className="company-grid">{companies.map(company=>{ const activeCount = activeLeadCountForCompany(company.id); return <div className="card company-card" key={company.id}><div className="company-top"><div className="company-logo"><Building2 size={21}/></div><span className={`badge ${company.is_active ? "standard" : "missing"}`}>{company.is_active ? "Active" : "Inactive"}</span></div><h3>{company.name}</h3><p>{company.registration_number || "No registration details captured yet"}</p><div className="company-stats"><div className="company-stat"><strong>{branches.filter((branch) => branch.company_id === company.id).length}</strong><span>Branches</span></div><div className="company-stat"><strong>{users.filter((user) => user.company_id === company.id).length}</strong><span>Users</span></div><div className="company-stat"><strong>{activeCount.toLocaleString()}</strong><span>Active leads</span></div><div className="company-stat"><strong>{verifiedLeadCountForCompany(company.id).toLocaleString()}</strong><span>Verified</span></div></div><div className="company-footer"><span>Created {new Date(company.created_at).toLocaleDateString()}</span><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button className="btn btn-soft" onClick={() => editCompany(company)}><Edit3 size={12}/>Edit</button><button className="btn btn-danger-soft" disabled={!company.is_active || activeCount > 0} title={activeCount > 0 ? "Recall or complete active leads before deleting this company." : undefined} onClick={() => setPendingOrgAction({ type: "delete-company", company })}><Trash2 size={12}/>Delete</button></div></div></div>; })}</div> : <div className="card empty-page"><div className="empty-icon"><Building2 size={25}/></div><h2>No companies yet</h2><p>Add the first Formalize client company to begin live setup.</p></div>}
    </>}

    {!loading && mode === "branches" && <>
      <form className="card" onSubmit={createBranch} style={{ marginBottom: 18 }}>
        <div className="card-head"><div><div className="card-title">{editingBranchId ? "Edit branch" : "Add branch"}</div><div className="card-sub">{editingBranchId ? "Update the branch name or practice phone number." : "Branches define manager visibility, employee allocation and reporting scope."}</div></div>{editingBranchId && <button type="button" className="btn btn-secondary" onClick={resetBranchForm}><RotateCcw size={13}/>Cancel edit</button>}</div>
        <div className="card-body form-grid">
          <div className="form-field"><label>Company</label><select className="form-control" value={branchCompanyId} onChange={(event) => setBranchCompanyId(event.target.value)} required disabled={Boolean(editingBranchId)}><option value="">Select company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
          <div className="form-field"><label>Branch name</label><input className="form-control" value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="Branch / practice location" required /></div>
          <div className="form-field"><label>Practice phone</label><input className="form-control" value={practicePhone} onChange={(event) => setPracticePhone(event.target.value)} placeholder="Optional" /></div>
          <div className="form-field full"><button className="btn btn-primary" disabled={saving || !companies.length}>{saving ? "Saving..." : editingBranchId ? "Save branch changes" : "Create branch"}</button></div>
        </div>
      </form>
      <div className="callout" style={{ marginBottom: 14 }}><ShieldAlert size={14}/><span>Protected delete rule: a branch can only be deleted by the primary Super User, with password confirmation, and only when it has no active leads.</span></div>
      <div className="toolbar"><div className="searchbar"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search branches..." /></div></div>
      {filteredBranches.length ? <div className="company-grid" style={{ marginBottom: 18 }}>{filteredBranches.map((branch) => { const activeCount = activeLeadCountForBranch(branch.id); return <div className="card company-card" key={`manage-${branch.id}`}><div className="company-top"><div className="company-logo"><Building2 size={21}/></div><span className={`badge ${branch.is_active ? "standard" : "missing"}`}>{branch.is_active ? "Active" : "Inactive"}</span></div><h3>{branch.name}</h3><p>{companyById[branch.company_id]?.name ?? "Unknown company"} · {branch.practice_phone ?? "No phone captured"}</p><div className="company-stats"><div className="company-stat"><strong>{users.filter((user) => user.branch_id === branch.id).length}</strong><span>Users</span></div><div className="company-stat"><strong>{activeCount.toLocaleString()}</strong><span>Active leads</span></div></div><div className="company-footer"><span>Created {new Date(branch.created_at).toLocaleDateString()}</span><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button className="btn btn-soft" onClick={() => editBranch(branch)}><Edit3 size={12}/>Edit</button><button className="btn btn-danger-soft" disabled={!branch.is_active || activeCount > 0} title={activeCount > 0 ? "Recall or complete active leads before deleting this branch." : undefined} onClick={() => setPendingOrgAction({ type: "delete-branch", branch })}><Trash2 size={12}/>Delete</button></div></div></div>; })}</div> : null}
      <div className="card"><div className="table-wrap"><table className="data-table"><thead><tr><th>Branch</th><th>Company</th><th>Phone</th><th>Users</th><th>Active leads</th><th>Status</th></tr></thead><tbody>{filteredBranches.map(branch=><tr key={branch.id}><td><strong>{branch.name}</strong></td><td>{companyById[branch.company_id]?.name ?? "Unknown company"}</td><td>{branch.practice_phone ?? "—"}</td><td>{users.filter((user) => user.branch_id === branch.id).length}</td><td>{activeLeadCountForBranch(branch.id).toLocaleString()}</td><td><span className="badge standard">{branch.is_active ? "Active" : "Inactive"}</span></td></tr>)}</tbody></table>{!filteredBranches.length && <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><Building2 size={25}/></div><h2>No branches yet</h2><p>Create a company branch to start assigning managers and employees.</p></div>}</div></div>
    </>}

    {!loading && mode === "users" && <>
      <form className="card" onSubmit={inviteOrUpdateUser} style={{ marginBottom: 18 }}>
        <div className="card-head"><div><div className="card-title">{editingUserId ? "Edit user access" : "Invite user"}</div><div className="card-sub">Super Users can manage operational users. Primary Super User approval is required for Super/Sub Super User accounts.</div></div>{editingUserId && <button type="button" className="btn btn-secondary" onClick={resetUserForm}><RotateCcw size={13}/>Cancel edit</button>}</div>
        <div className="card-body form-grid">
          <div className="form-field"><label>Full name</label><input className="form-control" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></div>
          <div className="form-field"><label>Email</label><input className="form-control" type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={Boolean(editingUserId)} required /></div>
          <div className="form-field"><label>Role</label><select className="form-control" value={role} onChange={(event) => setRole(event.target.value as UserRole["role"])}><option value="employee">Employee</option><option value="manager">Manager</option><option value="sub_super_user">Sub Super User</option><option value="super_user">Super User</option></select></div>
          <div className="form-field"><label>Company</label><select className="form-control" value={userCompanyId} onChange={(event) => { setUserCompanyId(event.target.value); setUserBranchId(""); }}><option value="">All companies / assign later</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
          <div className="form-field"><label>Branch</label><select className="form-control" value={userBranchId} onChange={(event) => setUserBranchId(event.target.value)}><option value="">Company-wide / assign later</option>{branches.filter((branch) => !userCompanyId || branch.company_id === userCompanyId).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>
          <div className="form-field full"><button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : editingUserId ? "Save user changes" : "Invite user"}</button></div>
        </div>
      </form>
      <div className="callout"><ShieldAlert size={14}/><span>Hard safety rail: when a user is suspended, blocked or deleted, active allocated work must be reassigned, returned to the unallocated pool, or deliberately left pending. It cannot disappear.</span></div>
      <div className="toolbar"><div className="searchbar"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users..." /></div></div>
      <div className="card"><div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Branch</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filteredUsers.map(user=>{ const userRole = roles.find((item) => item.user_id === user.id); const status = (user.account_status ?? (user.is_active ? "active" : "suspended")) as UserStatus; return <tr key={user.id}><td><strong>{user.full_name}</strong>{user.is_primary_super && <div style={{ fontSize: 8, color: "#0b7a75", marginTop: 3 }}>Primary Super User</div>}</td><td>{user.email}</td><td>{userRole ? roleLabels[userRole.role] : "Pending role"}</td><td>{user.company_id ? companyById[user.company_id]?.name ?? "Unknown" : "All / unassigned"}</td><td>{user.branch_id ? branchById[user.branch_id]?.name ?? "Unknown" : "Unassigned"}</td><td><span className={`badge ${statusStyles[status]}`}>{status}</span></td><td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button className="btn btn-soft" onClick={() => editUser(user)}><Edit3 size={12}/>Edit</button><button className="btn btn-soft" onClick={() => setPendingAction({ type: "reset", user })}><KeyRound size={12}/>Reset</button>{status === "active" ? <><button className="btn btn-soft" onClick={() => setPendingAction({ type: "suspend", user })}><UserX size={12}/>Suspend</button><button className="btn btn-soft" onClick={() => setPendingAction({ type: "block", user })}><ShieldAlert size={12}/>Block</button></> : <button className="btn btn-soft" onClick={() => setPendingAction({ type: "reactivate", user })}>Reactivate</button>}<button className="btn btn-danger-soft" onClick={() => setPendingAction({ type: "delete", user })}><Trash2 size={12}/>Delete</button></div></td></tr>; })}</tbody></table>{!filteredUsers.length && <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><Users size={25}/></div><h2>No users yet</h2><p>Invite the first manager or employee once the company and branch exist.</p></div>}</div></div>
    </>}

    {pendingOrgAction && <div className="modal-backdrop" onClick={() => { setPendingOrgAction(null); setConfirmPassword(""); }}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><strong>{pendingOrgAction.type === "delete-company" ? "Delete company safely" : "Delete branch safely"}</strong><button className="icon-btn" onClick={() => { setPendingOrgAction(null); setConfirmPassword(""); }}>×</button></div>
        <div className="modal-body">
          <div className="callout" style={{ background: "#fff4ed", alignItems: "flex-start" }}><ShieldAlert size={14}/><span>This is a protected primary-Super-User action. The system will block deletion if active leads exist. Historical records remain traceable and this decision is written to the audit trail.</span></div>
          <p style={{ fontSize: 11, color: "#657875", lineHeight: 1.6 }}>{pendingOrgAction.type === "delete-company" ? <>Company: <strong>{pendingOrgAction.company.name}</strong><br/>Active leads currently visible: {activeLeadCountForCompany(pendingOrgAction.company.id).toLocaleString()}</> : <>Branch: <strong>{pendingOrgAction.branch.name}</strong><br/>Company: {companyById[pendingOrgAction.branch.company_id]?.name ?? "Unknown company"}<br/>Active leads currently visible: {activeLeadCountForBranch(pendingOrgAction.branch.id).toLocaleString()}</>}</p>
          <div className="form-field"><label>Confirm with your Super User password *</label><input className="form-control" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter your login password" autoComplete="current-password" /></div>
        </div>
        <div className="modal-actions"><button className="btn btn-secondary" onClick={() => { setPendingOrgAction(null); setConfirmPassword(""); }}>Cancel</button><button className="btn btn-danger-soft" disabled={saving || !confirmPassword.trim()} onClick={runPendingOrgAction}>{saving ? "Checking..." : "Confirm protected delete"}</button></div>
      </div>
    </div>}

    {pendingAction && <div className="modal-backdrop" onClick={() => setPendingAction(null)}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><strong>{pendingAction.type === "delete" ? "Delete user safely" : pendingAction.type === "reset" ? "Send password reset" : pendingAction.type === "reactivate" ? "Reactivate user" : pendingAction.type === "block" ? "Block user" : "Suspend user"}</strong><button className="icon-btn" onClick={() => setPendingAction(null)}>×</button></div>
        <div className="modal-body">
          <p style={{ fontSize: 11, color: "#657875", lineHeight: 1.6 }}>User: <strong>{pendingAction.user.full_name}</strong> · {pendingAction.user.email}</p>
          {["suspend", "block", "delete"].includes(pendingAction.type) && <div className="form-grid">
            <div className="form-field full"><label>Allocated work handling *</label><select className="form-control" value={workMode} onChange={(event) => setWorkMode(event.target.value as WorkMode)}><option value="return_to_pool">Return work to unallocated pool</option><option value="reassign">Reassign work to another active user</option><option value="leave_pending">Leave work pending until manual reassignment</option></select></div>
            {workMode === "reassign" && <div className="form-field full"><label>Replacement user</label><select className="form-control" value={replacementUserId} onChange={(event) => setReplacementUserId(event.target.value)} required><option value="">Choose active user</option>{activeReplacementUsers.map((user) => <option key={user.id} value={user.id}>{user.full_name} · {user.email}</option>)}</select></div>}
            <div className="callout full" style={{ margin: 0 }}><ShieldCheck size={14}/><span>The API will refuse this action if allocated work exists and no handling decision is supplied.</span></div>
          </div>}
          {pendingAction.type === "reset" && <div className="callout"><KeyRound size={14}/><span>A secure Supabase password reset email will be sent to this user.</span></div>}
          {pendingAction.type === "reactivate" && <div className="callout"><ShieldCheck size={14}/><span>This restores sign-in access. Existing permissions remain unchanged.</span></div>}
        </div>
        <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setPendingAction(null)}>Cancel</button><button className="btn btn-primary" disabled={saving || (workMode === "reassign" && !replacementUserId)} onClick={runPendingAction}>{saving ? "Working..." : "Confirm"}</button></div>
      </div>
    </div>}
  </>;
}
