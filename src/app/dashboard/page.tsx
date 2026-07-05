import { cookies } from "next/headers";
import DashboardClient from "@/components/dashboard-client";
import type { Role } from "@/lib/types";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const rawRole = cookieStore.get("mpj_role")?.value;
  const role: Role = rawRole === "super" || rawRole === "manager" || rawRole === "employee" ? rawRole : "employee";
  return <DashboardClient initialRole={role} />;
}
