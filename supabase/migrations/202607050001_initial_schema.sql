-- MyPatient Journey MVP schema (Supabase / PostgreSQL)
create extension if not exists "pgcrypto";

create type public.app_role as enum ('super_user', 'manager', 'employee');
create type public.lead_status as enum (
  'new','allocated','call_attempted','no_answer','whatsapp_sent','call_back_later',
  'waiting_for_patient_response','callback_due','booking_recorded_pending_verification',
  'manager_review','cooling_list','patient_booked_and_verified','patient_not_interested',
  'wrong_number_confirmed','patient_moved_away','patient_deceased','duplicate','manager_closed'
);
create type public.aid_quality as enum ('unknown','low','medium','high','premium');

create table public.companies (
  id uuid primary key default gen_random_uuid(), name text not null, registration_number text,
  is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.branches (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies on delete cascade,
  name text not null, practice_phone text, timezone text default 'Africa/Johannesburg', integration_config jsonb not null default '{}',
  is_active boolean not null default true, created_at timestamptz not null default now(), unique(company_id,name)
);
create table public.users (
  id uuid primary key references auth.users on delete cascade, full_name text not null, email text not null,
  company_id uuid references public.companies, branch_id uuid references public.branches,
  is_active boolean not null default true, created_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid not null references public.users on delete cascade, role public.app_role not null,
  company_id uuid references public.companies, branch_id uuid references public.branches,
  primary key(user_id, role)
);
create table public.patients (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies,
  account_number text not null, full_name text not null, date_of_birth date, medical_aid_scheme text,
  medical_aid_option text, external_patient_id text, created_at timestamptz not null default now(),
  unique(company_id, account_number)
);
create table public.patient_contacts (
  id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients on delete cascade,
  contact_type text not null check(contact_type in ('mobile','alternate','whatsapp','email')),
  value text not null, is_primary boolean not null default false, is_verified boolean not null default false,
  wrong_number_at timestamptz, created_at timestamptz not null default now()
);
create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies,
  branch_id uuid references public.branches, upload_type text not null check(upload_type in ('transactions','curated_contacts')),
  original_name text not null, storage_path text not null, file_hash text, row_count integer,
  uploaded_by uuid not null references public.users, created_at timestamptz not null default now()
);
create table public.import_batches (
  id uuid primary key default gen_random_uuid(), uploaded_file_id uuid not null references public.uploaded_files,
  status text not null default 'mapping', source_metadata jsonb not null default '{}', imported_rows integer default 0,
  rejected_rows integer default 0, imported_by uuid references public.users, completed_at timestamptz, created_at timestamptz not null default now()
);
create table public.column_mappings (
  id uuid primary key default gen_random_uuid(), import_batch_id uuid not null references public.import_batches on delete cascade,
  source_column text not null, target_field text not null, transform_config jsonb not null default '{}', confidence numeric(5,2),
  confirmed_by uuid references public.users, unique(import_batch_id,target_field)
);
create table public.transactions (
  id uuid primary key default gen_random_uuid(), import_batch_id uuid not null references public.import_batches,
  patient_id uuid not null references public.patients, branch_id uuid references public.branches,
  transaction_date date not null, treatment_code text, practitioner text, amount_charged numeric(12,2),
  source_row_number integer, source_payload jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.recall_rules (
  id uuid primary key default gen_random_uuid(), company_id uuid references public.companies,
  name text not null, description text, rule_type text not null, parameters jsonb not null,
  priority integer not null default 100, is_active boolean not null default true, created_by uuid references public.users,
  updated_at timestamptz not null default now()
);
create table public.medical_aid_schemes (
  id uuid primary key default gen_random_uuid(), company_id uuid references public.companies,
  name text not null, normalized_name text not null, notes text, unique(company_id,normalized_name)
);
create table public.medical_aid_options (
  id uuid primary key default gen_random_uuid(), scheme_id uuid not null references public.medical_aid_schemes on delete cascade,
  option_name text not null, quality_score integer not null default 0 check(quality_score between 0 and 100),
  category public.aid_quality not null default 'unknown', notes text, effective_from date, effective_to date,
  updated_by uuid references public.users, updated_at timestamptz not null default now(), unique(scheme_id,option_name)
);
create table public.leads (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies,
  branch_id uuid references public.branches, patient_id uuid not null references public.patients,
  source_import_batch_id uuid not null references public.import_batches, recall_rule_id uuid references public.recall_rules,
  status public.lead_status not null default 'new', priority_label text not null, priority_score integer not null default 0,
  recall_reason text not null, last_visit_date date, last_8101_date date, last_8159_date date,
  next_action_at timestamptz, unsuccessful_attempt_days integer not null default 0,
  integration_refs jsonb not null default '{}', final_outcome_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.lead_assignments (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads,
  employee_id uuid not null references public.users, assigned_by uuid not null references public.users,
  assigned_at timestamptz not null default now(), ended_at timestamptz, reason text
);
create table public.lead_outcomes (
  id uuid primary key default gen_random_uuid(), code text not null unique, label text not null,
  is_final boolean not null default false, counts_as_unsuccessful_attempt boolean not null default false,
  employee_selectable boolean not null default true, required_fields jsonb not null default '[]'
);
create table public.lead_attempts (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads,
  employee_id uuid not null references public.users, outcome_id uuid not null references public.lead_outcomes,
  channel text not null check(channel in ('phone','whatsapp_call','whatsapp_message','other')),
  attempted_at timestamptz not null default now(), contact_day date generated always as ((attempted_at at time zone 'Africa/Johannesburg')::date) stored,
  phone_used text, template_key text, notes text, metadata jsonb not null default '{}'
);
create table public.callback_tasks (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads,
  assigned_to uuid not null references public.users, callback_at timestamptz not null,
  time_range text, reason text not null, notes text, completed_at timestamptz, created_by uuid references public.users,
  created_at timestamptz not null default now()
);
create table public.booking_records (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads,
  recorded_by uuid not null references public.users, preferred_date date not null, preferred_time text not null,
  confidence text not null check(confidence in ('confirmed_with_patient','requested_availability','tentative')),
  notes text, external_calendar_ref text, recorded_at timestamptz not null default now()
);
create table public.booking_verifications (
  id uuid primary key default gen_random_uuid(), booking_record_id uuid not null references public.booking_records,
  verified_by uuid not null references public.users, verification_status text not null check(verification_status in ('found','not_found','date_changed','cancelled','needs_follow_up')),
  verification_notes text, verified_date date, verified_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key, company_id uuid references public.companies,
  actor_id uuid references public.users, entity_type text not null, entity_id uuid,
  action text not null, before_data jsonb, after_data jsonb, request_id text,
  ip_address inet, created_at timestamptz not null default now()
);

create index transactions_patient_code_date_idx on public.transactions(patient_id,treatment_code,transaction_date desc);
create index leads_branch_status_idx on public.leads(branch_id,status,next_action_at);
create index lead_assignments_active_idx on public.lead_assignments(employee_id) where ended_at is null;
create unique index lead_attempts_one_unsuccessful_per_day on public.lead_attempts(lead_id,contact_day,outcome_id);
create index audit_logs_entity_idx on public.audit_logs(entity_type,entity_id,created_at desc);

-- Security helpers keep RLS policy expressions small and consistent.
create or replace function public.current_role() returns public.app_role language sql stable security definer set search_path=public as $$
  select role from public.user_roles where user_id=auth.uid() order by case role when 'super_user' then 1 when 'manager' then 2 else 3 end limit 1
$$;
create or replace function public.current_branch_id() returns uuid language sql stable security definer set search_path=public as $$
  select branch_id from public.users where id=auth.uid()
$$;
create or replace function public.current_company_id() returns uuid language sql stable security definer set search_path=public as $$
  select company_id from public.users where id=auth.uid()
$$;

alter table public.companies enable row level security;
alter table public.branches enable row level security;
alter table public.users enable row level security;
alter table public.patients enable row level security;
alter table public.transactions enable row level security;
alter table public.leads enable row level security;
alter table public.lead_assignments enable row level security;
alter table public.lead_attempts enable row level security;
alter table public.callback_tasks enable row level security;
alter table public.booking_records enable row level security;
alter table public.booking_verifications enable row level security;
alter table public.audit_logs enable row level security;

create policy "super users see all companies" on public.companies for all using(public.current_role()='super_user') with check(public.current_role()='super_user');
create policy "company users see own branches" on public.branches for select using(public.current_role()='super_user' or company_id=public.current_company_id());
create policy "scoped patients" on public.patients for select using(public.current_role()='super_user' or company_id=public.current_company_id());
create policy "source transactions are read only to scoped staff" on public.transactions for select using(exists(select 1 from public.patients p where p.id=patient_id and (public.current_role()='super_user' or p.company_id=public.current_company_id())));
create policy "employees see assigned leads" on public.leads for select using(
  public.current_role()='super_user' or
  (public.current_role()='manager' and branch_id=public.current_branch_id()) or
  (public.current_role()='employee' and exists(select 1 from public.lead_assignments a where a.lead_id=id and a.employee_id=auth.uid() and a.ended_at is null))
);
create policy "managers update branch leads" on public.leads for update using(public.current_role()='super_user' or (public.current_role()='manager' and branch_id=public.current_branch_id()));
create policy "assigned employees create attempts" on public.lead_attempts for insert with check(employee_id=auth.uid() and exists(select 1 from public.lead_assignments a where a.lead_id=lead_id and a.employee_id=auth.uid() and a.ended_at is null));
create policy "scoped attempts visible" on public.lead_attempts for select using(exists(select 1 from public.leads l where l.id=lead_id and (public.current_role()='super_user' or l.branch_id=public.current_branch_id() or employee_id=auth.uid())));
create policy "managers verify bookings" on public.booking_verifications for insert with check(public.current_role() in ('super_user','manager') and verified_by=auth.uid());
create policy "audit logs are append only" on public.audit_logs for insert with check(actor_id=auth.uid());
create policy "scoped audit visibility" on public.audit_logs for select using(public.current_role()='super_user' or company_id=public.current_company_id());

-- Recalculate three distinct unsuccessful days after an attempt. Employees never silently close a lead.
create or replace function public.enforce_three_strike_rule() returns trigger language plpgsql security definer set search_path=public as $$
declare distinct_days integer; unsuccessful boolean;
begin
  select counts_as_unsuccessful_attempt into unsuccessful from public.lead_outcomes where id=new.outcome_id;
  if unsuccessful then
    select count(distinct a.contact_day) into distinct_days from public.lead_attempts a join public.lead_outcomes o on o.id=a.outcome_id where a.lead_id=new.lead_id and o.counts_as_unsuccessful_attempt;
    update public.leads set unsuccessful_attempt_days=distinct_days,
      status=case when distinct_days>=3 then 'manager_review'::public.lead_status else status end,
      updated_at=now() where id=new.lead_id;
  end if;
  return new;
end $$;
create trigger lead_attempt_three_strike after insert on public.lead_attempts for each row execute function public.enforce_three_strike_rule();

