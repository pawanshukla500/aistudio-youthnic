-- PR #47/#48 correctly made pallu evidence mandatory for a saree. Some
-- unstarted Studio analyses were created while their form category was still
-- "ethnic/fusion", even though Gemini had already identified garmentFamily as
-- saree. Reclassify only those non-archived, non-running records so the UI
-- requests the right evidence instead of repeatedly trying generic generation.
-- No generated output, source file, or completed task is touched.

update public.planning_requests as request
set
  category = 'saree',
  validation_status = 'pending',
  validation_report = jsonb_build_object(
    'ready', false,
    'reasons', jsonb_build_array(
      'Saree detected. Add or map the required saree regional evidence, including a fully spread pallu. A full pallu-spread image is required before generation.'
    )
  ),
  analysis_status = 'pending',
  analysis_fingerprint = '',
  error_message = 'Saree detected. Add or map the required saree regional evidence, including a fully spread pallu. A full pallu-spread image is required before generation.',
  updated_at = timezone('utc', now())
where request.archived_at is null
  and coalesce(request.category, '') <> 'saree'
  and lower(coalesce(
    request.ai_analysis #>> '{productIdentity,garmentFamily}',
    request.garment_analysis #>> '{productIdentity,garmentFamily}',
    ''
  )) = 'saree'
  and coalesce(request.generation_status, '') not in ('completed', 'generating', 'queued', 'processing')
  and not exists (
    select 1
    from public.generation_jobs as job
    where job.planning_request_id = request.id
      and job.status in ('queued', 'processing', 'cancelling')
  );
