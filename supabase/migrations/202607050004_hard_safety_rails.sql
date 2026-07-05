-- Hard safety rails for live patient data separation and user lifecycle control.
-- This migration is intentionally defensive: application bugs should not be
-- able to mix companies, branches, patients, leads, assignments, imports or
-- medical aid scoring rows.

alter table public.users
  add column if not exists account_status text not null default 'active'
    check (account_status in ('active','invited','blocked','suspended','deleted')),
  add column if not exists is_primary_super boolean not null default false,
  add column if not exists avatar_url text,
  add column if not exists preferences jsonb not null default '{}',
  add column if not exists updated_at timestamptz not null default now();

alter table public.patient_contacts
  add column if not exists updated_by uuid references public.users,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists source_import_batch_id uuid references public.import_batches;

alter table public.patients
  add column if not exists source_import_batch_id uuid references public.import_batches;

alter table public.lead_assignments
  add column if not exists reassignment_policy text
    check (reassignment_policy in ('reassigned','returned_to_pool','left_pending','user_suspended','user_deleted')),
  add column if not exists replacement_employee_id uuid references public.users;

alter table public.lead_attempts
  drop constraint if exists lead_attempts_channel_check;

alter table public.lead_attempts
  add constraint lead_attempts_channel_check
  check(channel in ('phone','whatsapp_call','whatsapp_message','email','other'));

create table if not exists public.communication_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies,
  branch_id uuid references public.branches,
  patient_id uuid not null references public.patients,
  lead_id uuid references public.leads,
  actor_id uuid references public.users,
  channel text not null check(channel in ('phone','whatsapp_call','whatsapp_message','email','callback','booking','other')),
  direction text not null default 'outbound' check(direction in ('outbound','inbound','internal')),
  subject text,
  body text,
  outcome text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.communication_events enable row level security;

create table if not exists public.patient_contact_change_logs (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies,
  patient_id uuid not null references public.patients,
  contact_id uuid references public.patient_contacts,
  actor_id uuid references public.users,
  action text not null check(action in ('created','updated','deleted','marked_wrong_number')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

alter table public.patient_contact_change_logs enable row level security;

create table if not exists public.medical_aid_import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies,
  original_name text not null,
  row_count integer not null default 0,
  imported_by uuid references public.users,
  status text not null default 'validated' check(status in ('validated','imported','failed')),
  validation_errors jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.medical_aid_import_batches enable row level security;

create or replace function public.current_role() returns public.app_role
language sql stable security definer set search_path=public as $$
  select role
  from public.user_roles
  where user_id=auth.uid()
  order by case role
    when 'super_user' then 1
    when 'sub_super_user' then 2
    when 'manager' then 3
    else 4
  end
  limit 1
$$;

create or replace function public.is_super_operator() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.user_roles
    where user_id = auth.uid()
      and role in ('super_user','sub_super_user')
  )
$$;

create or replace function public.is_primary_super() returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from public.users u
    join public.user_roles r on r.user_id = u.id
    where u.id = auth.uid()
      and u.is_primary_super
      and r.role = 'super_user'
  )
$$;

update public.users
set is_primary_super = true
where lower(email) = 'admin@formalize.co.za'
  and exists (
    select 1 from public.user_roles r
    where r.user_id = users.id and r.role = 'super_user'
  );

create or replace function public.ensure_branch_company_match() returns trigger
language plpgsql security definer set search_path=public as $$
declare branch_company uuid;
begin
  if new.branch_id is null then
    return new;
  end if;

  if new.company_id is null then
    raise exception 'A company is required when a branch is selected';
  end if;

  select company_id into branch_company from public.branches where id = new.branch_id;
  if branch_company is null or branch_company <> new.company_id then
    raise exception 'Branch does not belong to the selected company';
  end if;
  return new;
end $$;

drop trigger if exists users_branch_company_match on public.users;
create trigger users_branch_company_match
  before insert or update of company_id, branch_id on public.users
  for each row execute function public.ensure_branch_company_match();

drop trigger if exists uploaded_files_branch_company_match on public.uploaded_files;
create trigger uploaded_files_branch_company_match
  before insert or update of company_id, branch_id on public.uploaded_files
  for each row execute function public.ensure_branch_company_match();

drop trigger if exists leads_branch_company_match on public.leads;
create trigger leads_branch_company_match
  before insert or update of company_id, branch_id on public.leads
  for each row execute function public.ensure_branch_company_match();

