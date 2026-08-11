# Youthnic AI Studio

Production additions now include grounded national/state-wise event intelligence, configurable Supabase Cron monthly reports and advance reminders, instruction-aware pose regeneration, readiness state tracking, OpenAI organization Usage/Costs synchronization, 14-day dashboard analytics, self-service profiles, and an optimized GitHub Actions → Cloud Run release path. See [Production deployment](docs/PRODUCTION_DEPLOYMENT.md) for required secrets, migration/deployment commands, and the low-cost Cloud Run configuration.

Youthnic AI Studio creates a consistent five-image fashion catalog photoshoot from product references. Firebase owns authentication and media storage. Supabase owns the application database, authorization, queues, schedules, learning data, and server-side AI orchestration.

Convex is no longer a runtime dependency of this application.

## Architecture

| Responsibility | Service |
| --- | --- |
| User sign-in, sessions, account status | Firebase Authentication |
| Front/back/fabric/style uploads and generated images | Firebase Storage |
| Organizations, RBAC, planning, history, events, notifications, learning | Supabase PostgreSQL |
| Browser data access and organization isolation | Supabase Data API + PostgreSQL RLS |
| Secure AI calls, administration, generation workers | Supabase Edge Function `app-api` |
| Scheduled catalog processing and stale-job recovery | Supabase Cron + `pg_net` |
| Product/reference analysis and five-pose planning | Gemini Vision |
| Final image generation | OpenAI `gpt-image-2` |
| Consistency validation and retry decisions | Gemini Vision QA |

The frontend sends the current Firebase ID token to Supabase. RLS maps the Firebase UID to `organization_members.firebase_uid`, then enforces organization and permission access.

## Studio workflow

1. Upload the required front and back product images. Fabric/pattern detail, additional product photos, and style references are optional.
2. Gemini analyzes every labeled reference and creates a structured Product Identity Profile and Creative Direction Profile.
3. Gemini creates a garment-specific five-pose plan: hero front, side/three-quarter, authoritative back, creative Gen-Z editorial, and product-detail close-up.
4. The analysis and plan are fingerprinted. Changing any reference marks both stale and generation cannot start until they are rebuilt.
5. A persistent generation session locks the product, model identity, face, hair, styling, scene, lighting, accessories, footwear, ratio, and pose plan.
6. Supabase claims one generation task at a time. Pose 1 becomes the approved visual anchor for poses 2–5, but original product references always remain the highest-priority source of truth.
7. Each pose is generated with `gpt-image-2`, checked against the product profile and set identity, and retried automatically when QA fails.

Every completed image is uploaded to Firebase Storage before the pose is marked complete. Supabase stores the durable image URL/path, generation status, prompt/QA metadata, provider request ID, reported token usage, and calculated cost. Deleting a job from History removes both its Supabase records and its generated Firebase objects; stopping a job preserves images that already completed.

## Catalog automation

- Saving valid front and back references starts Gemini preflight automatically; fabric/additional/style references are optional.
- Replacing any reference marks the previous analysis and pose plan stale and dispatches a new preflight.
- Missing optional legacy references are skipped with a server warning. Missing front or back product truth remains a hard failure.
- Once every colourway is ready, a saved preferred generation time is armed automatically. If that time is already due, the sequential catalog worker starts without another click.
- `ai-studio-catalog-preflight` runs every two minutes as a recovery net for uploads made before a browser was closed or during transient delivery failures.
- Catalog generation uses one active OpenAI image attempt at a time. Each colourway receives the same locked model, scene, camera/lighting continuity, and five-pose grammar while retaining its own front/back product truth.

## Generation controls and accounting

History and Studio show the live pose number, completed count, and percentage. A running job can be stopped safely, and History provides explicit stop/delete controls, per-image large preview, individual download, and ZIP download. History is server-paginated newest-first at 10 jobs per page; search and status filters run in Supabase before the page is returned. Only the visible page thumbnails and the five images of an expanded job are requested from Firebase.

When the Images API returns a `usage` object, the worker stores input text tokens, input image tokens, total input tokens, output tokens, total tokens, and the OpenAI request ID for each attempt and pose. “Actual cost” is calculated from those provider-reported tokens using the public rate for the selected GPT Image model. If OpenAI omits usage, the UI says that usage was not reported and does not invent a token count or fake actual cost. The original estimate remains visible separately.

The prompt construction follows OpenAI's [virtual clothing try-on guidance](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide#52-virtual-clothing-try-on): lock subject and product identity, allow only the requested pose/framing delta, and explicitly require realistic garment drape, folds, occlusion, lighting, and shadows.

Defaults:

- Aspect ratio: `3:4`
- GPT Image 2 quality: `medium`
- Shoot size: 5 images
- Generation order: sequential
- Product truth priority: front, back, fabric/pattern, additional product, structured profile, approved anchor, then style-only references

## Local setup

Requirements:

- Node.js and npm
- Firebase project `ai-studio-app-be068` with Email/Password Authentication enabled
- Firebase Storage bucket `ai-studio-app-be068.firebasestorage.app`
- Supabase project `cyygmyiqgdzgeoayxbro`

Install dependencies:

```powershell
npm.cmd install
```

Create `.env.local` with browser-safe values only:

