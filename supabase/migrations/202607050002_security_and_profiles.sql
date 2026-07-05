-- Reproducible security defaults for every table created by the initial schema.
-- Tables without an explicit allow policy remain private by default.
alter table public.companies enable row level security;
alter table public.branches enable row level security;
alter table public.users enable row level security;
alter table public.user_roles enable row level security;
alter table public.patients enable row level security;
alter table public.patient_contacts enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.import_batches enable row level security;
alter table public.column_mappings enable row level security;
alter table public.transactions enable row level security;
alter table public.recall_rules enable row level security;
alter table public.medical_aid_schemes enable row level security;
alter table public.medical_aid_options enable row level security;
alter table public.leads enable row level security;
alter table public.lead_assignments enable row level security;
alter table public.lead_outcomes enable row level security;
alter table public.lead_attempts enable row level security;
alter table public.callback_tasks enable row level security;
alter table public.booking_records enable row level security;
alter table public.booking_verifications enable row level security;
alter table public.audit_logs enable row level security;

create policy "users read own profile" on public.users
  for select using (id = auth.uid() or public.current_role() = 'super_user');

create policy "users read own role" on public.user_roles
  for select using (user_id = auth.uid() or public.current_role() = 'super_user');

create policy "scoped patient contacts" on public.patient_contacts
  for select using (exists (
    select 1 from public.patients p
    where p.id = patient_id
      and (public.current_role() = 'super_user' or p.company_id = public.current_company_id())
  ));

create policy "scoped uploaded files" on public.uploaded_files
  for select using (
    public.current_role() = 'super_user'
    or (public.current_role() = 'manager' and company_id = public.current_company_id())
  );

create policy "scoped import batches" on public.import_batches
  for select using (exists (
    select 1 from public.uploaded_files f
    where f.id = uploaded_file_id
      and (public.current_role() = 'super_user'
        or (public.current_role() = 'manager' and f.company_id = public.current_company_id()))
  ));

create policy "scoped column mappings" on public.column_mappings
  for select using (exists (
    select 1 from public.import_batches b
    join public.uploaded_files f on f.id = b.uploaded_file_id
    where b.id = import_batch_id
      and (public.current_role() = 'super_user'
        or (public.current_role() = 'manager' and f.company_id = public.current_company_id()))
  ));

create policy "scoped recall rules" on public.recall_rules
  for select using (public.current_role() = 'super_user' or company_id = public.current_company_id());

create policy "scoped medical aid schemes" on public.medical_aid_schemes
  for select using (company_id is null or public.current_role() = 'super_user' or company_id = public.current_company_id());

create policy "read medical aid options" on public.medical_aid_options
  for select using (exists (
    select 1 from public.medical_aid_schemes s
    where s.id = scheme_id
      and (s.company_id is null or public.current_role() = 'super_user' or s.company_id = public.current_company_id())
  ));

create policy "read active lead assignments" on public.lead_assignments
  for select using (
    public.current_role() = 'super_user'
    or employee_id = auth.uid()
    or exists (select 1 from public.leads l where l.id = lead_id and l.branch_id = public.current_branch_id())
  );

create policy "read lead outcomes" on public.lead_outcomes for select using (auth.uid() is not null);

create policy "employees manage own callbacks" on public.callback_tasks
  for all using (assigned_to = auth.uid() or public.current_role() in ('super_user', 'manager'))
  with check (assigned_to = auth.uid() or public.current_role() in ('super_user', 'manager'));

create policy "scoped booking records" on public.booking_records
  for select using (
    recorded_by = auth.uid()
    or public.current_role() = 'super_user'
    or exists (select 1 from public.leads l where l.id = lead_id and l.branch_id = public.current_branch_id())
  );

create policy "assigned employees record bookings" on public.booking_records
  for insert with check (
    recorded_by = auth.uid()
    and exists (
      select 1 from public.lead_assignments a
      where a.lead_id = lead_id and a.employee_id = auth.uid() and a.ended_at is null
    )
  );

create policy "scoped booking verifications" on public.booking_verifications
  for select using (exists (
    select 1 from public.booking_records b
    join public.leads l on l.id = b.lead_id
    where b.id = booking_record_id
      and (b.recorded_by = auth.uid() or public.current_role() = 'super_user' or l.branch_id = public.current_branch_id())
  ));

-- Auth users receive a minimal profile automatically. Company, branch, and role
-- assignments remain an explicit Super User action.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, full_name, email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
