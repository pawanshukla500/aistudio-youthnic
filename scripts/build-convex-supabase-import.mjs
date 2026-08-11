import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const exportRoot = resolve(".migration-audit-20260811/convex-export");
const outputPath = resolve("supabase/migrations/20260811160000_import_convex_business_archive.sql");
const excluded = new Set([
  "_storage", "_tables", "authAccounts", "authCredentials", "authRateLimits", "authRefreshTokens",
  "authSessions", "authVerificationCodes", "authVerifiers",
]);

const directories = (await readdir(exportRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !excluded.has(entry.name))
  .map((entry) => entry.name)
  .sort();

const documents = [];
for (const table of directories) {
  const source = await readFile(join(exportRoot, table, "documents.jsonl"), "utf8").catch(() => "");
  for (const line of source.split(/\r?\n/).filter(Boolean)) {
    const payload = JSON.parse(line);
    if (!payload._id) continue;
    documents.push({ table, id: String(payload._id), payload });
  }
}

const dollarJson = (value) => `$convex_json$${JSON.stringify(value)}$convex_json$::jsonb`;
const archiveValues = documents.map((document) =>
  `('convex', ${dollarJson(document.table)} #>> '{}', ${dollarJson(document.id)} #>> '{}', ${dollarJson(document.payload)})`,
);

const header = `-- One-time import generated from the read-only Convex export captured on 2026-08-11.
-- Firebase is the identity/session authority, so Convex Auth credentials,
-- password material, refresh tokens, sessions, verifiers, and rate-limit rows
-- are deliberately excluded. Every business document is preserved verbatim.

insert into public.app_migration_archive (source_system, source_table, source_id, payload)
values
${archiveValues.join(",\n")}
on conflict (source_system, source_table, source_id)
do update set payload = excluded.payload, migrated_at = now();

do $convex_import$
declare
  org_id uuid;
  member_id uuid;
  v_batch_id uuid;
  request_id uuid;
  role_id uuid;
  permission_id uuid;
  row_record record;
  user_payload jsonb;
  event_date date;
  event_slug text;
  batch_status text;
  request_status text;
  session_payload jsonb;
begin
  select id into org_id from public.organizations order by created_at limit 1;
  if org_id is null then raise exception 'No Supabase organization exists for the Convex import.'; end if;

  update public.organizations organization
  set legacy_convex_id = archive.source_id
  from public.app_migration_archive archive
  where archive.source_system = 'convex' and archive.source_table = 'organizations'
    and (organization.slug = archive.payload->>'slug' or organization.id = org_id);

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'roles' loop
    update public.roles set legacy_convex_id = row_record.source_id
    where organization_id = org_id and slug = row_record.payload->>'slug';
  end loop;

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'permissions' loop
    update public.permissions set legacy_convex_id = row_record.source_id where key = row_record.payload->>'key';
  end loop;

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'organizationMembers' loop
    select payload into user_payload from public.app_migration_archive
    where source_system = 'convex' and source_table = 'users' and source_id = row_record.payload->>'userId';
    if coalesce(user_payload->>'firebaseUid', '') <> '' then
      update public.organization_members set legacy_convex_id = row_record.source_id
      where organization_id = org_id and firebase_uid = user_payload->>'firebaseUid';
    end if;
  end loop;

  -- Event intelligence is matched by normalized name/year so the existing
  -- Supabase research corpus is enriched instead of duplicated.
  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'events' loop
    event_date := to_timestamp(((row_record.payload->>'date')::double precision) / 1000)::date;
    event_slug := coalesce(nullif(row_record.payload->>'dedupeKey', ''), regexp_replace(lower(row_record.payload->>'name'), '[^a-z0-9]+', '-', 'g') || '-' || extract(year from event_date)::int);
    update public.marketing_events set legacy_convex_id = row_record.source_id
      where organization_id = org_id and (slug = event_slug or (lower(name) = lower(row_record.payload->>'name') and year = extract(year from event_date)::int));
    if not found then
      insert into public.marketing_events (
        organization_id, slug, name, category, start_date, end_date, preparation_deadline, priority,
        applicable_states, target_marketplaces, description, source, source_detail, status, year,
        is_recurring, confidence, research_payload, legacy_convex_id
      ) values (
        org_id, event_slug, row_record.payload->>'name', coalesce(row_record.payload->>'type', 'seasonal'), event_date, event_date,
        coalesce(to_timestamp(((row_record.payload->>'prepDeadline')::double precision) / 1000)::date, event_date - 21),
        coalesce(row_record.payload->>'priority', 'normal'),
        case when coalesce(row_record.payload->>'region', '') = '' then '{}'::text[] else array[row_record.payload->>'region'] end,
        case when coalesce(row_record.payload->>'marketplace', '') = '' then '{}'::text[] else array[row_record.payload->>'marketplace'] end,
        coalesce(row_record.payload->>'description', ''), coalesce(row_record.payload->>'source', 'convex'), 'Imported from Convex business archive',
        coalesce(row_record.payload->>'status', 'active'), extract(year from event_date)::int, false,
        coalesce((row_record.payload->>'confidence')::numeric, 0.5), row_record.payload, row_record.source_id
      );
    end if;
  end loop;

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'catalogs' loop
    select id into v_batch_id from public.planning_batches
      where organization_id = org_id and (legacy_convex_id = row_record.source_id or lower(name) = lower(row_record.payload->>'name'))
      order by created_at limit 1;
    batch_status := case when row_record.payload->>'status' = 'completed' then 'completed' else 'active' end;
    if v_batch_id is null then
      insert into public.planning_batches (
        organization_id, batch_code, name, total_skus, generated_count, pending_count, failed_count, status,
        created_by_member_id, catalog_key, queue_status, campaign_season, scheduled_at, schedule_status,
        schedule_started_at, schedule_finished_at, schedule_error, priority, generation_settings, legacy_convex_id,
        created_at, updated_at
      ) values (
        org_id, 'LEGACY-' || upper(substr(md5(row_record.source_id), 1, 8)), row_record.payload->>'name',
        coalesce((row_record.payload->>'totalSkus')::int, 0), coalesce((row_record.payload->>'completedSkus')::int, 0),
        greatest(0, coalesce((row_record.payload->>'totalSkus')::int, 0) - coalesce((row_record.payload->>'completedSkus')::int, 0) - coalesce((row_record.payload->>'failedSkus')::int, 0)),
        coalesce((row_record.payload->>'failedSkus')::int, 0), batch_status,
        (select id from public.organization_members where organization_id = org_id and status = 'active' order by created_at limit 1),
        regexp_replace(lower(row_record.payload->>'name'), '[^a-z0-9]+', '-', 'g'),
        case when row_record.payload->>'status' = 'failed' then 'failed' when row_record.payload->>'status' = 'completed' then 'completed' else 'idle' end,
        coalesce(row_record.payload->>'campaign', ''),
        case when row_record.payload ? 'scheduledAt' then to_timestamp(((row_record.payload->>'scheduledAt')::double precision) / 1000) else null end,
        case when row_record.payload->>'status' = 'failed' then 'failed' when row_record.payload->>'status' = 'completed' then 'completed' else 'none' end,
        case when row_record.payload ? 'startedAt' then to_timestamp(((row_record.payload->>'startedAt')::double precision) / 1000) else null end,
        case when row_record.payload ? 'completedAt' then to_timestamp(((row_record.payload->>'completedAt')::double precision) / 1000) else null end,
        coalesce(row_record.payload->>'runError', ''), coalesce(row_record.payload->>'priority', 'normal'),
        jsonb_build_object('modelDirection', row_record.payload->>'modelDirection', 'sceneDirection', row_record.payload->>'sceneDirection',
          'category', row_record.payload->>'category', 'aspectRatio', coalesce(row_record.payload->>'aspectRatio', '3:4'),
          'imageSize', coalesce(row_record.payload->>'imageSize', '2K'), 'quality', 'medium', 'poseQa', coalesce((row_record.payload->>'poseQa')::boolean, true)),
        row_record.source_id,
        coalesce(to_timestamp(((row_record.payload->>'createdAt')::double precision) / 1000), now()), now()
      ) returning id into v_batch_id;
    else
      update public.planning_batches set legacy_convex_id = row_record.source_id,
        generation_settings = jsonb_build_object('modelDirection', row_record.payload->>'modelDirection', 'sceneDirection', row_record.payload->>'sceneDirection',
          'category', row_record.payload->>'category', 'aspectRatio', coalesce(row_record.payload->>'aspectRatio', '3:4'),
          'imageSize', coalesce(row_record.payload->>'imageSize', '2K'), 'quality', 'medium', 'poseQa', coalesce((row_record.payload->>'poseQa')::boolean, true)),
        schedule_error = coalesce(row_record.payload->>'runError', schedule_error), updated_at = now()
      where id = v_batch_id;
    end if;
    update public.app_migration_archive set destination_table = 'planning_batches', destination_id = v_batch_id::text
      where source_system = 'convex' and source_table = 'catalogs' and source_id = row_record.source_id;
  end loop;

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'catalogSkus' loop
    select destination_id::uuid into v_batch_id from public.app_migration_archive
      where source_system = 'convex' and source_table = 'catalogs' and source_id = row_record.payload->>'catalogId';
    if v_batch_id is null then continue; end if;
    select request.id into request_id from public.planning_requests request
      where request.organization_id = org_id and (request.legacy_convex_id = row_record.source_id or (request.batch_id = v_batch_id and lower(request.sku_name) = lower(row_record.payload->>'sku')))
      order by request.created_at limit 1;
    request_status := case when row_record.payload->>'status' in ('completed','failed','generating','cancelled') then row_record.payload->>'status' else 'draft' end;
    if request_id is null then
      insert into public.planning_requests (
        organization_id, created_by_member_id, batch_id, sku_name, color_label, product_description, photoshoot_type,
        category, status, request_code, generation_status, completion_status, validation_status, validation_report,
        queue_position, error_message, legacy_convex_id, created_at, updated_at
      ) values (
        org_id, (select id from public.organization_members where organization_id = org_id and status = 'active' order by created_at limit 1),
        v_batch_id, row_record.payload->>'sku', coalesce(row_record.payload->>'colorLabel', ''), '', 'catalog_colourway_5_pose', '',
        request_status, 'LEGACY-' || upper(substr(md5(row_record.source_id), 1, 8)), coalesce(row_record.payload->>'status', 'pending'),
        case when row_record.payload->>'status' = 'completed' then 'completed' else 'pending' end,
        case when row_record.payload->>'readinessStatus' = 'ready' then 'ready' else 'pending' end,
        jsonb_build_object('ready', row_record.payload->>'readinessStatus' = 'ready', 'reasons', coalesce(row_record.payload->'readinessReasons', '[]'::jsonb)),
        coalesce((row_record.payload->>'position')::int, 0) + 1, coalesce(row_record.payload->>'error', ''), row_record.source_id,
        coalesce(to_timestamp(((row_record.payload->>'createdAt')::double precision) / 1000), now()), now()
      ) returning id into request_id;
    else
      update public.planning_requests set legacy_convex_id = row_record.source_id where id = request_id;
    end if;
    update public.app_migration_archive set destination_table = 'planning_requests', destination_id = request_id::text
      where source_system = 'convex' and source_table = 'catalogSkus' and source_id = row_record.source_id;
  end loop;

  -- Create a non-batch request for every standalone Studio SKU so all uploaded
  -- Firebase references remain connected to canonical Supabase business data.
  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'productReferences' loop
    select id into request_id from public.planning_requests
      where organization_id = org_id and lower(sku_name) = lower(row_record.payload->>'skuId')
      order by (batch_id is not null) desc, created_at limit 1;
    if request_id is null then
      insert into public.planning_requests (
        organization_id, created_by_member_id, sku_name, product_description, photoshoot_type, category, status,
        request_code, generation_status, completion_status, validation_status, legacy_convex_id
      ) values (
        org_id, (select id from public.organization_members where organization_id = org_id and status = 'active' order by created_at limit 1),
        row_record.payload->>'skuId', '', 'legacy_studio_reference_bundle', '', 'analyzed',
        'LEGACY-' || upper(substr(md5(row_record.payload->>'skuId'), 1, 8)), 'ready', 'pending', 'pending', 'bundle:' || (row_record.payload->>'skuId')
      ) returning id into request_id;
    end if;
    insert into public.planning_assets (
      organization_id, planning_request_id, sku_name, prompt, image_url, storage_path, sku_matched,
      asset_role, storage_backend, metadata, legacy_convex_id, created_at
    ) values (
      org_id, request_id, row_record.payload->>'skuId', '', coalesce(row_record.payload->>'downloadUrl', ''), coalesce(row_record.payload->>'storagePath', ''), true,
      case when row_record.payload->>'role' = 'style_reference' then 'style_reference' else coalesce(row_record.payload->>'role', 'reference') end,
      'firebase', row_record.payload - '_id', row_record.source_id,
      coalesce(to_timestamp(((row_record.payload->>'createdAt')::double precision) / 1000), now())
    ) on conflict (legacy_convex_id) where legacy_convex_id is not null do update
      set image_url = excluded.image_url, storage_path = excluded.storage_path, metadata = excluded.metadata;
    select id into permission_id from public.planning_assets where legacy_convex_id = row_record.source_id;
    update public.app_migration_archive set destination_table = 'planning_assets', destination_id = permission_id::text
      where source_system = 'convex' and source_table = 'productReferences' and source_id = row_record.source_id;
  end loop;

  -- Attach imported catalog front/back URLs from the authoritative reference rows.
  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'catalogSkus' loop
    select destination_id::uuid into request_id from public.app_migration_archive
      where source_system = 'convex' and source_table = 'catalogSkus' and source_id = row_record.source_id;
    update public.planning_requests set
      front_image_url = coalesce((select payload->>'downloadUrl' from public.app_migration_archive where source_system='convex' and source_table='productReferences' and source_id=row_record.payload->>'frontReferenceId'), front_image_url),
      front_image_path = coalesce((select payload->>'storagePath' from public.app_migration_archive where source_system='convex' and source_table='productReferences' and source_id=row_record.payload->>'frontReferenceId'), front_image_path),
      back_image_url = coalesce((select payload->>'downloadUrl' from public.app_migration_archive where source_system='convex' and source_table='productReferences' and source_id=row_record.payload->>'backReferenceId'), back_image_url),
      back_image_path = coalesce((select payload->>'storagePath' from public.app_migration_archive where source_system='convex' and source_table='productReferences' and source_id=row_record.payload->>'backReferenceId'), back_image_path),
      updated_at = now()
    where id = request_id;
  end loop;

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'catalogMemory' loop
    select destination_id::uuid into v_batch_id from public.app_migration_archive
      where source_system='convex' and source_table='catalogs' and source_id=row_record.payload->>'catalogId';
    if v_batch_id is not null then
      update public.planning_batches set catalog_memory = row_record.payload - '_id', memory_updated_at = now() where id = v_batch_id;
      update public.app_migration_archive set destination_table='planning_batches', destination_id=v_batch_id::text
        where source_system='convex' and source_table='catalogMemory' and source_id=row_record.source_id;
    end if;
  end loop;

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'generationSessions' loop
    session_payload := row_record.payload - '_id';
    select id into request_id from public.planning_requests
      where organization_id=org_id and lower(sku_name)=lower(coalesce(row_record.payload->>'skuId', row_record.payload->>'skuName', ''))
      order by created_at desc limit 1;
    insert into public.catalog_sessions (
      session_id, job_id, user_id, session_data, organization_id, planning_request_id, status,
      analysis_fingerprint, product_hash, reference_hash, legacy_convex_id, created_at, updated_at
    ) values (
      row_record.source_id, '', '', session_payload, org_id, request_id,
      case when row_record.payload->>'status' in ('generating','completed','needs_review') then row_record.payload->>'status' else 'ready' end,
      coalesce(row_record.payload->>'analysisFingerprint',''), coalesce(row_record.payload->>'productHash',''), coalesce(row_record.payload->>'referenceHash',''),
      row_record.source_id, coalesce(to_timestamp(((row_record.payload->>'createdAt')::double precision)/1000), now()),
      coalesce(to_timestamp(((row_record.payload->>'updatedAt')::double precision)/1000), now())
    ) on conflict (session_id) do update set session_data=excluded.session_data, legacy_convex_id=excluded.legacy_convex_id;
    update public.app_migration_archive set destination_table='catalog_sessions', destination_id=row_record.source_id
      where source_system='convex' and source_table='generationSessions' and source_id=row_record.source_id;
  end loop;

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'aiAnalysisCache' loop
    insert into public.analysis_cache (
      organization_id, org_key, cache_kind, cache_key, sku_name, product_category, payload,
      hit_count, expires_at, legacy_convex_id, created_at, updated_at
    ) values (
      org_id, org_id::text, 'studio_product_analysis',
      coalesce(row_record.payload->>'cacheKey', row_record.payload->>'productHash', row_record.source_id),
      coalesce(row_record.payload->>'skuName',''), coalesce(row_record.payload->>'category',''),
      coalesce(row_record.payload->'result', row_record.payload->'payload', row_record.payload - '_id'),
      coalesce((row_record.payload->>'hitCount')::int,0),
      case when row_record.payload ? 'expiresAt' then to_timestamp(((row_record.payload->>'expiresAt')::double precision)/1000) else now()+interval '30 days' end,
      row_record.source_id, coalesce(to_timestamp(((row_record.payload->>'createdAt')::double precision)/1000),now()), now()
    ) on conflict (org_key, cache_kind, cache_key) do update
      set payload=excluded.payload, legacy_convex_id=excluded.legacy_convex_id, updated_at=now();
  end loop;

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'notifications' loop
    select member.id into member_id
    from public.app_migration_archive imported_member
    join public.app_migration_archive imported_user on imported_user.source_system='convex' and imported_user.source_table='users' and imported_user.source_id=imported_member.payload->>'userId'
    join public.organization_members member on member.organization_id=org_id and member.firebase_uid=imported_user.payload->>'firebaseUid'
    where imported_member.source_system='convex' and imported_member.source_table='organizationMembers'
      and imported_user.source_id=row_record.payload->>'recipientUserId' limit 1;
    insert into public.notifications (
      organization_id, type, channel, recipient_member_id, title, body, payload, status,
      created_at, sent_at, read_at, legacy_convex_id
    ) values (
      org_id, coalesce(row_record.payload->>'type','info'), 'in_app', member_id,
      coalesce(row_record.payload->>'title',''), coalesce(row_record.payload->>'message',''), row_record.payload - '_id', 'sent',
      coalesce(to_timestamp(((row_record.payload->>'createdAt')::double precision)/1000),now()),
      coalesce(to_timestamp(((row_record.payload->>'createdAt')::double precision)/1000),now()),
      case when row_record.payload ? 'readAt' then to_timestamp(((row_record.payload->>'readAt')::double precision)/1000) else null end,
      row_record.source_id
    ) on conflict (legacy_convex_id) where legacy_convex_id is not null do update set payload=excluded.payload;
    member_id := null;
  end loop;

  for row_record in select * from public.app_migration_archive where source_system = 'convex' and source_table = 'auditLogs' loop
    insert into public.audit_logs (
      organization_id, actor_email, action, resource_type, resource_id, metadata, created_at, legacy_convex_id
    ) values (
      org_id, coalesce((select payload->>'email' from public.app_migration_archive where source_system='convex' and source_table='users' and source_id=row_record.payload->>'actorUserId'),''),
      row_record.payload->>'action', coalesce(row_record.payload->>'entityType',''), coalesce(row_record.payload->>'entityId',''),
      coalesce(row_record.payload->'metadata','{}'::jsonb), coalesce(to_timestamp(((row_record.payload->>'timestamp')::double precision)/1000),now()), row_record.source_id
    ) on conflict (legacy_convex_id) where legacy_convex_id is not null do update set metadata=excluded.metadata;
  end loop;

  -- Record canonical destinations for tables retained only as immutable audit
  -- history. Their complete payloads remain queryable by service-role tooling.
  update public.app_migration_archive set destination_table=coalesce(destination_table,'app_migration_archive'), destination_id=coalesce(destination_id,source_id)
  where source_system='convex';
end;
$convex_import$;
`;

await writeFile(outputPath, header, "utf8");
console.log(`Business documents archived: ${documents.length}`);
console.log(`Auth/session/credential tables excluded: ${[...excluded].filter((name) => name.startsWith("auth")).length}`);
console.log(`Migration written: ${outputPath}`);
