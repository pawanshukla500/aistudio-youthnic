# Youthnic AI Studio — Product Feature Audit

This audit reflects the verified capabilities, routes, frontend views, backend contracts, permissions, and operational states implemented in the Youthnic AI Studio codebase (`aistudio-youthnic`).

---

## 1. Executive Summary & Application Scope

Youthnic AI Studio is an enterprise AI-native fashion catalog production platform engineered specifically for Indian ethnic wear and global apparel e-commerce brands. It automates the transition from raw, pre-shoot product reference photos into commercial 5-pose editorial catalog contact sheets, complete with garment fidelity locks, saree drape physics, bottom-wear architecture protection, AI model identity consistency, and multi-colourway batch production.

---

## 2. Comprehensive Feature Matrix

| Feature Domain | Client Route | Primary Source Files | User Purpose | Available User Actions | Permissions & Roles | Key Operational States | Documented Pages Needed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Authentication & Access** | `/login`, `/` | `src/features/auth/Login.tsx`, `src/lib/FirebaseAuthContext.tsx`, `src/lib/WorkspaceContext.tsx` | Secure identity management, organization tenant switching, role verification | Email/Password login, Google SSO, password reset, tenant workspace selection | Public / Firebase Auth | `loading`, `authenticated`, `unauthenticated`, `access_denied` | `getting-started/login-access.mdx` |
| **Workspace & Navigation** | App Frame | `src/components/ui/Layout.tsx`, `src/App.tsx`, `src/lib/WorkspaceContext.tsx` | Global navigation, organization context, user profile, notifications badge | Switch modules, change active organization, view unread notifications, logout | All authenticated users (menu items filtered by permissions) | `active`, `collapsed`, `mobile_drawer` | `getting-started/understanding-the-interface.mdx` |
| **Dashboard** | `/dashboard` | `src/features/dashboard/Dashboard.tsx`, `src/lib/useSupabaseDashboard.ts`, `src/lib/generationProgress.ts` | High-level operations overview, live queue monitoring, token usage & cost telemetry | View 14-day trends, inspect active generation job, view recent activity, click through to Planning or History | `reports.view` (or Admin) | `loading`, `live_generating`, `queue_clear`, `error` | `dashboard/overview.mdx`, `dashboard/analytics.mdx`, `dashboard/ai-costs.mdx` |
| **Studio (Single SKU Photoshoot)** | `/studio` | `src/features/studio/Studio.tsx`, `src/features/studio/components/*.tsx`, `src/features/studio/types.ts` | Transform raw product references into an analyzed, styled, 5-pose commercial photoshoot | Upload 8 reference roles, input SKU name/notes, trigger AI analysis, edit Creative Direction & Styling, customize Pose Plan, configure Output Options, Generate, QA Review, Regenerate, Download | `studio.view` (view), `studio.create` (generate) | `empty`, `uploading`, `analyzing`, `analysis_ready`, `generating`, `completed`, `failed` | `studio/overview.mdx`, `studio/upload-product-images.mdx`, `studio/ai-analysis.mdx`, `studio/creative-direction.mdx`, `studio/pose-planning.mdx`, `studio/generate-photoshoot.mdx`, `studio/quality-validation.mdx` |
| **Catalog Production** | `/planning` (Catalog Tab) | `src/features/planning/catalog-production/CatalogProduction.tsx`, `ProductionBoard.tsx`, `ProductionTable.tsx`, `AssetViewerModal.tsx` | Multi-SKU, multi-colourway collection management; team production tracking from request to marketplace listing | Create batch/collection, add colorways/SKUs, assign generation & listing team members, approve preflight/styling, trigger bulk generation (immediate/scheduled/sequential), QA review, listing signoff, export ZIP/Excel | `planning.view`, `planning.manage`, `catalog.assign`, `catalog.qc`, `catalog.listing` | `requested`, `reference_assets_pending`, `planning`, `ready`, `queued`, `generating`, `qc`, `listing`, `completed`, `blocked` | `catalog-production/overview.mdx`, `catalog-production/create-catalog.mdx`, `catalog-production/colourways-skus.mdx`, `catalog-production/preflight-approval.mdx`, `catalog-production/generate-catalog.mdx`, `catalog-production/production-tracking.mdx` |
| **Planning & Production Schedules** | `/planning` (Planning Tab) | `src/features/planning/Planning.tsx`, `supabase/migrations/*_catalog_workflow_v2*.sql` | Collection roadmaps, batch scheduling, event-linked campaigns, deadlines & capacity tracking | Create planning requests, organize batches, associate with calendar events, set deadlines, track SLA milestones | `planning.view`, `planning.manage` | `draft`, `submitted`, `approved`, `scheduled`, `in_production`, `closed` | `planning/overview.mdx`, `planning/create-plan.mdx`, `planning/schedules.mdx`, `planning/event-driven-planning.mdx` |
| **Marketing & Festival Events** | `/events` | `src/features/events/Events.tsx`, `src/lib/useRoadmap.ts` | Indian ethnic festival, regional holiday, and marketplace sale roadmap planning with AI research | Browse calendar (30/60/90/180/365d), filter by state/type, switch Timeline/Grid/Table views, trigger AI Event Research, seed events, Add Custom Event, export Excel, Email summary, "Plan Catalog from Event" | `planning.view`, `events.manage` | `on_track`, `due_now` (≤14d), `overdue` (<0d), `confirmed`, `unverified` | `events/overview.mdx`, `events/calendar-views.mdx`, `events/event-types-states.mdx`, `events/ai-event-research.mdx`, `events/plan-catalog-from-event.mdx` |
| **Generation History & Flow** | `/history`, `/history/flow/:jobId` | `src/features/history/History.tsx`, `src/features/history/generation-flow/*` | Audit trail of all generation jobs, asset downloads, DAG node lineage inspection, retry mechanism | Search/filter past jobs by SKU/status/date, view 5 poses, download high-res images / full ZIP, open interactive Workflow Graph, inspect prompt & token metrics, retry failed poses | `studio.view` or `planning.view` | `completed`, `failed`, `partial`, `processing`, `queued`, `cancelled` | `history/overview.mdx`, `history/view-generations.mdx`, `history/workflow-inspection.mdx`, `history/retries-downloads.mdx` |
| **Notifications Center** | `/notifications` | `src/features/notifications/Notifications.tsx` | Real-time and persistent alerts for generation completions, QA failures, planning deadlines, and system events | Read alerts, mark individual read, mark all read, navigate to source jobs | All authenticated members | `unread`, `read`, `empty` | `notifications/overview.mdx` |
| **Admin: Users & Teams** | `/admin` (Users & Teams Tabs) | `src/features/admin/Admin.tsx` | Member onboarding, account status toggling, team division (planning, generation, review, listing) | Invite/create user, edit profile, enable/disable access, create team, assign team lead and members | `admin.users`, `admin.teams` (or Organization Admin) | `active`, `suspended`, `pending_invite` | `admin/users.mdx`, `admin/teams.mdx` |
| **Admin: Roles & RBAC** | `/admin` (Roles Tab) | `src/features/admin/Admin.tsx` | Role-based permission assignments across Studio, Planning, Reports, Admin modules | Create custom roles, configure granular permissions (e.g. `studio.create`, `catalog.qc`), assign roles to users | `admin.roles` (or Organization Admin) | `system_role`, `custom_role` | `admin/roles-permissions.mdx` |
| **Admin: AI Routing & Models** | `/admin` (AI Tab) | `src/features/admin/Admin.tsx`, `src/features/admin/aiRouting.ts`, `supabase/functions/app-api/lib/aiModelPolicy.ts` | Multi-provider AI orchestration across Vision Analysis, Image QA, and Image Generation | Set primary & fallback providers (Google Gemini, OpenAI, Qwen, Meta Muse Spark), configure reasoning/thinking levels, auto-promotion | `admin.ai` (or Organization Admin) | `active_primary`, `fallback_standby`, `failing_over`, `repair_required` | `admin/ai-routing.mdx` |
| **Admin: Costs & Budgets** | `/admin` (Costs Tab) | `src/features/admin/Admin.tsx`, `src/lib/useSupabaseDashboard.ts` | Authoritative organization spend tracking, OpenAI billing synchronization, daily budget caps | Monitor daily USD spend, check provider token volume, set organization daily spending limit, inspect cost breakdown by SKU | `admin.costs` (or Organization Admin) | `within_budget`, `approaching_limit`, `budget_exceeded` | `admin/costs-budgets.mdx` |
| **Admin: Automations & System** | `/admin` (Automation & System Tabs) | `src/features/admin/Admin.tsx` | Scheduled reporting, automated event reminders, system health monitoring, audit trail | Configure automated report dispatch, set event notice lead times, inspect system health checks & audit logs | `admin.system` (or Organization Admin) | `healthy`, `degraded`, `scheduled` | `admin/automations-system.mdx` |

