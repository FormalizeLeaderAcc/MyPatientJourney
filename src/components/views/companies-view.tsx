"use client";

import { useEffect, useMemo, useState } from "react";
import { Building2, LoaderCircle, Plus, Search, ShieldCheck, Users } from "lucide-react";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type Company = { id: string; name: string; registration_number: string | null; is_active: boolean; created_at: string };
type Branch = { id: string; company_id: string; name: string; practice_phone: string | null; is_active: boolean; created_at: string };
type UserProfile = { id: string; full_name: string; email: string; company_id: string | null; branch_id: string | null; is_active: boolean };
type UserRole = { user_id: string; role: "super_user" | "manager" | "employee"; company_id: string | null; branch_id: string | null };

export function CompaniesView({ mode, notify }: { mode:string; notify:(message:string)=>void }) {
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
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"manager" | "employee">("employee");
  const [userCompanyId, setUserCompanyId] = useState("");
  const [userBranchId, setUserBranchId] = useState("");

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
      supabase.from("users").select("id,full_name,email,company_id,branch_id,is_active").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id,role,company_id,branch_id"),
    ]);
    if (companyResult.error || branchResult.error || userResult.error || roleResult.error) {
      setError(companyResult.error?.message || branchResult.error?.message || userResult.error?.message || roleResult.error?.message || "Unable to load setup data.");
    } else {
      setCompanies(companyResult.data ?? []);
      setBranches(branchResult.data ?? []);
      setUsers(userResult.data ?? []);
      setRoles((roleResult.data ?? []) as UserRole[]);
      setBranchCompanyId((companyResult.data ?? [])[0]?.id ?? "");
      setUserCompanyId((companyResult.data ?? [])[0]?.id ?? "");
    }
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, []);

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

  async function createCompany(event: React.FormEvent) {
    event.preventDefault();
    const ok = await adminAction({ action: "create_company", name: companyName, registration_number: registrationNumber || null });
    if (ok) { setCompanyName(""); setRegistrationNumber(""); }
  }

  async function createBranch(event: React.FormEvent) {
    event.preventDefault();
    const ok = await adminAction({ action: "create_branch", company_id: branchCompanyId, name: branchName, practice_phone: practicePhone || null });
    if (ok) { setBranchName(""); setPracticePhone(""); }
  }

  async function inviteUser(event: React.FormEvent) {
    event.preventDefault();
    const ok = await adminAction({ action: "invite_user", full_name: fullName, email, role, company_id: userCompanyId || null, branch_id: userBranchId || null });
    if (ok) { setFullName(""); setEmail(""); setRole("employee"); }
  }

  const companyById = useMemo(() => Object.fromEntries(companies.map((company) => [company.id, company])), [companies]);
  const branchById = useMemo(() => Object.fromEntries(branches.map((branch) => [branch.id, branch])), [branches]);
  const filteredBranches = branches.filter((branch) => !query || `${branch.name} ${companyById[branch.company_id]?.name}`.toLowerCase().includes(query.toLowerCase()));
  const filteredUsers = users.filter((user) => !query || `${user.full_name} ${user.email}`.toLowerCase().includes(query.toLowerCase()));

  return <>
    <div className="page-head"><div><h1>{title}</h1><p>Manage the live organisational structure, assignments and access boundaries.</p></div><button className="btn btn-primary" onClick={()=>notify(`Use the form below to add a ${noun}.`)}><Plus size={14}/>Add {noun}</button></div>
    {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldCheck size={14}/><span>{error}</span></div>}
    {loading ? <div className="card empty-page"><div className="empty-icon"><LoaderCircle className="animate-spin" size={25}/></div><h2>Loading live setup data</h2><p>Checking Supabase for companies, branches and user access.</p></div> : null}

    {!loading && mode === "companies" && <>
      <form className="card" onSubmit={createCompany} style={{ marginBottom: 18 }}>
        <div className="card-head"><div><div className="card-title">Add company</div><div className="card-sub">Create the client organisation before adding branches and users.</div></div></div>
        <div className="card-body form-grid">
          <div className="form-field"><label>Company name</label><input className="form-control" value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Practice or group name" required /></div>
          <div className="form-field"><label>Registration / notes</label><input className="form-control" value={registrationNumber} onChange={(event) => setRegistrationNumber(event.target.value)} placeholder="Optional" /></div>
          <div className="form-field full"><button className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : "Create company"}</button></div>
        </div>
      </form>
      {companies.length ? <div className="company-grid">{companies.map(company=><div className="card company-card" key={company.id}><div className="company-top"><div className="company-logo"><Building2 size={21}/></div><span className="badge standard">{company.is_active ? "Active" : "Inactive"}</span></div><h3>{company.name}</h3><p>{company.registration_number || "No registration details captured yet"}</p><div className="company-stats"><div className="company-stat"><strong>{branches.filter((branch) => branch.company_id === company.id).length}</strong><span>Branches</span></div><div className="company-stat"><strong>{users.filter((user) => user.company_id === company.id).length}</strong><span>Users</span></div><div className="company-stat"><strong>0</strong><span>Recall leads</span></div><div className="company-stat"><strong>0</strong><span>Verified</span></div></div><div className="company-footer"><span>Created {new Date(company.created_at).toLocaleDateString()}</span></div></div>)}</div> : <div className="card empty-page"><div className="empty-icon"><Building2 size={25}/></div><h2>No companies yet</h2><p>Add the first Formalize client company to begin live setup.</p></div>}
    </>}

    {!loading && mode === "branches" && <>
      <form className="card" onSubmit={createBranch} style={{ marginBottom: 18 }}>
        <div className="card-head"><div><div className="card-title">Add branch</div><div className="card-sub">Branches define manager visibility, employee allocation and reporting scope.</div></div></div>
        <div className="card-body form-grid">
          <div className="form-field"><label>Company</label><select className="form-control" value={branchCompanyId} onChange={(event) => setBranchCompanyId(event.target.value)} required><option value="">Select company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
          <div className="form-field"><label>Branch name</label><input className="form-control" value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="Branch / practice location" required /></div>
          <div className="form-field"><label>Practice phone</label><input className="form-control" value={practicePhone} onChange={(event) => setPracticePhone(event.target.value)} placeholder="Optional" /></div>
          <div className="form-field full"><button className="btn btn-primary" disabled={saving || !companies.length}>{saving ? "Saving..." : "Create branch"}</button></div>
        </div>
      </form>
      <div className="toolbar"><div className="searchbar"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search branches..." /></div></div>
      <div className="card"><div className="table-wrap"><table className="data-table"><thead><tr><th>Branch</th><th>Company</th><th>Phone</th><th>Users</th><th>Active leads</th><th>Status</th></tr></thead><tbody>{filteredBranches.map(branch=><tr key={branch.id}><td><strong>{branch.name}</strong></td><td>{companyById[branch.company_id]?.name ?? "Unknown company"}</td><td>{branch.practice_phone ?? "—"}</td><td>{users.filter((user) => user.branch_id === branch.id).length}</td><td>0</td><td><span className="badge standard">{branch.is_active ? "Active" : "Inactive"}</span></td></tr>)}</tbody></table>{!filteredBranches.length && <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><Building2 size={25}/></div><h2>No branches yet</h2><p>Create a company branch to start assigning managers and employees.</p></div>}</div></div>
    </>}

    {!loading && mode === "users" && <>
      <form className="card" onSubmit={inviteUser} style={{ marginBottom: 18 }}>
        <div className="card-head"><div><div className="card-title">Invite manager or employee</div><div className="card-sub">The app sends a secure Supabase invitation and stores the user's access boundary.</div></div></div>
        <div className="card-body form-grid">
          <div className="form-field"><label>Full name</label><input className="form-control" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></div>
          <div className="form-field"><label>Email</label><input className="form-control" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
          <div className="form-field"><label>Role</label><select className="form-control" value={role} onChange={(event) => setRole(event.target.value as "manager" | "employee")}><option value="manager">Manager</option><option value="employee">Employee</option></select></div>
          <div className="form-field"><label>Company</label><select className="form-control" value={userCompanyId} onChange={(event) => { setUserCompanyId(event.target.value); setUserBranchId(""); }} required><option value="">Select company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></div>
          <div className="form-field"><label>Branch</label><select className="form-control" value={userBranchId} onChange={(event) => setUserBranchId(event.target.value)}><option value="">Company-wide / assign later</option>{branches.filter((branch) => !userCompanyId || branch.company_id === userCompanyId).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></div>
          <div className="form-field full"><button className="btn btn-primary" disabled={saving || !companies.length}>{saving ? "Sending invitation..." : "Invite user"}</button></div>
        </div>
      </form>
      <div className="toolbar"><div className="searchbar"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users..." /></div></div>
      <div className="card"><div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Company</th><th>Branch</th><th>Status</th></tr></thead><tbody>{filteredUsers.map(user=>{ const userRole = roles.find((item) => item.user_id === user.id); return <tr key={user.id}><td><strong>{user.full_name}</strong></td><td>{user.email}</td><td>{userRole?.role?.replace("_", " ") ?? "Pending role"}</td><td>{user.company_id ? companyById[user.company_id]?.name ?? "Unknown" : "Unassigned"}</td><td>{user.branch_id ? branchById[user.branch_id]?.name ?? "Unknown" : "Unassigned"}</td><td><span className="badge standard">{user.is_active ? "Active" : "Inactive"}</span></td></tr>; })}</tbody></table>{!filteredUsers.length && <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><Users size={25}/></div><h2>No users yet</h2><p>Invite the first manager or employee once the company and branch exist.</p></div>}</div></div>
    </>}
  </>;
}
