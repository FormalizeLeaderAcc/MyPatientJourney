"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LoaderCircle, ShieldCheck, Stethoscope } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/types";

export default function ConfirmAccountPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    async function establishSession() {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) { setError(exchangeError.message); return; }
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) { setError(sessionError.message); return; }
      if (data.session) { setReady(true); return; }

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) setReady(true);
      });
      window.setTimeout(() => {
        setError((current) => current || "This invitation link is invalid or has expired. Request a new invitation from your administrator.");
      }, 5000);
      return () => listener.subscription.unsubscribe();
    }

    establishSession();
  }, []);

  async function completeSetup(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12) { setError("Use at least 12 characters for your password."); return; }
    if (password !== confirmPassword) { setError("The passwords do not match."); return; }
    setSaving(true); setError("");

    const supabase = createSupabaseBrowserClient();
    const { data, error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError || !data.user) { setError(updateError?.message ?? "Unable to complete account setup."); setSaving(false); return; }

    const appRole = data.user.app_metadata?.role as string | undefined;
    const uiRole: Role = appRole === "super_user" ? "super" : appRole === "manager" ? "manager" : "employee";
    document.cookie = `mpj_role=${uiRole}; path=/; max-age=86400; SameSite=Lax; Secure`;
    window.location.href = "/dashboard";
  }

  return <main className="login-shell">
    <section className="login-visual">
      <div className="brand"><div className="brand-mark"><Stethoscope size={22}/></div><div className="brand-word">MyPatient Journey</div></div>
      <div className="login-copy"><div className="eyebrow">Secure account activation</div><h1>Your patient-care workspace is ready.</h1><p>Choose a strong password to activate your account. Your access is protected by role-based permissions and an auditable patient journey.</p></div>
      <div className="login-foot">Every patient. Every recall. Every follow-up tracked.</div>
    </section>
    <section className="login-form-wrap"><div className="login-card">
      <div className="drop-icon" style={{ margin: "0 0 18px" }}>{ready ? <KeyRound size={23}/> : <LoaderCircle size={23} className="animate-spin"/>}</div>
      <h2>{ready ? "Set your password" : "Verifying invitation"}</h2>
      <p className="login-sub">{ready ? "Create a password with at least 12 characters." : "We’re securely validating your account invitation."}</p>
      {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldCheck size={14}/><span>{error}</span></div>}
      {ready && <form onSubmit={completeSetup}>
        <div className="field"><label htmlFor="new-password">New password</label><div className="input-wrap"><KeyRound size={16}/><input id="new-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e)=>setPassword(e.target.value)} required minLength={12}/></div></div>
        <div className="field"><label htmlFor="confirm-password">Confirm password</label><div className="input-wrap"><CheckCircle2 size={16}/><input id="confirm-password" className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} required minLength={12}/></div></div>
        <button className="btn btn-primary btn-wide" disabled={saving}>{saving ? "Activating account…" : "Activate my account"}</button>
      </form>}
    </div></section>
  </main>;
}