```dotenv
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...
VITE_SUPABASE_URL=https://cyygmyiqgdzgeoayxbro.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

The verification and migration scripts can also use `FIREBASE_SERVICE_ACCOUNT`, `OPENAI_API_KEY`, and `GEMINI_API_KEY` from the local environment. Production backend secrets must be installed as encrypted Supabase Edge Function secrets, never exposed through `VITE_` variables.

Required Edge Function secrets:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `FIREBASE_SERVICE_ACCOUNT`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `CATALOG_WORKER_SECRET`

Optional email secrets are `RESEND_API_KEY`, `RESEND_FROM`, `EVENT_DIGEST_TO`, and `EVENT_DIGEST_CC`.

## Run the app

Use the Windows launcher:

```powershell
.\run.bat
```

Or run Vite directly:

```powershell
npm.cmd run dev -- --host localhost --port 5173
```

Validate the launcher without starting the server:

```powershell
.\run.bat --check
```

## Supabase deployment

Database migrations are in `supabase/migrations/`. The server runtime is in `supabase/functions/app-api/`.

With a Supabase CLI account that has access to the production project:

```powershell
npx.cmd supabase db push --project-ref cyygmyiqgdzgeoayxbro
npx.cmd supabase functions deploy app-api --project-ref cyygmyiqgdzgeoayxbro --no-verify-jwt
```

Legacy JWT verification is disabled for this function because `app-api` validates Firebase ID tokens and applies Supabase RLS itself. Internal cron calls additionally require `CATALOG_WORKER_SECRET`.

Active scheduled jobs:

- `ai-studio-due-catalogs` — claims due and interrupted running catalog batches every minute
- `ai-studio-generation-recovery` — recovers stale generation jobs every minute

- `ai-studio-catalog-preflight` — analyzes pending/stale catalog references every two minutes

### Tier 1 generation reliability

The generation worker is designed for the Supabase Free Edge Function wall-clock limit and the OpenAI Tier 1 image rate limit:

- Each Edge invocation performs at most one OpenAI image attempt, one Gemini QA pass, and one Firebase/Supabase commit.
- Provider or QA retries are persisted with `generation_jobs.available_at`; the worker returns immediately and a later invocation resumes the same pose.
- Retry delays respect provider headers and use a minimum 30-second Tier 1 backoff.
- Only one queued, processing, or cancelling generation job is claimable at a time.
- A four-minute database lease allows cron recovery without leaving the UI stuck for twelve minutes.
- Recovery returns a processing pose to queued while keeping the same session, product profile, pose plan, and approved anchor.
- Exhausted variants remain failed until an explicit user retry; the catalog processor does not create repeated paid jobs.
- Firebase service accounts may be stored as plain JSON or base64 JSON. A generated pose is accepted only after Firebase upload and the matching `planning_assets` row are both committed.

See the current [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits), [background task guidance](https://supabase.com/docs/guides/functions/background-tasks), [GPT Image 2 model limits](https://developers.openai.com/api/docs/models/gpt-image-2), [Images API usage fields](https://developers.openai.com/api/reference/resources/images), and [OpenAI API pricing](https://openai.com/api/pricing/).

## Authentication and administration

Firebase Authentication is the only user/session authority. The Administration page creates or disables Firebase users through the Edge Function and stores memberships, roles, and permissions in Supabase. An Admin can manage users and role permissions for the active organization.

Do not store application passwords in Supabase tables or local scripts.

## Verification

```powershell
npm.cmd run firebase:sync-supabase-claims
npm.cmd run supabase:verify-firebase
npm.cmd run supabase:verify-cutover -- --email returnorders@vbexports.co.in
npm.cmd run lint
npm.cmd run build
```

The cutover verifier checks Firebase authentication, Supabase RLS, Edge Function provider configuration, organization visibility, and access to `gpt-image-2` using the already configured OpenAI key. It does not print secret values.

## Completed data cutover

The read-only Convex export captured on 2026-08-11 is retained under `.migration-audit-20260811/` as rollback evidence and ignored by Git. The live import preserved 216 non-auth business documents in `app_migration_archive`; all 216 have a canonical destination and none remain unresolved. Convex Auth credentials, password material, sessions, refresh tokens, verifiers, and rate-limit rows were deliberately excluded because Firebase is authoritative.

The application source, dependencies, environment, launcher, and runtime no longer reference Convex. This makes the local application safe to operate after the old self-hosted Convex service is retired.

## Key files

- `src/lib/backend.ts` — Supabase query/action compatibility layer
- `src/lib/FirebaseAuthContext.tsx` — Firebase sessions
- `src/lib/WorkspaceContext.tsx` — active Supabase organization and permissions
- `src/features/studio/Studio.tsx` — Upload → Analyze → Pose Plan → Generate flow
- `supabase/functions/app-api/index.ts` — AI orchestration, queues, admin, planning, events, and migration API
- `supabase/functions/app-api/lib/profiles.ts` — product/creative profiles, pose plans, and prompt construction
- `supabase/functions/app-api/lib/qa.ts` — consistency validation and retry rules
- `supabase/migrations/20260811150000_convex_cutover_runtime.sql` — Supabase runtime tables and atomic claims
- `supabase/migrations/20260811153000_edge_worker_schedules.sql` — scheduled workers
- `supabase/migrations/20260811112304_tier1_generation_queue_recovery.sql` — durable retries and stale-job recovery
- `docs/SUPABASE_LIVE_SCHEMA_AUDIT.md` — live schema, security, and cutover verification

- `supabase/migrations/20260811170000_generation_usage_controls_preflight.sql` — provider usage fields and catalog preflight cron

Never commit `.env.local`, service-account JSON, passwords, provider keys, or Supabase service-role keys.
