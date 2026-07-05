"use client";

import { useMemo, useState } from "react";
import { Bell, Camera, LockKeyhole, LogOut, Save, ShieldCheck, UserRound } from "lucide-react";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

type AccountUser = {
  name: string;
  roleLabel: string;
  email: string;
  initials: string;
  workspace: string;
  avatarUrl?: string | null;
  preferences?: Record<string, unknown>;
};

export function AccountSettingsView({
  user,
  onUserUpdate,
  notify,
}: {
  user: AccountUser;
  onUserUpdate: (next: Partial<AccountUser>) => void;
  notify: (message: string) => void;
}) {
  const [fullName, setFullName] = useState(user.name);
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl ?? "");
  const [password, setPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [error, setError] = useState("");
  const [preferences, setPreferences] = useState({
    emailDigest: Boolean(user.preferences?.emailDigest ?? true),
    bookingAlerts: Boolean(user.preferences?.bookingAlerts ?? true),
    compactLeadCards: Boolean(user.preferences?.compactLeadCards ?? false),
  });

  const preview = useMemo(() => avatarUrl.trim(), [avatarUrl]);

  async function updateProfile(event: React.FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setError("");
    const response = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update_profile",
        full_name: fullName,
        avatar_url: avatarUrl || null,
        preferences,
      }),
    });
    const result = await response.json();
    setSavingProfile(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to update account settings.");
      return;
    }
    onUserUpdate({ name: fullName, avatarUrl: avatarUrl || null, preferences });
    notify("Account settings updated");
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setSavingPassword(true);
    setError("");
    const response = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "change_password", password }),
    });
    const result = await response.json();
    setSavingPassword(false);
    if (!response.ok) {
      setError(result.error ?? "Unable to change password.");
      return;
    }
    setPassword("");
    notify("Password changed");
  }

  async function logout() {
    if (isSupabaseConfigured) await createSupabaseBrowserClient().auth.signOut();
    document.cookie = "mpj_role=; path=/; max-age=0";
    window.location.href = "/login";
  }

  function loadPicture(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (selected.size > 180_000) {
      notify("Please choose a smaller profile picture under 180 KB for this MVP profile store.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(String(reader.result ?? ""));
    reader.readAsDataURL(selected);
  }

  return <>
    <div className="page-head">
      <div>
        <h1>Account settings</h1>
        <p>Manage your own profile, security and preferences without changing anyone else&apos;s access.</p>
      </div>
      <button className="btn btn-secondary" onClick={logout}><LogOut size={14} />Log out</button>
    </div>

    {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldCheck size={14}/><span>{error}</span></div>}

    <div className="company-grid" style={{ gridTemplateColumns: "minmax(280px, 0.9fr) minmax(320px, 1.3fr)" }}>
      <div className="card">
        <div className="card-body">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {preview ? <img alt="Profile" src={preview} style={{ width: 68, height: 68, borderRadius: 22, objectFit: "cover", border: "1px solid #dce8e5" }} /> : <div className="avatar" style={{ width: 68, height: 68, borderRadius: 22, fontSize: 18 }}>{user.initials}</div>}
            <div>
              <h3 style={{ margin: 0, fontFamily: "Manrope", fontSize: 18 }}>{user.name}</h3>
              <p style={{ margin: "5px 0", color: "#7b8e8b", fontSize: 11 }}>{user.email}</p>
              <span className="badge standard">{user.roleLabel}</span>
            </div>
          </div>
          <div className="callout" style={{ marginTop: 18, marginBottom: 0 }}>
            <ShieldCheck size={14}/>
            <span>Your permissions are controlled by your role. Profile changes do not change your system access.</span>
          </div>
        </div>
      </div>

      <form className="card" onSubmit={updateProfile}>
        <div className="card-head">
          <div><div className="card-title">Profile information</div><div className="card-sub">Update your visible name, picture and personal preferences.</div></div>
        </div>
        <div className="card-body form-grid">
          <div className="form-field"><label>Full name</label><div className="input-wrap" style={{ boxShadow: "none" }}><UserRound size={15}/><input className="form-control" value={fullName} onChange={(event) => setFullName(event.target.value)} required /></div></div>
          <div className="form-field"><label>Profile picture URL</label><input className="form-control" value={avatarUrl.startsWith("data:") ? "Uploaded image selected" : avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://..." disabled={avatarUrl.startsWith("data:")} /></div>
          <div className="form-field full"><label>Upload/change profile picture</label><label className="btn btn-soft" style={{ width: "fit-content" }}><Camera size={13}/>Choose image<input hidden type="file" accept="image/*" onChange={loadPicture}/></label></div>
          <div className="form-field full">
            <label>Preferences</label>
            <div style={{ display: "grid", gap: 8, fontSize: 11, color: "#627572" }}>
              <label className="check"><input type="checkbox" checked={preferences.emailDigest} onChange={(event) => setPreferences((current) => ({ ...current, emailDigest: event.target.checked }))}/> Daily activity summary email</label>
              <label className="check"><input type="checkbox" checked={preferences.bookingAlerts} onChange={(event) => setPreferences((current) => ({ ...current, bookingAlerts: event.target.checked }))}/> Booking verification alerts</label>
              <label className="check"><input type="checkbox" checked={preferences.compactLeadCards} onChange={(event) => setPreferences((current) => ({ ...current, compactLeadCards: event.target.checked }))}/> Compact patient journey cards</label>
            </div>
          </div>
          <div className="form-field full"><button className="btn btn-primary" disabled={savingProfile}>{savingProfile ? "Saving..." : <><Save size={13}/>Save profile</>}</button></div>
        </div>
      </form>
    </div>

    <form className="card" onSubmit={changePassword} style={{ marginTop: 18 }}>
      <div className="card-head">
        <div><div className="card-title">Security</div><div className="card-sub">Change your password for this MyPatient Journey account.</div></div>
      </div>
      <div className="card-body form-grid">
        <div className="form-field"><label>New password</label><div className="input-wrap" style={{ boxShadow: "none" }}><LockKeyhole size={15}/><input className="form-control" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required /></div></div>
        <div className="form-field"><label>Notification preference</label><div className="callout" style={{ margin: 0 }}><Bell size={14}/><span>Password changes are applied through Supabase Auth and audited.</span></div></div>
        <div className="form-field full"><button className="btn btn-primary" disabled={savingPassword || password.length < 8}>{savingPassword ? "Updating..." : "Change password"}</button></div>
      </div>
    </form>
  </>;
}
