-- Allow uploaded-list recall to remove imported patient/contact records while
-- preserving immutable contact audit history.
alter table public.patient_contact_change_logs
  alter column patient_id drop not null;

alter table public.patient_contact_change_logs
  drop constraint if exists patient_contact_change_logs_patient_id_fkey,
  add constraint patient_contact_change_logs_patient_id_fkey
    foreign key (patient_id) references public.patients(id) on delete set null;

alter table public.patient_contact_change_logs
  drop constraint if exists patient_contact_change_logs_contact_id_fkey,
  add constraint patient_contact_change_logs_contact_id_fkey
    foreign key (contact_id) references public.patient_contacts(id) on delete set null;

create or replace function public.log_patient_contact_change()
returns trigger
language plpgsql security definer set search_path=public as $$
declare
  patient_company uuid;
begin
  select company_id into patient_company from public.patients where id = coalesce(new.patient_id, old.patient_id);
  insert into public.patient_contact_change_logs(company_id, patient_id, contact_id, actor_id, action, before_data, after_data)
  values (
    patient_company,
    coalesce(new.patient_id, old.patient_id),
    case when tg_op = 'DELETE' then null else coalesce(new.id, old.id) end,
    coalesce(new.updated_by, old.updated_by),
    case tg_op
      when 'INSERT' then 'created'
      when 'UPDATE' then 'updated'
      when 'DELETE' then 'deleted'
      else lower(tg_op)
    end,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end $$;
