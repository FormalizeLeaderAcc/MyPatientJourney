# Deployment runbook

MyPatient Journey deploys as a Next.js application on Vercel with Supabase providing authentication, PostgreSQL, Row Level Security, and storage.

## 1. GitHub

1. Create a **private** repository named `my-patient-journey`.
2. Push the local `main` branch.
3. Keep the included GitHub Actions workflow required on pull requests once branch protection is enabled.

No `.env.local` file, service-role key, patient spreadsheet, export, or database backup may be committed.

## 2. Supabase

1. Create a production-test project using a strong generated database password.
2. Link the local project with the Supabase CLI.
3. Apply `supabase/migrations/202607050001_initial_schema.sql`.
4. Create the first Super User through Supabase Auth and assign their matching `users` and `user_roles` records.
5. In Authentication → URL Configuration, add the Vercel production URL and preview URL pattern.

Required public values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server-only value for future administrative API routes:

- `SUPABASE_SERVICE_ROLE_KEY`

Never prefix the service-role key with `NEXT_PUBLIC_`.

## 3. Vercel

1. Import the GitHub repository.
2. Keep the detected framework as Next.js and install command as `npm ci`.
3. Add the Supabase public values to Development, Preview, and Production.
4. Add the service-role key only when server-side administrative routes require it.
5. Deploy, then verify `/api/health`, login, employee lead access, manager verification, and Super User boundaries.

## Release gate for real patient data

- Confirm Supabase RLS policies with employee and manager test accounts.
- Enable MFA for Super Users and Managers.
- Use synthetic data until access reviews and data-processing agreements are complete.
- Confirm backups, retention, audit-log retention, and incident contacts.
- Confirm POPIA responsibilities and patient-contact consent with the practice.
- Do not upload real patient spreadsheets to preview deployments.
