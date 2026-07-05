"use client";

import { useState } from "react";
import { ArrowRight, Eye, LockKeyhole, Mail, ShieldCheck, Stethoscope } from "lucide-react";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    if (!isSupabaseConfigured) {
      setError("Live authentication is not configured yet. Please contact Formalize Admin.");
      setLoading(false);
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !data.user) {
      setError(authError?.message ?? "Unable to sign in");
      setLoading(false);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setError("Sign-in was accepted, but this browser did not store the secure session. Please refresh this local page and try again.");
      setLoading(false);
      return;
    }

    const { data: roleRows } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    const uiRole = roleRows?.some((row) => row.role === "super_user" || row.role === "sub_super_user")
      ? "super"
      : roleRows?.some((row) => row.role === "manager")
        ? "manager"
        : "employee";

    const secureCookie = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `mpj_role=${uiRole}; path=/; max-age=86400; SameSite=Lax${secureCookie}`;
    window.location.href = "/dashboard";
  }

  return (
    <main className="login-shell">
      <section className="login-visual">
        <div className="brand">
          <div className="brand-mark"><Stethoscope size={22} strokeWidth={2.2} /></div>
          <div className="brand-word">MyPatient Journey</div>
        </div>

        <div className="login-copy">
          <div className="eyebrow">Continuity of care, made visible</div>
          <h1>Every patient deserves a journey back to care.</h1>
          <p>A calm, intelligent command centre for dental recalls — helping your team turn patient data into timely, human follow-up.</p>
          <div className="journey-preview" aria-label="Patient recall journey">
            <div className="journey-step done"><i>✓</i><span>Identify</span></div><div className="journey-line" />
            <div className="journey-step done"><i>✓</i><span>Allocate</span></div><div className="journey-line" />
            <div className="journey-step"><i>3</i><span>Connect</span></div><div className="journey-line" />
            <div className="journey-step"><i>4</i><span>Verify care</span></div>
          </div>
        </div>
        <div className="login-foot">© 2026 MyPatient Journey · Secure dental recall management</div>
      </section>

      <section className="login-form-wrap">
        <div className="login-card">
          <h2>Welcome back</h2>
          <p className="login-sub">Sign in with the credentials provided by Formalize Admin.</p>
          <form onSubmit={signIn}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <div className="input-wrap"><Mail size={16} /><input id="email" className="input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></div>
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-wrap">
                <LockKeyhole size={16} />
                <input id="password" className="input password-input" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} autoComplete="current-password" required />
                <button className="password-toggle" type="button" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}><Eye size={16} /></button>
              </div>
            </div>
            {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldCheck size={14} /><span>{error}</span></div>}
            <div className="login-row">
              <label className="check"><input type="checkbox" defaultChecked /> Keep me signed in</label>
              <a href="/forgot-password" className="text-link">Forgot password?</a>
            </div>
            <button className="btn btn-primary btn-wide" type="submit" disabled={loading}>{loading ? "Opening your workspace..." : <>Sign in securely <ArrowRight size={16} /></>}</button>
          </form>

          <div className="callout login-access-note" style={{ marginTop: 22 }}>
            <ShieldCheck size={14} />
            <span>If you do not have sign-in details, please contact Formalize Admin at <a className="text-link" href="mailto:mypatientjourney@formalize.co.za">mypatientjourney@formalize.co.za</a>. MyPatient Journey is currently available to Formalize clients only.</span>
          </div>
          <p className="secure-note"><ShieldCheck size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Protected live workspace</p>
        </div>
      </section>
    </main>
  );
}
