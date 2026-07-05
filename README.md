# MyPatient Journey

A premium dental patient recall and continuity-of-care command centre built with Next.js App Router, React, TypeScript, Tailwind CSS, Supabase/PostgreSQL and a browser-safe XLSX parser.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The login screen includes Super User, Manager and Employee demo workspaces. The demo password is prefilled.

## Supabase setup

1. Create a Supabase project.
2. Apply [`supabase/migrations/202607050001_initial_schema.sql`](./supabase/migrations/202607050001_initial_schema.sql) with the Supabase CLI or SQL editor.
3. Copy `.env.example` to `.env.local` and provide the project values.
4. Replace the demo repositories with Supabase queries; the UI types and role boundaries mirror the schema.

The schema keeps uploaded transactions separate from operational leads, traces every lead to an import batch, includes RLS role boundaries, supports booking verification, and enforces the three-distinct-day rule in PostgreSQL.

## Demo flows

- Role-aware login and navigation
- Transaction or curated-contact upload
- Real XLSX/XLS/CSV parsing and editable mapping
- Recall opportunity preview and generation
- Employee lead cards and guided patient call roadmap
- WhatsApp message generation and copy workflow
- Callback scheduling and booking recording
- Manager calendar verification
- Medical aid scoring and organisation analytics
- Auditable three-strike escalation

External integrations (3CX, WhatsApp Business, Google/Outlook Calendar and PMS/EMD systems) are represented through integration metadata and external reference fields, but intentionally not connected in the MVP.

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the GitHub, Supabase, Vercel, and real-patient-data release checklist.
