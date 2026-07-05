"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Check, ChevronRight, LoaderCircle, Search, ShieldCheck } from "lucide-react";

type Booking = {
  id: string;
  lead_id: string;
  patient: string;
  account: string;
  recorded_by: string;
  preferred_date: string;
  preferred_time: string;
  confidence: string;
  notes: string | null;
  recorded_at: string;
};

const verificationOptions = [
  { label: "Booking found on practice calendar", value: "found" },
  { label: "Booking not found", value: "not_found" },
  { label: "Booking date changed", value: "date_changed" },
  { label: "Patient cancelled", value: "cancelled" },
  { label: "Needs follow-up", value: "needs_follow_up" },
] as const;

function confidenceLabel(value: string) {
  if (value === "confirmed_with_patient") return "Confirmed with patient";
  if (value === "requested_availability") return "Patient requested availability";
  if (value === "tentative") return "Tentative";
  return value || "Not supplied";
}

export function BookingVerification({ notify, onRefresh }: { notify: (message: string) => void; onRefresh?: () => Promise<void> | void }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [outcome, setOutcome] = useState<(typeof verificationOptions)[number]["value"]>("found");
  const [notes, setNotes] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadBookings() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/bookings", { cache: "no-store" });
    const result = await response.json().catch(() => null) as { bookings?: Booking[]; error?: string } | null;
    setLoading(false);
    if (!response.ok) {
      setBookings([]);
      setError(result?.error ?? "Unable to load booking verification records.");
      return;
    }
    setBookings(result?.bookings ?? []);
  }

  useEffect(() => { void loadBookings(); }, []);

  const visible = useMemo(() => bookings.filter((booking) => {
    if (!query.trim()) return true;
    return `${booking.patient} ${booking.account} ${booking.recorded_by}`.toLowerCase().includes(query.toLowerCase());
  }), [bookings, query]);

  async function verify() {
    if (!selected) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        booking_record_id: selected.id,
        verification_status: outcome,
        verification_notes: notes,
        verified_date: new Date().toISOString().slice(0, 10),
      }),
    });
    const result = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    setSaving(false);
    if (!response.ok) {
      setError(result?.error ?? "Unable to save booking verification.");
      return;
    }
    notify(result?.message ?? `${selected.patient}: verification saved`);
    setSelected(null);
    setNotes("");
    setOutcome("found");
    await loadBookings();
    await onRefresh?.();
  }

  return <>
    <div className="page-head"><div><h1>Booking verification</h1><p>Compare recorded patient requests against the official practice calendar.</p></div><button className="btn btn-secondary" onClick={() => notify("Check the official practice calendar manually, then record whether the booking was found, changed, cancelled, or needs follow-up.")}><CalendarCheck size={14} />Calendar check guide</button></div>
    {error && <div className="callout" style={{ background: "#fbe9ea", color: "#a84850" }}><ShieldCheck size={14}/><span>{error}</span></div>}
    <div className="metric-grid" style={{gridTemplateColumns:"repeat(4,1fr)"}}>{[["Awaiting verification",String(bookings.length),"Live pending bookings"],["Visible after filter",String(visible.length),"Current table rows"],["Oldest pending",bookings[0] ? new Date(bookings[0].recorded_at).toLocaleDateString() : "—","Recorded booking age"],["Verification source","Live DB","booking_records"]].map((row,i)=><div className={`metric-card ${["orange","teal","rose","blue"][i]}`} key={row[0]}><div className="metric-label">{row[0]}</div><div className="metric-value">{row[1]}</div><div className="metric-trend">{row[2]}</div></div>)}</div>
    <div className="toolbar"><div className="searchbar"><Search size={14}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search patient, account or employee..." /></div><button className="btn btn-secondary" onClick={() => void loadBookings()}>Refresh</button></div>
    <div className="card"><div className="card-head"><div><div className="card-title">Bookings awaiting a calendar check</div><div className="card-sub">Employee-recorded requests remain pending until a manager verifies them</div></div></div>{loading ? <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><LoaderCircle className="animate-spin" size={25}/></div><h2>Loading booking records</h2><p>Checking live pending booking requests.</p></div> : visible.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Patient</th><th>Recorded by</th><th>Preferred date</th><th>Preferred time</th><th>Confidence</th><th>Recorded</th><th></th></tr></thead><tbody>{visible.map((booking)=><tr key={booking.id}><td><strong>{booking.patient}</strong><br/><small>{booking.account}</small></td><td>{booking.recorded_by}</td><td><strong>{booking.preferred_date}</strong></td><td>{booking.preferred_time}</td><td><span className="badge standard">{confidenceLabel(booking.confidence)}</span></td><td>{new Date(booking.recorded_at).toLocaleString()}</td><td><button className="btn btn-soft" onClick={()=>setSelected(booking)}>Verify <ChevronRight size={12}/></button></td></tr>)}</tbody></table></div> : <div className="empty-page" style={{ boxShadow: "none" }}><div className="empty-icon"><CalendarCheck size={25}/></div><h2>No bookings awaiting verification</h2><p>When employees record patient bookings, they will appear here for manager calendar checks.</p></div>}</div>
    {selected && <div className="modal-backdrop" onClick={()=>setSelected(null)}><div className="modal" onClick={event=>event.stopPropagation()}><div className="modal-head"><strong>Verify booking · {selected.patient}</strong><button className="icon-btn" onClick={()=>setSelected(null)}>×</button></div><div className="modal-body"><div className="callout"><ShieldCheck size={15}/><span>Check the official practice calendar before choosing an outcome. This creates a manager-signed audit record.</span></div><div className="lead-card" style={{ boxShadow: "none", marginBottom: 12 }}><strong>{selected.preferred_date} · {selected.preferred_time}</strong><p style={{ fontSize: 10, color: "#647673", marginTop: 4 }}>{confidenceLabel(selected.confidence)}{selected.notes ? ` — ${selected.notes}` : ""}</p></div><div className="form-field"><label>Verification outcome</label><select className="form-control" value={outcome} onChange={event=>setOutcome(event.target.value as typeof outcome)}>{verificationOptions.map((option)=><option key={option.value} value={option.value}>{option.label}</option>)}</select></div><div className="form-field" style={{marginTop:12}}><label>Manager verification notes</label><textarea className="form-control" value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Calendar reference, changed date, or follow-up detail..." /></div></div><div className="modal-actions"><button className="btn btn-secondary" onClick={()=>setSelected(null)}>Cancel</button><button className="btn btn-primary" disabled={saving} onClick={verify}><Check size={14}/>{saving ? "Saving..." : "Save verification"}</button></div></div></div>}
  </>;
}
