-- Trigger to automatically mark Catalog Work Items as generation complete
-- when the underlying generation_job completes.

create or replace function public.sync_catalog_generation_status()
returns trigger as $$
begin
  if NEW.status = 'completed' and OLD.status is distinct from 'completed' then
    update public.catalog_work_items
    set 
      generation_status = 'completed',
      qc_status = case when qc_status = 'not_started' then 'needs_review' else qc_status end,
      generation_completed_at = NEW.completed_at
    where generation_job_id = NEW.job_id
      and generation_status != 'completed';
  elsif NEW.status = 'failed' and OLD.status is distinct from 'failed' then
    update public.catalog_work_items
    set generation_status = 'failed'
    where generation_job_id = NEW.job_id
      and generation_status != 'failed';
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists sync_catalog_generation_status_trigger on public.generation_jobs;
create trigger sync_catalog_generation_status_trigger
after update of status on public.generation_jobs
for each row
execute function public.sync_catalog_generation_status();
