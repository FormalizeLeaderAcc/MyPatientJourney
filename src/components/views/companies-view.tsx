"use client";

import { Building2, MapPin, Plus, Search, Users } from "lucide-react";

const companies = [
  { name:"Dr KY Sepeng Inc", reg:"Dental practice group", branches:3, users:18, leads:948, verified:163, location:"Limpopo", initials:"KY" },
  { name:"Talane & Associates", reg:"Dental practice group", branches:4, users:23, leads:894, verified:126, location:"Gauteng & Limpopo", initials:"TA" },
];
const users = [["Mpho Dlamini","Manager","Dr KY Sepeng Inc","Polokwane Central","Active"],["Naledi Mokoena","Employee","Dr KY Sepeng Inc","Polokwane Central","Active"],["Karabo Letsoalo","Employee","Dr KY Sepeng Inc","Seshego","Active"],["Neo Talane","Manager","Talane & Associates","Burgersfort","Active"],["Zinhle Mabena","Employee","Talane & Associates","Pretoria East","Invited"]];
const branches = [["Polokwane Central","Dr KY Sepeng Inc","Mpho Dlamini","8","418"],["Seshego","Dr KY Sepeng Inc","Keneilwe Phiri","6","294"],["Mankweng","Dr KY Sepeng Inc","Mpho Dlamini","4","236"],["Burgersfort","Talane & Associates","Neo Talane","7","322"],["Pretoria East","Talane & Associates","Nthabi Molepo","9","301"]];

export function CompaniesView({ mode, notify }: { mode:string; notify:(message:string)=>void }) {
  const title = mode === "users" ? "Users & access" : mode === "branches" ? "Branches" : "Companies";
  const noun = mode === "users" ? "user" : mode === "branches" ? "branch" : "company";
  return <><div className="page-head"><div><h1>{title}</h1><p>Manage organisational structure, assignments and access boundaries.</p></div><button className="btn btn-primary" onClick={()=>notify(`New ${noun} form opened`)}><Plus size={14}/>Add {noun}</button></div>
  {mode === "companies" ? <div className="company-grid">{companies.map(company=><div className="card company-card" key={company.name}><div className="company-top"><div className="company-logo"><Building2 size={21}/></div><span className="badge standard">Active</span></div><h3>{company.name}</h3><p>{company.reg} · <MapPin size={10} style={{verticalAlign:-2}}/> {company.location}</p><div className="company-stats"><div className="company-stat"><strong>{company.branches}</strong><span>Branches</span></div><div className="company-stat"><strong>{company.users}</strong><span>Users</span></div><div className="company-stat"><strong>{company.leads}</strong><span>Recall leads</span></div><div className="company-stat"><strong>{company.verified}</strong><span>Verified</span></div></div><div className="company-footer"><span>Last activity 8 minutes ago</span><button className="tiny-link">Manage company →</button></div></div>)}</div> : <><div className="toolbar"><div className="searchbar"><Search size={14}/><input placeholder={`Search ${title.toLowerCase()}…`}/></div><select className="select"><option>All companies</option><option>Dr KY Sepeng Inc</option><option>Talane & Associates</option></select></div><div className="card"><div className="table-wrap"><table className="data-table"><thead><tr>{(mode === "users" ? ["Name","Role","Company","Branch","Status"] : ["Branch","Company","Manager","Team size","Active leads"]).map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{(mode === "users" ? users : branches).map(row=><tr key={row[0]}>{row.map((cell,i)=><td key={cell}>{i===0?<strong>{cell}</strong>:i===4?<span className="badge standard">{cell}</span>:cell}</td>)}</tr>)}</tbody></table></div></div></>}
  </>;
}
