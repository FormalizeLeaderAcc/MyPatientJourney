import type { Lead, Metric } from "./types";

export const demoUsers = {
  super: { name: "Lerato Molefe", roleLabel: "Super User", email: "admin@mypatientjourney.co.za", initials: "LM" },
  manager: { name: "Mpho Dlamini", roleLabel: "Branch Manager", email: "manager@drkysepeng.co.za", initials: "MD" },
  employee: { name: "Naledi Mokoena", roleLabel: "Patient Care Coordinator", email: "naledi@drkysepeng.co.za", initials: "NM" },
};

export const leads: Lead[] = [
  { id: "L-2048", patient: "Kagiso Maseko", initials: "KM", account: "KMS-10428", phone: "+27 82 304 7741", whatsapp: "+27 82 304 7741", branch: "Polokwane Central", medicalAid: "Discovery Health", option: "Comprehensive", priority: "Premium Recall Opportunity", lastVisit: "04 Jan 2026", last8101: "04 Jan 2026", last8159: "18 Dec 2025", reason: "Six-month consultation recall due", attempts: 1, attemptDays: 1, nextAction: "Today, 10:30", latestOutcome: "Callback requested", status: "Callback Due", assignedTo: "Naledi Mokoena", doctor: "KY Sepeng", amount: 1480, sourceBatch: "TXN-JUN-2601" },
  { id: "L-2047", patient: "Palesa Ramokgopa", initials: "PR", account: "PRM-09314", phone: "+27 71 882 0914", whatsapp: "+27 71 882 0914", branch: "Polokwane Central", medicalAid: "Bonitas", option: "BonComprehensive", priority: "High Medical Aid Opportunity", lastVisit: "20 Dec 2025", last8101: "20 Dec 2025", last8159: "—", reason: "No recent oral hygiene visit (8159)", attempts: 0, attemptDays: 0, nextAction: "Today", latestOutcome: "Not yet contacted", status: "New", assignedTo: "Naledi Mokoena", doctor: "Radebe", amount: 920, sourceBatch: "TXN-JUN-2601" },
  { id: "L-2041", patient: "Thabo Ndlovu", initials: "TN", account: "TND-08821", phone: "+27 83 900 4462", whatsapp: null, branch: "Seshego", medicalAid: "GEMS", option: "Emerald", priority: "Standard Six-Month Recall", lastVisit: "29 Dec 2025", last8101: "29 Dec 2025", last8159: "29 Dec 2025", reason: "Routine six-month recall", attempts: 2, attemptDays: 2, nextAction: "Today, 14:00", latestOutcome: "No answer", status: "No Answer", assignedTo: "Naledi Mokoena", doctor: "KY Sepeng", amount: 760, sourceBatch: "TXN-JUN-2601" },
  { id: "L-2036", patient: "Dineo Matlala", initials: "DM", account: "DMT-07149", phone: "+27 79 321 5570", whatsapp: "+27 79 321 5570", branch: "Mankweng", medicalAid: "Momentum", option: "Incentive", priority: "Premium Recall Opportunity", lastVisit: "11 Nov 2025", last8101: "11 Nov 2025", last8159: "11 Nov 2025", reason: "Overdue six-month recall", attempts: 1, attemptDays: 1, nextAction: "Tomorrow", latestOutcome: "WhatsApp sent", status: "WhatsApp Sent", assignedTo: "Naledi Mokoena", doctor: "Makgato", amount: 1230, sourceBatch: "TXN-MAY-2519" },
  { id: "L-2029", patient: "Refilwe Nkuna", initials: "RN", account: "RNK-06402", phone: "+27 72 140 9021", whatsapp: "+27 72 140 9021", branch: "Polokwane Central", medicalAid: "Bestmed", option: "Pace 3", priority: "Dormant Patient", lastVisit: "02 Mar 2025", last8101: "02 Mar 2025", last8159: "—", reason: "No recall codes in over 12 months", attempts: 3, attemptDays: 3, nextAction: "Manager review", latestOutcome: "Unreachable × 3", status: "Manager Review", assignedTo: "Naledi Mokoena", doctor: "KY Sepeng", amount: 560, sourceBatch: "TXN-MAR-2508" },
  { id: "L-2018", patient: "Masego Seroka", initials: "MS", account: "MSR-05120", phone: "+27 84 552 3108", whatsapp: "+27 84 552 3108", branch: "Seshego", medicalAid: "Discovery Health", option: "Classic Priority", priority: "High Medical Aid Opportunity", lastVisit: "14 Dec 2025", last8101: "14 Dec 2025", last8159: "14 Dec 2025", reason: "Six-month recall due", attempts: 1, attemptDays: 1, nextAction: "Awaiting manager", latestOutcome: "Booking recorded: 12 Jul", status: "Booking Recorded Pending Verification", assignedTo: "Naledi Mokoena", doctor: "Radebe", amount: 1650, sourceBatch: "TXN-DEC-2549" },
];