---

## 3. Core Technical Workflow Architecture

### 3.1 The 8 Reference Roles in Studio
1. `model_identity`: Facial bone structure, skin tone, hair, natural catchlights, facial asymmetry. Any garment or background in this photo is discarded.
2. `front`: Authoritative front garment cut, neckline, yoke embroidery, and silhouette. Pre-shoot background walls/arches/urns/plants are discarded.
3. `back`: Sole authority for rear construction, back neckline, rear ties, and hem. Dupatta is draped forward to ensure 100% unobstructed view.
4. `fabric_pattern`: Upper-garment microtexture, weave, print density, and embroidery rhythm.
5. `bottom`: Pixel-level authority for bottom wear (farshi pajama, palazzo, lehenga, cigarette pants) cut, volume, hem border, and metallic floral motifs.
6. `style_reference`: Sole visual authority for photoshoot backdrop architecture, studio room finish, flooring, lighting direction, and editorial mood.
7. `mannequin`: Garment shape, volume, and drape truth on a live form. Apparatus/hanger/stand is discarded.
8. `additional_product`: Supporting angles, sleeve cuffs, or dupatta pallu details.

### 3.2 Saree Specialized Roles
- `saree_front_drape`: Complete front pleats, drape, borders, and blouse-front truth.
- `saree_back_drape`: Rear drape fall, pallu drop, and blouse-back construction.
- `saree_body_detail`: Main body weave, transparency, shine, and motif geometry.
- `saree_pallu_spread`: Sole authority for pallu artwork, scale, orientation, borders, and tassels.
- `saree_border_tassels`: Upper/lower border widths, zari geometry, and tassel spacing.
- `saree_blouse_front` & `saree_blouse_back_piece`: Blouse color, fabric, front/back construction, ties, and sleeves.

### 3.3 The 5-Pose Commercial Catalog Standard
- **Pose 1 (Front Hero View)**: Full square head-to-toe front view; establishes model identity, styling, footwear, and studio backdrop anchor.
- **Pose 2 (Three-Quarter Perspective)**: 45° or 90° angled shot showcasing side seam, drape depth, sleeve opening, and silhouette.
- **Pose 3 (Rear Full View)**: 100% rear view; dupatta draped forward over arms, hair swept forward or updo; exact rear construction authority.
- **Pose 4 (Creative Editorial Pose)**:
  * *Conditional Seated Editorial*: If style reference or product notes demand sitting, model is elegantly seated on a minimal studio bench/step/plinth, keeping trousers/farshi, hem, and footwear fully visible and unbunched.
  * *Dynamic Playful Movement*: Otherwise, controlled dynamic walk, swirl, or motion highlighting fabric fluidity.
- **Pose 5 (Intimate Detail & Neckline Close-Up)**: Visibly zoomed-in face-to-chest or face-to-waist framing pairing a natural Gen-Z facial expression with razor-sharp product detail (neckline, embroidery, texture).
