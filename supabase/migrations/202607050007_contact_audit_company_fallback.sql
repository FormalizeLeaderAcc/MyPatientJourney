-- Make uploaded-list recall resilient when contact audit history is written
-- for legacy contacts whose patient/company lookup is no longer available.
-- The recall action itself is still recorded in audit_logs; this trigger keeps
-- contact-change logs from blocking a controlled uploaded-list withdrawal.

create or replace function public.log_patient_contact_change()
returns trigger
language plpgsql security definer set search_path=public as $$
declare
  contact_patient_id uuid := coalesce(new.patient_id, old.patient_id);
  contact_batch_id uuid := coalesce(new.source_import_batch_id, old.source_import_batch_id);
  resolved_company_id uuid;
begin
  select p.company_id
    into resolved_company_id
  from public.patients p
  where p.id = contact_patient_id;

  if resolved_company_id is null and contact_batch_id is not null then
    select uf.company_id
      into resolved_company_id
    from public.import_batches ib
    join public.uploaded_files uf on uf.id = ib.uploaded_file_id
    where ib.id = contact_batch_id;
  end if;

  -- If neither the patient nor the import batch can identify a company, do not
  -- block the parent operation with a not-null violation. This can only happen
  -- with incomplete legacy rows; the parent recall/delete audit remains intact.
  if resolved_company_id is null then
    return coalesce(new, old);
  end if;

  insert into public.patient_contact_change_logs(company_id, patient_id, contact_id, actor_id, action, before_data, after_data)
  values (
    resolved_company_id,
    contact_patient_id,
    case when tg_op = 'DELETE' then null else coalesce(new.id, old.id) end,
    coalesce(new.updated_by, old.updated_by, auth.uid()),
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
