"use client";

import { useState } from "react";
import { ArrowRight, BriefcaseMedical, Building2, Eye, LockKeyhole, Mail, ShieldCheck, Stethoscope, Users } from "lucide-react";
import type { Role } from "@/lib/types";
import { createSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const roleData: { id: Role; label: string; icon: typeof ShieldCheck; email: string }[] = [
  { id: "super", label: "Super User", icon: ShieldCheck, email: "admin@mypatientjourney.co.za" },
  { id: "manager", label: "Manager", icon: Building2, email: "manager@drkysepeng.co.za" },
  { id: "employee", label: "Employee", icon: Users, email: "naledi@drkysepeng.co.za" },
];

export default function LoginPage() {
  const [role, setRole] = useState<Role>("employee");
  const [email, setEmail] = useState(roleData[2].email);
  const [password, setPassword] = useState("Demo@2026");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function chooseRole(next: Role) {
    setRole(next);
    setEmail(roleData.find((item) => item.id === next)?.email ?? "");
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true); setError("");
    if (isSupabaseConfigured) {
      const supabase = createSupabaseBrowserClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError || !data.user) { setError(authError?.message ?? "Unable to sign in"); setLoading(false); return; }
      const appRole = data.user.app_metadata?.role as string | undefined;
      const uiRole: Role = appRole === "super_user" ? "super" : appRole === "manager" ? "manager" : "employee";
      document.cookie = `mpj_role=${uiRole}; path=/; max-age=86400; SameSite=Lax; Secure`;
      window.location.href = "/dashboard";
      return;
    }
    document.cookie = `mpj_demo_session=${role}; path=/; max-age=86400; SameSite=Lax`;
    window.setTimeout(() => { window.location.href = "/dashboard"; }, 420);
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
          <p>A calm, intelligent command centre for dental recalls—helping your team turn patient data into timely, human follow-up.</p>
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
          <p className="login-sub">Sign in to continue your patient recall journey.</p>
          <form onSubmit={signIn}>
            <div className="field">
              <label htmlFor="email">Email address</label>
              <div className="input-wrap"><Mail size={16} /><input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></div>
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="input-wrap"><LockKeyhole size={16} /><input id="password" className="input" value={password} onChange={(e)=>setPassword(e.target.value)} type="password" required /><Eye size={15} style={{ left: "auto", right: 14 }} /></div>
            </div>
            {error && <div className="callout" style={{background:"#fbe9ea",color:"#a84850"}}><ShieldCheck size={14}/><span>{error}</span></div>}
            <div className="login-row">
              <label className="check"><input type="checkbox" defaultChecked /> Keep me signed in</label>
              <a href="#" className="text-link">Forgot password?</a>
            </div>
            <button className="btn btn-primary btn-wide" type="submit">{loading ? "Opening your workspace…" : <>Sign in securely <ArrowRight size={16} /></>}</button>
          </form>

          <div className="demo-label">Explore demo workspaces</div>
          <div className="demo-roles">
            {roleData.map((item) => <button key={item.id} type="button" className={`demo-role ${role === item.id ? "active" : ""}`} onClick={() => chooseRole(item.id)}><item.icon size={17} />{item.label}</button>)}
          </div>
          <p className="secure-note"><ShieldCheck size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Protected workspace · Demo data only</p>
        </div>
      </section>
    </main>
  );
}
