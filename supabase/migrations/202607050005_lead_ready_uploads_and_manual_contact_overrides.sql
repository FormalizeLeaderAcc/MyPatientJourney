-- Lead-ready uploads and manual contact protection.
-- The live Upload Centre no longer imports raw transaction lists. Messy data is
-- cleaned client-side into a lead-ready spreadsheet before production import.

alter table public.uploaded_files
  drop constraint if exists uploaded_files_upload_type_check;

alter table public.uploaded_files
  add constraint uploaded_files_upload_type_check
  check(upload_type in ('transactions','curated_contacts','lead_ready'));

alter table public.patient_contacts
  add column if not exists manual_override boolean not null default false,
  add column if not exists manual_override_at timestamptz;
