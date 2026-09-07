# Production deployment

The browser application is deployed to Google Cloud Run. Firebase remains the identity/media provider and Supabase remains the business database, Edge API, scheduler, and generation queue.

## 1. Supabase production changes

Apply migrations and deploy the Edge API with an account that has access to project `cyygmyiqgdzgeoayxbro`:

```powershell
npx supabase link --project-ref cyygmyiqgdzgeoayxbro
npx supabase db push
npx supabase functions deploy app-api --project-ref cyygmyiqgdzgeoayxbro --use-api
```

Deploy **from this repository checkout only**. Never deploy a one-line
`import "https://raw.githubusercontent.com/..."` stub as `app-api`. A previous
MCP deploy left version 142 in that state; Studio analyze then fails before it
can reach Gemini/OpenAI. GitHub Actions already deploys with `--use-api` from
the `main` tree. After merge, confirm the live function source is the full
`supabase/functions/app-api/index.ts` bundle, not a GitHub URL redirect.

### Recommended Product Truth policy (order2 / `cyygmyiqgdzgeoayxbro`)

Analysis/planning is a vision job. Slow GPT-5.6 high-reasoning routes time out
inside the Edge Function and used to surface as "The vision provider could not
complete this request" without falling back. This release reroutes slow OpenAI
product-truth policies to Gemini 3.8 Flash at runtime when `GEMINI_API_KEY` is
present. To persist the fast route in Administration (and in `ai_runs`), apply:

```sql
-- Product truth + pose planning: Gemini Flash primary, Gemini 3.6 Flash fallback.
-- Replace the organization_id if this workspace is not the VB Export org.
update public.organization_ai_model_policies
set
  primary_provider = 'gemini',
  primary_model = 'gemini-3.8-flash',
  primary_reasoning = 'medium',
  fallback_enabled = true,
  fallback_provider = 'gemini',
  fallback_model = 'gemini-3.6-flash',
  fallback_reasoning = 'medium',
  revision = revision + 1,
  updated_at = now()
where purpose = 'product_truth';
```

Leave `image_generation` on an approved OpenAI GPT Image model. Do not put
secrets in SQL or in the repo. `GEMINI_API_KEY` must remain set on the Edge
Function for this route.

Configure server-only Edge secrets. Never add their values to Vite variables or GitHub build arguments.

```powershell
npx supabase secrets set --project-ref cyygmyiqgdzgeoayxbro `
  OPENAI_API_KEY=... `
  OPENAI_ADMIN_KEY=... `
  GEMINI_API_KEY=... `
  FIREBASE_SERVICE_ACCOUNT=... `
  FIREBASE_PROJECT_ID=ai-studio-app-be068 `
  FIREBASE_STORAGE_BUCKET=ai-studio-app-be068.firebasestorage.app `
  CATALOG_WORKER_SECRET=... `
  RESEND_API_KEY=... `
  RESEND_FROM="Youthnic AI Studio <reports@your-verified-domain.example>"
```

Install the same random `CATALOG_WORKER_SECRET` in Supabase Vault with the
secret name `catalog_worker_secret`. The scheduled database jobs read the
Vault copy, while `app-api` validates the Edge Function copy. This is a
one-time project setup and the value must never be committed.

`OPENAI_ADMIN_KEY` must be an organization Admin API key. A normal project API key can generate images but cannot read `/v1/organization/usage/images` or `/v1/organization/costs`.

The migration creates two Supabase Cron jobs:

- `ai-studio-event-automation`: four bounded daily attempts; idempotency keys prevent duplicate monthly reports/reminders.
- `ai-studio-openai-usage-sync`: hourly organization Usage/Costs API synchronization.

## 2. GitHub repository configuration

Create these repository variables:

- `SUPABASE_PROJECT_REF` (`cyygmyiqgdzgeoayxbro`)
- `GCP_PROJECT_ID`
- `GCP_REGION` (recommended: `europe-west1` when using Cloud Run domain mapping)
- `CLOUD_RUN_SERVICE` (default: `youthnic-ai-studio`)
- `ARTIFACT_REGISTRY_REPOSITORY` (default: `cloud-run`)
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`

Create these repository secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `GCP_SA_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_FIREBASE_API_KEY`

`GCP_SA_KEY` must contain the complete Google service-account key JSON (not a filename, connection string, or base64 value). The deployment workflow authenticates with this secret directly and does not use Workload Identity Federation.

Treat `GCP_SA_KEY` as a password: create it only for the GitHub deployment service account, grant that account `roles/run.admin` and `roles/artifactregistry.writer`, plus `roles/iam.serviceAccountUser` on the Cloud Run runtime service account. Do not grant `Owner`. Rotate the key immediately if it is exposed, and prefer Workload Identity Federation for a future hardening pass.

`SUPABASE_ACCESS_TOKEN` is created under Supabase account access tokens and
must have access to the target project. `SUPABASE_DB_PASSWORD` is the target
project's database password only (not a connection URL or pooler password).
The workflow uses them only to apply migrations
and deploy `app-api`; provider keys remain stored directly in Supabase.

## 3. Cloud Run cost controls

The workflow deploys a static Nginx container using request-based billing with:

- 1 vCPU
- 256 MiB memory
- concurrency 80
- minimum instances 0 (scale to zero)
- maximum instances 3
- 60-second request timeout
- CPU throttling outside requests

This keeps the Cloud Run web-serving portion well below the ₹1,500/month target for ordinary internal traffic. Firebase, Supabase, OpenAI, Gemini, Resend, Artifact Registry storage, and network egress are separate provider charges and must be budgeted independently.

## 4. Release verification

Every push to `main` first applies pending Supabase migrations and deploys the
Edge Function. In parallel, it validates `GCP_SA_KEY`, the selected Google
Cloud project, and the Artifact Registry repository. It then runs lint and the
production build, creates an immutable image tagged with the commit SHA,
deploys it, and checks `/healthz`. Before promoting a release, also verify:

1. Firebase sign-in and personal profile update.
2. Admin event automation settings and a manual report email.
3. OpenAI Admin usage sync.
4. State-wise Events research.
5. Studio generation and instruction-aware History regeneration.
6. Catalog readiness transitions from incomplete → analyzing → ready → generating → completed/needs review.
