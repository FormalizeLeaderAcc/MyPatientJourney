"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound, LoaderCircle, ShieldCheck, Stethoscope } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/types";

type Phase = "checking" | "awaiting_confirmation" | "set_password";

function isTrustedConfirmationUrl(value: string) {
  try {
    const candidate = new URL(value);
    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    return candidate.protocol === "https:" && candidate.origin === supabaseUrl.origin && candidate.pathname === "/auth/v1/verify";
  } catch {
    return false;
  }
}

function cleanAuthUrl() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function friendlyAuthError(message: string) {
  if (message.toLowerCase().includes("pkce code verifier")) {
    return "This secure link was created by the previous recovery flow and cannot be completed in this browser. Please request a fresh recovery email and use the newest link.";
  }
  return message;
}

export default function ConfirmAccountPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [confirmationUrl, setConfirmationUrl] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const suppliedConfirmationUrl = new URLSearchParams(window.location.search).get("confirmation_url");
    if (suppliedConfirmationUrl) {
      if (!isTrustedConfirmationUrl(suppliedConfirmationUrl)) {
        setError("This confirmation link is not valid. Request a new email from your administrator.");
        return;
      }
      setConfirmationUrl(suppliedConfirmationUrl);
      setPhase("awaiting_confirmation");
      return;
    }

    let timeout: number | undefined;
    let unsubscribe: (() => void) | undefined;

    async function establishSession() {
      const searchParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const linkError = searchParams.get("error_description") ?? hashParams.get("error_description");
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");
      const hasAuthHash = Boolean(accessToken || refreshToken || hashParams.get("error") || hashParams.get("type"));

      if (hasAuthHash) cleanAuthUrl();
      if (linkError) {
        setError(friendlyAuthError(linkError));
        return;
      }

      const supabase = createSupabaseBrowserClient();

      if (accessToken && refreshToken) {
        const { error: sessionSetError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionSetError) { setError(friendlyAuthError(sessionSetError.message)); return; }
        setPhase("set_password");
        return;
      }

      const tokenHash = searchParams.get("token_hash");
      const type = searchParams.get("type");
      if (tokenHash && type) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: type as EmailOtpType,
        });
        if (otpError) { setError(friendlyAuthError(otpError.message)); return; }
        setPhase("set_password");
        return;
      }

      const code = searchParams.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) { setError(friendlyAuthError(exchangeError.message)); return; }
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) { setError(friendlyAuthError(sessionError.message)); return; }
      if (data.session) { setPhase("set_password"); return; }

      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session) setPhase("set_password");
      });
      unsubscribe = () => listener.subscription.unsubscribe();
      timeout = window.setTimeout(() => {
        setError((current) => current || "This invitation or recovery link is invalid, expired, or has already been used. Request a new email.");
      }, 5000);
    }

    void establishSession();
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      unsubscribe?.();
    };
  }, []);

  function continueConfirmation() {
    if (!isTrustedConfirmationUrl(confirmationUrl)) {
      setError("This confirmation link is not valid. Request a new email from your administrator.");
      return;
    }
    window.location.assign(confirmationUrl);
  }

  async function completeSetup(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 12) { setError("Use at least 12 characters for your password."); return; }
    if (password !== confirmPassword) { setError("The passwords do not match."); return; }
    setSaving(true);
    setError("");

    const supabase = createSupabaseBrowserClient();
    const { data, error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError || !data.user) { setError(updateError?.message ?? "Unable to complete account setup."); setSaving(false); return; }

    const appRole = data.user.app_metadata?.role as string | undefined;
    const uiRole: Role = appRole === "super_user" || appRole === "sub_super_user" ? "super" : appRole === "manager" ? "manager" : "employee";
    const secureCookie = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `mpj_role=${uiRole}; path=/; max-age=86400; SameSite=Lax${secureCookie}`;
    window.location.href = "/dashboard";
  }

  const awaitingConfirmation = phase === "awaiting_confirmation";
  const ready = phase === "set_password";

  return <main className="login-shell">
    <section className="login-visual">
      <div className="brand"><div className="brand-mark"><Stethoscope size={22} /></div><div className="brand-word">MyPatient Journey</div></div>
      <div className="login-copy"><div className="eyebrow">Secure account access</div><h1>Your patient-care workspace is ready.</h1><p>Confirm this request, then choose a strong password. Your access is protected by role-based permissions and an auditable patient journey.</p></div>
      <div className="login-foot">Every patient. Every recall. Every follow-up tracked.</div>
    </section>
    <section className="login-form-wrap"><div className="login-card">
      <div className="drop-icon" style={{ margin: "0 0 18px" }}>{ready ? <KeyRound size={23} /> : awaitingConfirmation ? <ShieldCheck size={23} /> : <LoaderCircle size={23} className="animate-spin" />}</div>
      <h2>{ready ? "Set your password" : awaitingConfirmation ? "Confirm this request" : "Verifying secure link"}</h2>
      <p className="login-sub">{ready ? "Create a password with at least 12 characters." : awaitingConfirmation ? "For your protection, the one-time security link will only be used after you continue." : "We are securely validating your account access."}</p>
      {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldCheck size={14} /><span>{error}</span></div>}
      {awaitingConfirmation && <button className="btn btn-primary btn-wide" type="button" onClick={continueConfirmation}>Continue securely <ArrowRight size={16} /></button>}
      {ready && <form onSubmit={completeSetup}>
        <div className="field"><label htmlFor="new-password">New password</label><div className="input-wrap"><KeyRound size={16} /><input id="new-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} /></div></div>
        <div className="field"><label htmlFor="confirm-password">Confirm password</label><div className="input-wrap"><CheckCircle2 size={16} /><input id="confirm-password" className="input" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required minLength={12} /></div></div>
        <button className="btn btn-primary btn-wide" disabled={saving}>{saving ? "Saving password..." : "Save password and continue"}</button>
      </form>}
    </div></section>
  </main>;
}