create or replace function public.ensure_user_role_scope_match() returns trigger
language plpgsql security definer set search_path=public as $$
declare user_company uuid; branch_company uuid;
begin
  select company_id into user_company from public.users where id = new.user_id;
  if new.company_id is not null and user_company is not null and new.company_id <> user_company then
    raise exception 'User role company does not match user profile company';
  end if;

  if new.branch_id is not null then
    select company_id into branch_company from public.branches where id = new.branch_id;
    if branch_company is null or (new.company_id is not null and branch_company <> new.company_id) then
      raise exception 'User role branch does not belong to the selected company';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists user_roles_scope_match on public.user_roles;
create trigger user_roles_scope_match
  before insert or update of company_id, branch_id on public.user_roles
  for each row execute function public.ensure_user_role_scope_match();

create or replace function public.ensure_patient_company_matches_lead() returns trigger
language plpgsql security definer set search_path=public as $$
declare patient_company uuid; batch_company uuid; lead_branch_company uuid;
begin
  select company_id into patient_company from public.patients where id = new.patient_id;
  if patient_company is null or patient_company <> new.company_id then
    raise exception 'Lead patient does not belong to the selected company';
  end if;

  select f.company_id into batch_company
  from public.import_batches b
  join public.uploaded_files f on f.id = b.uploaded_file_id
  where b.id = new.source_import_batch_id;
  if batch_company is null or batch_company <> new.company_id then
    raise exception 'Lead import batch does not belong to the selected company';
  end if;

  if new.branch_id is not null then
    select company_id into lead_branch_company from public.branches where id = new.branch_id;
    if lead_branch_company is null or lead_branch_company <> new.company_id then
      raise exception 'Lead branch does not belong to the selected company';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists leads_patient_batch_company_match on public.leads;
create trigger leads_patient_batch_company_match
  before insert or update of company_id, branch_id, patient_id, source_import_batch_id on public.leads
  for each row execute function public.ensure_patient_company_matches_lead();

create or replace function public.ensure_transaction_company_integrity() returns trigger
language plpgsql security definer set search_path=public as $$
declare patient_company uuid; batch_company uuid; txn_branch_company uuid;
begin
  select company_id into patient_company from public.patients where id = new.patient_id;
  select f.company_id into batch_company
  from public.import_batches b
  join public.uploaded_files f on f.id = b.uploaded_file_id
  where b.id = new.import_batch_id;

  if patient_company is null or batch_company is null or patient_company <> batch_company then
    raise exception 'Transaction patient and import batch companies do not match';
  end if;

  if new.branch_id is not null then
    select company_id into txn_branch_company from public.branches where id = new.branch_id;
    if txn_branch_company is null or txn_branch_company <> batch_company then
      raise exception 'Transaction branch does not belong to the import batch company';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists transactions_company_integrity on public.transactions;
create trigger transactions_company_integrity
  before insert or update of import_batch_id, patient_id, branch_id on public.transactions
  for each row execute function public.ensure_transaction_company_integrity();

create or replace function public.ensure_assignment_company_integrity() returns trigger
language plpgsql security definer set search_path=public as $$
declare lead_company uuid; lead_branch uuid; employee_company uuid; employee_branch uuid; employee_status text;
begin
  select company_id, branch_id into lead_company, lead_branch from public.leads where id = new.lead_id;
  select company_id, branch_id, account_status into employee_company, employee_branch, employee_status from public.users where id = new.employee_id;

  if employee_status is distinct from 'active' then
    raise exception 'Cannot assign work to an inactive, blocked, suspended or deleted user';
  end if;
  if lead_company is null or employee_company is null or lead_company <> employee_company then
    raise exception 'Cannot assign a lead to a user from another company';
  end if;
  if lead_branch is not null and employee_branch is not null and lead_branch <> employee_branch then
    raise exception 'Cannot assign a branch lead to a user from another branch';
  end if;
  return new;
end $$;

drop trigger if exists lead_assignment_company_integrity on public.lead_assignments;
create trigger lead_assignment_company_integrity
  before insert or update of lead_id, employee_id on public.lead_assignments
  for each row execute function public.ensure_assignment_company_integrity();

