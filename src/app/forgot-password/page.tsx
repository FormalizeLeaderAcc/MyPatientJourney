"use client";

import { useState } from "react";
import { ArrowLeft, Mail, Send, ShieldCheck, Stethoscope } from "lucide-react";
import { createSupabaseRecoveryClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function sendRecovery(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError("");

    const supabase = createSupabaseRecoveryClient();
    const { error: recoveryError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm`,
    });

    if (recoveryError) {
      setError(recoveryError.message);
      setSending(false);
      return;
    }

    setSent(true);
    setSending(false);
  }

  return (
    <main className="login-shell">
      <section className="login-visual">
        <div className="brand"><div className="brand-mark"><Stethoscope size={22} /></div><div className="brand-word">MyPatient Journey</div></div>
        <div className="login-copy">
          <div className="eyebrow">Secure account recovery</div>
          <h1>Return safely to your patient-care workspace.</h1>
          <p>We will send a protected recovery email to the address associated with your approved account.</p>
        </div>
        <div className="login-foot">Every patient. Every recall. Every follow-up tracked.</div>
      </section>

      <section className="login-form-wrap">
        <div className="login-card">
          <div className="drop-icon" style={{ margin: "0 0 18px" }}>{sent ? <ShieldCheck size={23} /> : <Mail size={23} />}</div>
          <h2>{sent ? "Check your email" : "Reset your password"}</h2>
          <p className="login-sub">
            {sent
              ? "If this email belongs to an approved account, a recovery message is on its way. The secure link is valid for 24 hours and can only be used once."
              : "Enter your approved work email address to receive a password recovery link."}
          </p>

          {!sent && (
            <form onSubmit={sendRecovery}>
              <div className="field">
                <label htmlFor="email">Email address</label>
                <div className="input-wrap"><Mail size={16} /><input id="email" className="input" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></div>
              </div>
              {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldCheck size={14} /><span>{error}</span></div>}
              <button className="btn btn-primary btn-wide" type="submit" disabled={sending}>{sending ? "Sending recovery email..." : <>Send recovery email <Send size={16} /></>}</button>
            </form>
          )}

          <div style={{ marginTop: 22, textAlign: "center" }}><a href="/login" className="text-link"><ArrowLeft size={14} style={{ verticalAlign: -2, marginRight: 5 }} />Back to sign in</a></div>
        </div>
      </section>
    </main>
  );
}
