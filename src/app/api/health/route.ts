import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  return NextResponse.json({
    status: "ok",
    application: "MyPatient Journey",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    services: { supabase: supabaseConfigured ? "configured" : "not-configured" },
    timestamp: new Date().toISOString(),
  });
}