create or replace function public.log_patient_contact_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare patient_company uuid;
begin
  select company_id into patient_company from public.patients where id = coalesce(new.patient_id, old.patient_id);
  insert into public.patient_contact_change_logs(company_id, patient_id, contact_id, actor_id, action, before_data, after_data)
  values (
    patient_company,
    coalesce(new.patient_id, old.patient_id),
    coalesce(new.id, old.id),
    coalesce(new.updated_by, auth.uid()),
    case when tg_op = 'INSERT' then 'created' when tg_op = 'DELETE' then 'deleted' else 'updated' end,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end $$;

drop trigger if exists patient_contact_audit on public.patient_contacts;
create trigger patient_contact_audit
  after insert or update or delete on public.patient_contacts
  for each row execute function public.log_patient_contact_change();

create or replace function public.recall_uploaded_list(
  p_uploaded_file_id uuid,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  file_record public.uploaded_files%rowtype;
  batch_ids uuid[];
  lead_ids uuid[];
  booking_ids uuid[];
  patient_ids uuid[];
  deleted_leads integer := 0;
begin
  if not exists (
    select 1
    from public.users u
    join public.user_roles r on r.user_id = u.id
    where u.id = p_actor_id
      and u.is_primary_super
      and r.role = 'super_user'
  ) then
    raise exception 'Only the primary Super User can recall or withdraw an uploaded list';
  end if;

  if coalesce(length(trim(p_reason)), 0) < 8 then
    raise exception 'A clear recall reason is required';
  end if;

  select * into file_record from public.uploaded_files where id = p_uploaded_file_id;
  if file_record.id is null then
    raise exception 'Uploaded list not found';
  end if;

  select coalesce(array_agg(id), '{}') into batch_ids
  from public.import_batches
  where uploaded_file_id = p_uploaded_file_id;

  select coalesce(array_agg(id), '{}') into lead_ids
  from public.leads
  where source_import_batch_id = any(batch_ids);

  select coalesce(array_agg(id), '{}') into booking_ids
  from public.booking_records
  where lead_id = any(lead_ids);

  select coalesce(array_agg(distinct patient_id), '{}') into patient_ids
  from (
    select patient_id from public.transactions where import_batch_id = any(batch_ids)
    union
    select patient_id from public.leads where id = any(lead_ids)
  ) source_patients;

  insert into public.audit_logs(company_id, actor_id, entity_type, entity_id, action, before_data, after_data)
  values (
    file_record.company_id,
    p_actor_id,
    'uploaded_file',
    p_uploaded_file_id,
    'recalled_uploaded_list',
    jsonb_build_object(
      'uploaded_file_id', file_record.id,
      'original_name', file_record.original_name,
      'company_id', file_record.company_id,
      'branch_id', file_record.branch_id,
      'upload_type', file_record.upload_type,
      'row_count', file_record.row_count
    ),
    jsonb_build_object('reason', p_reason, 'recalled_at', now())
  );

  delete from public.booking_verifications where booking_record_id = any(booking_ids);
  delete from public.booking_records where id = any(booking_ids);
  delete from public.callback_tasks where lead_id = any(lead_ids);
  delete from public.lead_attempts where lead_id = any(lead_ids);
  delete from public.communication_events where lead_id = any(lead_ids);
  delete from public.lead_assignments where lead_id = any(lead_ids);
  delete from public.leads where id = any(lead_ids);
  get diagnostics deleted_leads = row_count;

  delete from public.transactions where import_batch_id = any(batch_ids);
  delete from public.patient_contacts where source_import_batch_id = any(batch_ids);
  delete from public.patients p
  where p.source_import_batch_id = any(batch_ids)
    and not exists (select 1 from public.transactions t where t.patient_id = p.id)
    and not exists (select 1 from public.leads l where l.patient_id = p.id);

  delete from public.column_mappings where import_batch_id = any(batch_ids);
  delete from public.import_batches where id = any(batch_ids);
  delete from public.uploaded_files where id = p_uploaded_file_id;

  return jsonb_build_object(
    'uploaded_file_id', p_uploaded_file_id,
    'deleted_batches', coalesce(array_length(batch_ids, 1), 0),
    'deleted_leads', deleted_leads,
    'candidate_patients', coalesce(array_length(patient_ids, 1), 0)
  );
end $$;

drop policy if exists "super users see all companies" on public.companies;
create policy "super operators see all companies" on public.companies
  for all using(public.is_super_operator()) with check(public.is_super_operator());

drop policy if exists "company users see own branches" on public.branches;
create policy "company users see own branches" on public.branches
  for select using(public.is_super_operator() or company_id=public.current_company_id());

drop policy if exists "users read own profile" on public.users;
create policy "users read own profile" on public.users
  for select using (id = auth.uid() or public.is_super_operator());

drop policy if exists "users read own role" on public.user_roles;
create policy "users read own role" on public.user_roles
  for select using (user_id = auth.uid() or public.is_super_operator());

drop policy if exists "scoped patients" on public.patients;
create policy "scoped patients" on public.patients
  for select using(public.is_super_operator() or company_id=public.current_company_id());

drop policy if exists "source transactions are read only to scoped staff" on public.transactions;
create policy "source transactions are read only to scoped staff" on public.transactions
  for select using(exists(select 1 from public.patients p where p.id=patient_id and (public.is_super_operator() or p.company_id=public.current_company_id())));

drop policy if exists "employees see assigned leads" on public.leads;
create policy "employees see assigned leads" on public.leads for select using(
  public.is_super_operator() or
  (public.current_role()='manager' and company_id=public.current_company_id() and (branch_id is null or branch_id=public.current_branch_id())) or
  (public.current_role()='employee' and exists(select 1 from public.lead_assignments a where a.lead_id=id and a.employee_id=auth.uid() and a.ended_at is null))
);

drop policy if exists "managers update branch leads" on public.leads;
create policy "managers update branch leads" on public.leads
  for update using(public.is_super_operator() or (public.current_role()='manager' and company_id=public.current_company_id() and (branch_id is null or branch_id=public.current_branch_id())));

drop policy if exists "scoped uploaded files" on public.uploaded_files;
create policy "scoped uploaded files" on public.uploaded_files
  for select using (public.is_super_operator() or (public.current_role() = 'manager' and company_id = public.current_company_id()));

drop policy if exists "scoped import batches" on public.import_batches;
create policy "scoped import batches" on public.import_batches
  for select using (exists (
    select 1 from public.uploaded_files f
    where f.id = uploaded_file_id
      and (public.is_super_operator()
        or (public.current_role() = 'manager' and f.company_id = public.current_company_id()))
  ));

drop policy if exists "scoped column mappings" on public.column_mappings;
create policy "scoped column mappings" on public.column_mappings
  for select using (exists (
    select 1 from public.import_batches b
    join public.uploaded_files f on f.id = b.uploaded_file_id
    where b.id = import_batch_id
      and (public.is_super_operator()
        or (public.current_role() = 'manager' and f.company_id = public.current_company_id()))
  ));

drop policy if exists "scoped recall rules" on public.recall_rules;
create policy "scoped recall rules" on public.recall_rules
  for select using (public.is_super_operator() or company_id = public.current_company_id());

drop policy if exists "scoped medical aid schemes" on public.medical_aid_schemes;
create policy "scoped medical aid schemes" on public.medical_aid_schemes
  for select using (company_id is null or public.is_super_operator() or company_id = public.current_company_id());

drop policy if exists "read medical aid options" on public.medical_aid_options;
create policy "read medical aid options" on public.medical_aid_options
  for select using (exists (
    select 1 from public.medical_aid_schemes s
    where s.id = scheme_id
      and (s.company_id is null or public.is_super_operator() or s.company_id = public.current_company_id())
  ));

drop policy if exists "read active lead assignments" on public.lead_assignments;
create policy "read active lead assignments" on public.lead_assignments
  for select using (
    public.is_super_operator()
    or employee_id = auth.uid()
    or exists (select 1 from public.leads l where l.id = lead_id and l.company_id = public.current_company_id() and (l.branch_id is null or l.branch_id = public.current_branch_id()))
  );

drop policy if exists "scoped attempts visible" on public.lead_attempts;
create policy "scoped attempts visible" on public.lead_attempts
  for select using(exists(select 1 from public.leads l where l.id=lead_id and (public.is_super_operator() or l.company_id=public.current_company_id() or employee_id=auth.uid())));

drop policy if exists "managers verify bookings" on public.booking_verifications;
create policy "managers verify bookings" on public.booking_verifications
  for insert with check(public.current_role() in ('super_user','sub_super_user','manager') and verified_by=auth.uid());

drop policy if exists "scoped audit visibility" on public.audit_logs;
create policy "scoped audit visibility" on public.audit_logs
  for select using(public.is_super_operator() or company_id=public.current_company_id());

drop policy if exists "scoped communication visibility" on public.communication_events;
create policy "scoped communication visibility" on public.communication_events
  for select using(public.is_super_operator() or company_id = public.current_company_id() or actor_id = auth.uid());

drop policy if exists "employees append communication events" on public.communication_events;
create policy "employees append communication events" on public.communication_events
  for insert with check(actor_id = auth.uid() and (public.is_super_operator() or company_id = public.current_company_id()));

drop policy if exists "scoped contact change visibility" on public.patient_contact_change_logs;
create policy "scoped contact change visibility" on public.patient_contact_change_logs
  for select using(public.is_super_operator() or company_id = public.current_company_id() or actor_id = auth.uid());

drop policy if exists "scoped medical aid import visibility" on public.medical_aid_import_batches;
create policy "scoped medical aid import visibility" on public.medical_aid_import_batches
  for select using(public.is_super_operator() or company_id = public.current_company_id());
