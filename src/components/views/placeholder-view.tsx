import { BarChart3, FileBarChart, Settings2 } from "lucide-react";
import type { Role } from "@/lib/types";

export function PlaceholderView({ title, role }: { title:string; role:Role }) {
  return <><div className="page-head"><div><h1>{title}</h1><p>Operational controls and insights for your patient recall programme.</p></div><button className="btn btn-primary"><FileBarChart size={14}/>Export report</button></div><div className="card empty-page"><div className="empty-icon">{title === "Settings" ? <Settings2 size={26}/> : <BarChart3 size={26}/>}</div><h2>{title} workspace</h2><p>This demo route is ready for your live Supabase data. The navigation and role boundary are already in place.</p><button className="btn btn-soft">View demo report</button></div></>;
}