export const employeeMetrics: Metric[] = [
  { label: "My active leads", value: "48", trend: "+6 this week", tone: "teal" },
  { label: "Due today", value: "12", trend: "4 high priority", tone: "blue" },
  { label: "Overdue callbacks", value: "3", trend: "Needs attention", tone: "rose" },
  { label: "Patients contacted", value: "18", trend: "Today", tone: "violet" },
  { label: "Bookings recorded", value: "5", trend: "3 verified", tone: "orange" },
];

export const managerMetrics: Metric[] = [
  { label: "Active recall journeys", value: "286", trend: "+42 this month", tone: "teal" },
  { label: "Contacted today", value: "74", trend: "62% of daily target", tone: "blue" },
  { label: "Pending verification", value: "14", trend: "6 added today", tone: "orange" },
  { label: "Verified bookings", value: "37", trend: "+18% vs last month", tone: "violet" },
  { label: "Overdue callbacks", value: "9", trend: "Across 4 employees", tone: "rose" },
];

export const superMetrics: Metric[] = [
  { label: "Recall opportunities", value: "1,842", trend: "+286 this month", tone: "teal" },
  { label: "Active journeys", value: "1,126", trend: "61.1% allocated", tone: "blue" },
  { label: "Verified bookings", value: "214", trend: "+23.4% vs last month", tone: "violet" },
  { label: "High-value patients", value: "398", trend: "Across 7 branches", tone: "orange" },
  { label: "Needs attention", value: "46", trend: "12 stale · 34 overdue", tone: "rose" },
];

export const team = [
  { name: "Naledi Mokoena", initials: "NM", allocated: 48, contacted: 36, attempts: 64, whatsapp: 18, callbacks: 9, recorded: 8, verified: 6, conversion: "16.7%", status: "Online" },
  { name: "Karabo Letsoalo", initials: "KL", allocated: 52, contacted: 41, attempts: 70, whatsapp: 22, callbacks: 11, recorded: 10, verified: 9, conversion: "22.0%", status: "Online" },
  { name: "Tumelo Mashaba", initials: "TM", allocated: 44, contacted: 31, attempts: 55, whatsapp: 14, callbacks: 8, recorded: 6, verified: 5, conversion: "16.1%", status: "Away" },
  { name: "Zinhle Mabena", initials: "ZM", allocated: 57, contacted: 46, attempts: 79, whatsapp: 26, callbacks: 12, recorded: 12, verified: 10, conversion: "21.7%", status: "Online" },
];

export const medicalAids = [
  { scheme: "Discovery Health", option: "Executive", score: 98, category: "Premium", leads: 42, note: "Strong comprehensive dentistry cover" },
  { scheme: "Discovery Health", option: "Comprehensive", score: 94, category: "Premium", leads: 61, note: "High annual dental benefit" },
  { scheme: "Bonitas", option: "BonComprehensive", score: 88, category: "High", leads: 38, note: "Good preventative care benefits" },
  { scheme: "Bestmed", option: "Pace 3", score: 82, category: "High", leads: 29, note: "Above-average dentistry allocation" },
  { scheme: "GEMS", option: "Emerald", score: 65, category: "Medium", leads: 74, note: "Standard dentistry benefits" },
];

export const auditEvents = [
  { action: "Booking verified", subject: "Masego Seroka · 12 Jul 2026", by: "Mpho Dlamini", time: "8 min ago", tone: "success" },
  { action: "Recall leads generated", subject: "286 leads from TXN-JUN-2601", by: "Lerato Molefe", time: "42 min ago", tone: "info" },
  { action: "Lead reassigned", subject: "L-1982 · Karabo → Naledi", by: "Mpho Dlamini", time: "1 hr ago", tone: "neutral" },
  { action: "Spreadsheet imported", subject: "Dr_KY_June_Transactions.xlsx", by: "Lerato Molefe", time: "2 hrs ago", tone: "info" },
];
