"use client";

import { useState } from "react";
import { AlertTriangle, CalendarClock, Check, Clipboard, Edit3, Info, Mail, MessageCircle, Phone, PhoneCall, Send, ShieldAlert, UserRoundX, X } from "lucide-react";
import type { Lead, LeadStatus } from "@/lib/types";

type Workflow = "call" | "whatsapp" | "email" | "contacts" | "callback" | "booking" | "not-interested" | "wrong-number" | "escalate" | null;

const dbStatusToUi: Record<string, LeadStatus> = {
  new: "New",
  allocated: "Allocated",
  call_attempted: "Call Attempted",
  no_answer: "No Answer",
  whatsapp_sent: "WhatsApp Sent",
  call_back_later: "Call Back Later",
  waiting_for_patient_response: "Waiting for Patient Response",
  callback_due: "Callback Due",
  booking_recorded_pending_verification: "Booking Recorded Pending Verification",
  manager_review: "Manager Review",
  patient_booked_and_verified: "Patient Booked and Verified",
  patient_not_interested: "Patient Not Interested",
  wrong_number_confirmed: "Wrong Number Confirmed",
};

export function LeadDrawer({ lead, employeeName, onClose, onUpdate, onRefresh, notify }: { lead:Lead; employeeName:string; onClose:()=>void; onUpdate:(lead:Lead)=>void; onRefresh?:()=>Promise<void>|void; notify:(message:string)=>void }) {
  const [workflow, setWorkflow] = useState<Workflow>(null);
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [callbackDate, setCallbackDate] = useState("2026-07-06");
  const [bookingDate, setBookingDate] = useState("2026-07-12");
  const [callbackTimeRange, setCallbackTimeRange] = useState("10:00-12:00");
  const [callbackReason, setCallbackReason] = useState("Patient is currently busy");
  const [bookingTime, setBookingTime] = useState("10:00-12:00");
  const [bookingConfidence, setBookingConfidence] = useState<"confirmed_with_patient" | "requested_availability" | "tentative">("confirmed_with_patient");
  const [primaryPhone, setPrimaryPhone] = useState(lead.phone);
  const [alternatePhone, setAlternatePhone] = useState(lead.alternatePhone ?? "");
  const [patientEmail, setPatientEmail] = useState(lead.email ?? "");
  const whatsappMessage = `Good day ${lead.patient}, this is ${employeeName} from ${lead.branch}.\n\nDr ${lead.doctor} asked us to send you a courtesy reminder that you are due for your 6-month dental check-up.\n\nYour last recorded visit was on ${lead.lastVisit}. Regular check-ups help detect dental concerns early before they become painful or more serious.\n\nPlease let us know if you would like assistance with arranging your next appointment.`;
  const emailSubject = "Courtesy reminder: your dental check-up";
  const emailBody = `Good day ${lead.patient},\n\nThis is ${employeeName} from ${lead.branch}. Dr ${lead.doctor} asked us to send you a courtesy reminder that you are due for your 6-month dental check-up.\n\nYour last recorded visit was on ${lead.lastVisit}. Regular check-ups help detect dental concerns early before they become painful or more serious.\n\nPlease let us know if you would like assistance with arranging your next appointment.`;

  async function recordLeadAction(payload: Record<string, unknown>, status: LeadStatus, latest: string, nextAction: string, addAttempt = true) {
    if (!lead.id) {
      notify("Lead id is missing. Refresh the page and try again.");
      return;
    }
    const response = await fetch("/api/leads/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: lead.id, ...payload }),
    });
    const result = await response.json().catch(() => null) as { message?: string; error?: string; status?: string; unsuccessful_attempt_days?: number } | null;
    if (!response.ok) {
      notify(result?.error ?? "Unable to record this patient journey action.");
      return;
    }
    const nextAttempts = lead.attempts + (addAttempt ? 1 : 0);
    const nextStatus = result?.status ? dbStatusToUi[result.status] ?? status : status;
    const reachesThree = nextStatus === "Manager Review";
    const updated: Lead = {
      ...lead,
      status: nextStatus,
      latestOutcome: reachesThree ? `${latest} - Three-day rule reached` : latest,
      nextAction: reachesThree ? "Manager review" : nextAction,
      attempts: nextAttempts,
      attemptDays: result?.unsuccessful_attempt_days ?? lead.attemptDays,
    };
    onUpdate(updated);
    setWorkflow(null);
    setOutcome("");
    setNotes("");
    notify(result?.message ?? (reachesThree ? "Three unsuccessful days reached - moved to Manager Review" : `${lead.patient}: ${latest}`));
    await onRefresh?.();
  }

  function recordCall() {
    if (!outcome) { notify("Choose an outcome before leaving the call workflow"); return; }
    if (outcome === "Patient booked") { setWorkflow("booking"); return; }
    if (outcome === "Call back later") { setWorkflow("callback"); return; }
    if (outcome === "Not interested") { setWorkflow("not-interested"); return; }
    if (outcome === "No answer") void recordLeadAction({ action: "no_answer", outcome, notes, phone_used: lead.phone }, "No Answer", "No answer", "Tomorrow");
    else if (outcome === "Interested - needs availability") void recordLeadAction({ action: "call_outcome", outcome, notes, phone_used: lead.phone }, "Waiting for Patient Response", "Patient requested availability", "Follow up in 2 days");
    else void recordLeadAction({ action: "call_outcome", outcome, notes, phone_used: lead.phone }, "Call Attempted", outcome, "Next follow-up due");
  }

  async function recordCommunication(channel: "email" | "whatsapp_message", subject: string | null, body: string, latest: string) {
    if (lead.companyId && lead.patientId) {
      await fetch("/api/communication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: lead.companyId,
          branch_id: lead.branchId ?? null,
          patient_id: lead.patientId,
          lead_id: lead.id,
          channel,
          subject,
          body,
          outcome: latest,
        }),
      });
    }
  }

  async function saveContactDetails() {
    if (!primaryPhone.trim() && !alternatePhone.trim() && !patientEmail.trim()) {
      notify("Add at least one contact detail or keep the patient flagged for review.");
      return;
    }
    if (lead.patientId) {
      const updates = [
        primaryPhone.trim() ? { contact_type: "mobile", value: primaryPhone.trim(), is_primary: true } : null,
        alternatePhone.trim() ? { contact_type: "alternate", value: alternatePhone.trim(), is_primary: false } : null,
        patientEmail.trim() ? { contact_type: "email", value: patientEmail.trim(), is_primary: false } : null,
      ].filter(Boolean);
      await Promise.all(updates.map((contact) => fetch("/api/patients/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: lead.patientId, ...contact }),
      })));
    }
    onUpdate({ ...lead, phone: primaryPhone || lead.phone, alternatePhone: alternatePhone || null, email: patientEmail || null });
    setWorkflow(null);
    notify("Patient contact details updated and audit logging requested");
  }

  return <><div className="drawer-backdrop" onClick={onClose}/><aside className="drawer">
    <div className="drawer-head"><div className="drawer-title"><HeartJourney/><div><strong>Patient Journey</strong><div style={{fontSize:8,color:"#849593",marginTop:2}}>{lead.id} - Source {lead.sourceBatch}</div></div></div><button className="icon-btn" onClick={onClose}><X size={15}/></button></div>
    <div className="drawer-body">
      <div className="profile-card"><div className="profile-person"><div className="avatar">{lead.initials}</div><div><h2>{lead.patient}</h2><p>{lead.account} - {lead.branch}</p></div></div><div className="profile-phone"><strong>{lead.phone || "Missing contact number"}</strong>{lead.phone ? <a className="btn btn-soft" href={`tel:${lead.phone.replace(/\s/g,"")}`}><Phone size={13}/>Call patient</a> : <button className="btn btn-soft" onClick={() => setWorkflow("contacts")}><Edit3 size={13}/>Add contact</button>}</div></div>
      {!lead.phone && <div className="callout" style={{ background: "#fff4ed", marginTop: 12 }}><ShieldAlert size={14}/><span>This patient has no valid primary contact number. Keep them active and update contact details from the practice management system before attempting contact.</span></div>}
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:12}}><span className={`badge ${lead.priority.includes("Premium")?"premium":lead.priority.includes("High")?"high":lead.priority.includes("Dormant")?"dormant":"standard"}`}>{lead.priority}</span><span className="badge status-badge">{lead.status}</span><span className="badge status-badge">{lead.attemptDays}/3 contact days</span></div>

      <section className="drawer-section"><div className="section-head"><strong>Patient & recall context</strong><button className="tiny-link" onClick={() => notify(`Transaction summary: last visit ${lead.lastVisit}; last 8101 ${lead.last8101}; last 8159 ${lead.last8159}; source batch ${lead.sourceBatch}.`)}>View transaction summary</button></div><div className="section-body"><div className="info-grid"><div className="info-item"><label>Medical aid</label><strong>{lead.medicalAid}</strong></div><div className="info-item"><label>Option</label><strong>{lead.option}</strong></div><div className="info-item"><label>Practitioner</label><strong>Dr {lead.doctor}</strong></div><div className="info-item"><label>Last visit</label><strong>{lead.lastVisit}</strong></div><div className="info-item"><label>Last 8101</label><strong>{lead.last8101}</strong></div><div className="info-item"><label>Last 8159</label><strong>{lead.last8159}</strong></div></div><div className="callout" style={{marginTop:14,marginBottom:0}}><Info size={14}/><span><strong>Recall reason:</strong> {lead.reason}. Imported history is read-only and traceable to {lead.sourceBatch}.</span></div></div></section>

      <section className="drawer-section"><div className="section-head"><strong>Choose the next patient action</strong><span style={{fontSize:8,color:"#8a9b98"}}>Every action is audited</span></div><div className="section-body"><div className="action-grid">
        <button className="action-btn" onClick={()=>setWorkflow("call")}><PhoneCall size={18}/>Call Patient</button>
        <a className="action-btn" href={`https://wa.me/${(lead.whatsapp||lead.phone).replace(/\D/g,"")}`} target="_blank"><MessageCircle size={18}/>Call via WhatsApp</a>
        <button className="action-btn" onClick={()=>setWorkflow("whatsapp")}><Send size={18}/>Send WhatsApp</button>
        <button className="action-btn" onClick={()=>setWorkflow("email")}><Mail size={18}/>Send Email</button>
        <button className="action-btn" onClick={()=>setWorkflow("contacts")}><Edit3 size={18}/>Update Contacts</button>
        <button className="action-btn warn" onClick={()=>void recordLeadAction({ action: "no_answer", phone_used: lead.phone }, "No Answer","No answer","Tomorrow")}><Phone size={18}/>Mark No Answer</button>
        <button className="action-btn" onClick={()=>setWorkflow("callback")}><CalendarClock size={18}/>Schedule Call Back</button>
        <button className="action-btn" onClick={()=>setWorkflow("booking")}><Check size={18}/>Record Booking</button>
        <button className="action-btn danger" onClick={()=>setWorkflow("not-interested")}><UserRoundX size={18}/>Not Interested</button>
        <button className="action-btn danger" onClick={()=>setWorkflow("wrong-number")}><ShieldAlert size={18}/>Wrong Number</button>
        <button className="action-btn warn" onClick={()=>setWorkflow("escalate")}><AlertTriangle size={18}/>Escalate to Manager</button>
      </div></div></section>

      {workflow === "call" && <section className="drawer-section"><div className="section-head"><strong>Guided call roadmap</strong>{lead.phone && <a href={`tel:${lead.phone.replace(/\s/g,"")}`} className="btn btn-primary"><Phone size={13}/>Call {lead.phone}</a>}</div><div className="section-body"><div className="callout"><Info size={14}/><span>Use your existing phone system, mobile phone, 3CX, WhatsApp, or any approved calling app to contact the patient.</span></div><div className="roadmap"><p><strong>Opening</strong></p><p>Good day, may I please speak to <strong>{lead.patient}</strong>?</p><p>My name is <strong>{employeeName}</strong>, and I am calling from <strong>{lead.branch}</strong>.</p><p>Dr <strong>{lead.doctor}</strong> asked me to contact you as a courtesy reminder. We noticed that your last dental visit was on <strong>{lead.lastVisit}</strong>, and we are reaching out because it is recommended that patients see their dentist at least once every six months.</p><p>The purpose is to help detect dental concerns early, before they become painful, expensive, or more serious.</p><p>Would you like us to assist you with booking your next check-up?</p></div><details style={{marginTop:11,fontSize:9,color:"#607572"}}><summary style={{cursor:"pointer",fontWeight:700}}>Patient says they are not in pain</summary><p style={{lineHeight:1.6}}>I completely understand. Many dental problems unfortunately start silently, and pain often comes only once the issue has progressed. That is why regular check-ups are important, even when everything feels fine.</p></details><details style={{marginTop:8,fontSize:9,color:"#607572"}}><summary style={{cursor:"pointer",fontWeight:700}}>Patient is busy</summary><p style={{lineHeight:1.6}}>I understand. Would you prefer that we call you back on a specific date, or should we send the reminder on WhatsApp?</p></details><div className="form-grid" style={{marginTop:15}}><div className="form-field full"><label>Required call outcome</label><select className="form-control" value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="">Choose outcome...</option><option>Patient booked</option><option>Interested - needs availability</option><option>Call back later</option><option>No answer</option><option>Voicemail</option><option>Not interested</option></select></div><div className="form-field full"><label>Call notes</label><textarea className="form-control" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="What did the patient say?"/></div></div><div className="workflow-actions"><button className="btn btn-secondary" onClick={()=>setWorkflow(null)}>Keep lead open</button><button className="btn btn-primary" onClick={recordCall}>Record outcome</button></div></div></section>}
    </div>
  </aside>

  {workflow === "whatsapp" && <WorkflowModal title="Send WhatsApp reminder" onClose={()=>setWorkflow(null)} action={<button className="btn btn-primary" onClick={async()=>{ await recordCommunication("whatsapp_message", null, whatsappMessage, "WhatsApp reminder sent"); await recordLeadAction({ action: "whatsapp_sent", whatsapp_number: lead.whatsapp || lead.phone, template_key: "six_month_courtesy_reminder", next_follow_up_date: "2026-07-08" }, "WhatsApp Sent","WhatsApp reminder sent","Follow up 08 Jul"); }}><Send size={13}/>Record as sent</button>}><div className="form-field"><label>WhatsApp number used</label><input className="form-control" defaultValue={lead.whatsapp || lead.phone}/></div><div className="form-field" style={{marginTop:11}}><label>Message template</label><select className="form-control"><option>Six-month courtesy reminder</option><option>Callback follow-up</option><option>Booking availability follow-up</option></select></div><div className="roadmap" style={{whiteSpace:"pre-line",marginTop:12}}>{whatsappMessage}</div><button className="btn btn-soft" style={{marginTop:10}} onClick={()=>{navigator.clipboard?.writeText(whatsappMessage);notify("WhatsApp message copied");}}><Clipboard size={13}/>Copy message</button><div className="form-field" style={{marginTop:11}}><label>Next follow-up date</label><input className="form-control" type="date" defaultValue="2026-07-08"/></div></WorkflowModal>}
  {workflow === "email" && <WorkflowModal title="Send patient email" onClose={()=>setWorkflow(null)} action={<button className="btn btn-primary" disabled={!patientEmail.trim()} onClick={async()=>{ await recordCommunication("email", emailSubject, emailBody, "Email reminder sent"); await recordLeadAction({ action: "email_sent", notes: `Email sent to ${patientEmail}` }, "Waiting for Patient Response","Email reminder sent","Follow up in 2 days"); }}><Mail size={13}/>Record email sent</button>}><div className="form-field"><label>Email address</label><input className="form-control" type="email" value={patientEmail} onChange={(event)=>setPatientEmail(event.target.value)} placeholder="patient@example.com"/></div><div className="form-field" style={{marginTop:11}}><label>Subject</label><input className="form-control" value={emailSubject} readOnly/></div><div className="roadmap" style={{whiteSpace:"pre-line",marginTop:12}}>{emailBody}</div><button className="btn btn-soft" style={{marginTop:10}} onClick={()=>{navigator.clipboard?.writeText(`${emailSubject}\n\n${emailBody}`);notify("Email copied");}}><Clipboard size={13}/>Copy email</button></WorkflowModal>}
  {workflow === "contacts" && <WorkflowModal title="Update patient contact details" onClose={()=>setWorkflow(null)} action={<button className="btn btn-primary" onClick={saveContactDetails}><Check size={13}/>Save contact details</button>}><div className="callout"><Info size={14}/><span>Use contact details retrieved from the practice management system. Every saved change is sent through the audited contact update route.</span></div><div className="form-grid"><div className="form-field"><label>Primary contact number</label><input className="form-control" value={primaryPhone} onChange={(event)=>setPrimaryPhone(event.target.value)} placeholder="+27..."/></div><div className="form-field"><label>Alternative number</label><input className="form-control" value={alternatePhone} onChange={(event)=>setAlternatePhone(event.target.value)} placeholder="+27..."/></div><div className="form-field full"><label>Email address</label><input className="form-control" type="email" value={patientEmail} onChange={(event)=>setPatientEmail(event.target.value)} placeholder="patient@example.com"/></div></div></WorkflowModal>}
  {workflow === "callback" && <WorkflowModal title="Schedule patient callback" onClose={()=>setWorkflow(null)} action={<button className="btn btn-primary" onClick={()=>void recordLeadAction({ action: "callback_scheduled", callback_date: callbackDate, callback_time_range: callbackTimeRange, callback_reason: callbackReason, notes }, "Call Back Later","Callback scheduled",`${callbackDate} - ${callbackTimeRange}`)}><CalendarClock size={13}/>Schedule callback</button>}><div className="form-grid"><div className="form-field"><label>Callback date *</label><input required className="form-control" type="date" value={callbackDate} onChange={e=>setCallbackDate(e.target.value)}/></div><div className="form-field"><label>Time or time range *</label><select className="form-control" value={callbackTimeRange} onChange={(event)=>setCallbackTimeRange(event.target.value)}><option>10:00-12:00</option><option>08:00-10:00</option><option>12:00-14:00</option><option>14:00-16:00</option></select></div><div className="form-field full"><label>Reason *</label><select className="form-control" value={callbackReason} onChange={(event)=>setCallbackReason(event.target.value)}><option>Patient is currently busy</option><option>Patient requested a different day</option><option>Needs to check calendar</option><option>Discuss with family / medical aid</option></select></div><div className="form-field full"><label>Notes</label><textarea className="form-control" value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Helpful context for the callback..."/></div></div><div className="callout" style={{marginTop:12,marginBottom:0}}><Info size={14}/><span>This lead will automatically return to the employee's due list on the callback date.</span></div></WorkflowModal>}
  {workflow === "booking" && <WorkflowModal title="Record patient booking request" onClose={()=>setWorkflow(null)} action={<button className="btn btn-primary" disabled={!bookingDate} onClick={()=>void recordLeadAction({ action: "booking_recorded", preferred_date: bookingDate, preferred_time: bookingTime, confidence: bookingConfidence, notes }, "Booking Recorded Pending Verification",`Booking recorded: ${bookingDate}`,"Awaiting manager verification", false)}><Check size={13}/>Record booking</button>}><div className="callout"><Info size={14}/><span>This records the patient's preferred appointment. A manager must find it on the official practice calendar before it becomes verified.</span></div><div className="form-grid"><div className="form-field"><label>Preferred booking date *</label><input required className="form-control" type="date" value={bookingDate} onChange={e=>setBookingDate(e.target.value)}/></div><div className="form-field"><label>Preferred time / range *</label><select className="form-control" value={bookingTime} onChange={(event)=>setBookingTime(event.target.value)}><option>10:00-12:00</option><option>Morning</option><option>Afternoon</option><option>Any available time</option></select></div><div className="form-field full"><label>Booking confidence *</label><select className="form-control" value={bookingConfidence} onChange={(event)=>setBookingConfidence(event.target.value as "confirmed_with_patient" | "requested_availability" | "tentative")}><option value="confirmed_with_patient">Confirmed with patient</option><option value="requested_availability">Patient requested availability</option><option value="tentative">Tentative</option></select></div><div className="form-field full"><label>Booking notes</label><textarea className="form-control" value={notes} onChange={(event)=>setNotes(event.target.value)} placeholder="Patient preferences, practitioner, appointment type..."/></div></div></WorkflowModal>}
  {(workflow === "not-interested" || workflow === "wrong-number" || workflow === "escalate") && <WorkflowModal title={workflow === "not-interested"?"Confirm patient is not interested":workflow === "wrong-number"?"Confirm wrong number":"Escalate to manager"} onClose={()=>setWorkflow(null)} action={<button className={`btn ${workflow === "escalate"?"btn-primary":"btn-danger-soft"}`} onClick={()=>void recordLeadAction(workflow === "escalate" ? { action: "manager_review", reason: "Patient requested manager contact", notes } : { action: "final_outcome", final_status: workflow === "wrong-number" ? "wrong_number_confirmed" : "patient_not_interested", reason: workflow === "wrong-number" ? "Wrong number confirmed" : "Patient not interested", notes }, workflow === "escalate"?"Manager Review":workflow === "wrong-number"?"Wrong Number Confirmed":"Patient Not Interested",workflow === "escalate"?"Escalated to manager":workflow === "wrong-number"?"Wrong number confirmed":"Patient not interested",workflow === "escalate"?"Manager review":"Completed", false)}><Check size={13}/>Confirm outcome</button>}><div className="callout" style={{background:workflow === "escalate"?"#edf6ff":"#fff4ed"}}><AlertTriangle size={14}/><span>{workflow === "escalate"?"The lead will remain active while a manager reviews it.":"This is a final outcome. Add enough detail for a manager to audit the decision."}</span></div><div className="form-field"><label>{workflow === "escalate"?"Escalation reason *":"Reason *"}</label><select className="form-control"><option>{workflow === "not-interested"?"Patient clearly declined recall":workflow === "wrong-number"?"Number belongs to another person":"Patient requested manager contact"}</option><option>Clinical or sensitive concern</option><option>Repeated contact difficulty</option><option>Data quality issue</option></select></div><div className="form-field" style={{marginTop:11}}><label>Required notes</label><textarea className="form-control" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Record what was confirmed and how..."/></div></WorkflowModal>}
  </>;
}

function WorkflowModal({ title, children, onClose, action }: { title:string;children:React.ReactNode;onClose:()=>void;action:React.ReactNode }) { return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><strong>{title}</strong><button className="icon-btn" onClick={onClose}><X size={14}/></button></div><div className="modal-body">{children}</div><div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>Cancel</button>{action}</div></div></div>; }
function HeartJourney(){return <div style={{width:31,height:31,borderRadius:9,background:"#e3f3f0",color:"#0b7a75",display:"grid",placeItems:"center"}}><PhoneCall size={15}/></div>;}
