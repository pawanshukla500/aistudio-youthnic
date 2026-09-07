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
`import "https://raw.githubusercontent.com/..."` stub as `app-api`. Production
`app-api` v142 was left in that state by a bad MCP deploy; Studio analyze then
fails before it can reach Gemini. Restore by deploying this repo's
`supabase/functions/app-api` bundle (GitHub Actions does this on merge to
`main` with `--use-api`). After deploy, in the Supabase dashboard open Edge
Function `app-api` and confirm the source is the multi-file bundle, not a
GitHub URL redirect. Do not ship another GitHub-URL stub entrypoint.

### Live Product Truth policy (order2 / `cyygmyiqgdzgeoayxbro`)

Studio analyze/plan **honors** `organization_ai_model_policies` purpose
`product_truth`. It does not call OpenAI GPT for garment analysis when that
row is Gemini. Live routing as of 2026-09-07:

| purpose | primary | fallback |
| --- | --- | --- |
| `product_truth` (analyze + pose plan) | `gemini` / `gemini-3.8-flash` | `gemini-3.6-flash` |
| `qa` | `gemini` / `gemini-3.8-flash` | `gemini-3.6-flash` |
| `image_generation` (paid poses) | `openai` / `gpt-image-2` | none |

Live `ai_runs` for `product_reference_analysis` in the last 12h show `gemini`
/ `gemini-3.8-flash`, **status failed**, empty `error_message`, and **30–45s
latency**. That matches production `AbortSignal.timeout(45_000)` on
`geminiJson`, not a bad model id. Empty `error_message` is because failed
analyze inserts omitted that column (it defaults to `''`).

This release still honors stored Gemini rows, but the recommended production
route is now **Muse Spark 1.3 Standard** with **GPT 5.6 Luna** fallback.
Contributor Muse SKUs train on prompts and are not the default.

Apply after this Edge Function is live (`META_MODEL_API_KEY` must be set).
This updates every organization in project `cyygmyiqgdzgeoayxbro`
(typically the single Youthnic org). Leave `image_generation` on `gpt-image-2`.
Do not select `muse-spark-1.3-contributor` unless the org opts into training.

```sql
-- Product truth + QA: Muse Spark 1.3 Standard, cheap OpenAI Luna fallback.
-- Do not use muse-spark-1.3-contributor unless the org opts into training.
update public.organization_ai_model_policies
set
  primary_provider = 'meta',
  primary_model = 'muse-spark-1.3',
  primary_reasoning = 'low',
  fallback_enabled = true,
  fallback_provider = 'openai',
  fallback_model = 'gpt-5.6-luna',
  fallback_reasoning = 'low',
  revision = revision + 1,
  updated_at = now()
where purpose in ('product_truth', 'qa');
```

Leave `image_generation` on `gpt-image-2`. Do not put secrets in SQL or in
the repo. Required Edge secrets: `META_MODEL_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`.

After a Studio Analyze, `ai_runs.provider` should be `meta` / `muse-spark-1.3`
(or `openai` / `gpt-5.6-luna` if Muse failed over). Failed rows now store
`error_message`.

Configure server-only Edge secrets. Never add their values to Vite variables or GitHub build arguments.

```powershell
npx supabase secrets set --project-ref cyygmyiqgdzgeoayxbro `
  OPENAI_API_KEY=... `
  OPENAI_ADMIN_KEY=... `
  GEMINI_API_KEY=... `
  META_MODEL_API_KEY=... `
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
