-- A generation session may have at most one job in flight.
--
-- queueGeneration created a fresh job and a fresh set of session_generations
-- rows on every call, both keyed on session_id, with nothing checking for a run
-- already under way. Submitting the same session twice therefore produced two
-- jobs, twelve pose rows for a six-pose shoot, and twelve billed images. A
-- gateway timeout on the queue call makes pressing Generate again an ordinary
-- thing for an operator to do, so this was reachable in normal use.
--
-- The application now hands back the job already in flight. This index is what
-- makes that hold when two requests race each other.

-- Any session already carrying more than one in-flight job is in exactly the
-- state the index forbids, so resolve that first or the index cannot be built.
-- Keep the newest and retire the rest: they duplicate a run that is still
-- going, and nothing else will ever close them. Nothing is deleted, so their
-- ai_runs cost rows, session_generations rows and generated assets all remain
-- exactly as they were.
create temporary table superseded_generation_jobs on commit drop as
with ranked as (
  select
    job_id,
    row_number() over (
      partition by session_id
      order by created_at desc, job_id desc
    ) as position
  from public.generation_jobs
  where status in ('queued', 'processing', 'cancelling')
)
select job_id from ranked where position > 1;

update public.generation_jobs as jobs
set
  status = 'failed',
  error_code = 'duplicate_session_job',
  error_message = 'Superseded: this session already had a newer generation job in flight.',
  updated_at = now()
from superseded_generation_jobs as superseded
where jobs.job_id = superseded.job_id;

-- Retiring the job is not enough on its own. The worker claims the next queued
-- pose by session_id alone, without regard to which job owns the row, so a
-- superseded job's still-queued poses would be picked up and billed by the job
-- that survived - reproducing at migration time the very duplication this
-- change exists to stop. Retire those rows too.
--
-- Only rows still waiting are touched. Anything already completed keeps its
-- paid output, its cost and its QA verdict untouched.
update public.session_generations as poses
set
  status = 'failed',
  error = 'Superseded: this pose belonged to a duplicate generation job for the same session.',
  updated_at = now()
from superseded_generation_jobs as superseded
where poses.status in ('queued', 'processing')
  and (
    poses.generation_data ->> 'jobId' = superseded.job_id
    or poses.generation_id like superseded.job_id || ':pose:%'
  );

-- Partial so that a session's finished jobs are unconstrained: re-running a
-- session after it completes or fails stays allowed, and only concurrent runs
-- are refused. 'cancelling' counts as in flight because the worker still claims
-- such a job until it reaches finalizeCancelledJob, so a replacement started in
-- that window would spend alongside it.
create unique index if not exists generation_jobs_one_active_per_session_idx
  on public.generation_jobs (session_id)
  where status in ('queued', 'processing', 'cancelling');
