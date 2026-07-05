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
  | "Wrong Number Confirmed"
  | "Manager Closed";

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
  managerReview?: {
    reason: string;
    notes?: string | null;
    recordedAt?: string | null;
    recordedBy?: string | null;
    source: string;
  } | null;
  assignedTo: string;
  doctor: string;
  amount: number;
  sourceBatch: string;
}

export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  role: "employee" | "manager";
  companyId: string | null;
  branchId: string | null;
}

export interface Metric {
  label: string;
  value: string;
  trend?: string;
  tone?: "teal" | "blue" | "violet" | "orange" | "rose";
}

export interface AuditEvent {
  id: number;
  companyId: string | null;
  companyName: string;
  actorId: string | null;
  actorName: string;
  actorEmail: string;
  entityType: string;
  entityId: string | null;
  action: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  createdAt: string;
  requestId: string | null;
  ipAddress: string | null;
}
