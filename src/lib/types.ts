export type Role = "super" | "manager" | "employee";

export type LeadStatus =
  | "New"
  | "Allocated"
  | "Call Attempted"
  | "No Answer"
  | "WhatsApp Sent"
  | "Call Back Later"
  | "Waiting for Patient Response"
  | "Callback Due"
  | "Booking Recorded Pending Verification"
  | "Manager Review"
  | "Patient Booked and Verified"
  | "Patient Not Interested"
  | "Wrong Number Confirmed";

export type Priority =
  | "Premium Recall Opportunity"
  | "High Medical Aid Opportunity"
  | "Standard Six-Month Recall"
  | "Dormant Patient"
  | "Missing Data Review"
  | "No Recent 8159"
  | "No Recent 8101 or 8159";

export interface Lead {
  id: string;
  companyId?: string;
  branchId?: string | null;
  patientId?: string;
  patient: string;
  initials: string;
  account: string;
  phone: string;
  alternatePhone?: string | null;
  whatsapp: string | null;
  email?: string | null;
  branch: string;
  medicalAid: string;
  option: string;
  priority: Priority;
  lastVisit: string;
  last8101: string;
  last8159: string;
  reason: string;
  attempts: number;
  attemptDays: number;
  nextAction: string;
  latestOutcome: string;
  status: LeadStatus;
  assignedTo: string;
  doctor: string;
  amount: number;
  sourceBatch: string;
}

export interface Metric {
  label: string;
  value: string;
  trend?: string;
  tone?: "teal" | "blue" | "violet" | "orange" | "rose";
}
