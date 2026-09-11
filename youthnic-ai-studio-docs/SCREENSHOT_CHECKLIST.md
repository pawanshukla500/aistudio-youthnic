# Youthnic AI Studio Documentation — Screenshot Checklist

Every screenshot required across the documentation portal is cataloged below with its unique ID, destination documentation page, source route, exact UI state, captured region, recommended crop, recommended dimensions, and target filename.

---

## 1. Getting Started & Studio Screenshots

| Screenshot ID | Documentation Page | Route / Page | Exact UI State | Exact UI Section | Recommended Dimensions | Target Filename |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **GS-001** | `getting-started/login-access.mdx` | `/login` | Fresh unauthenticated login screen | Centered authentication card with email/password and Google login | 1200x800 | `images/getting-started/login-screen.webp` |
| **GS-002** | `getting-started/understanding-the-interface.mdx` | `/dashboard` | Authenticated session with full sidebar | Global shell showing left sidebar navigation, top bar, organization switcher | 1920x1080 | `images/getting-started/interface-overview.webp` |
| **GS-003** | `getting-started/first-generation-walkthrough.mdx` | `/studio` | Completed single-SKU photoshoot | Full Studio viewport with 5 completed poses ready for download | 1920x1080 | `images/getting-started/first-photoshoot-complete.webp` |
| **ST-001** | `studio/overview.mdx` | `/studio` | Empty initial Studio state | Full Studio container showing upload grid, SKU panel, and output settings | 1920x1080 | `images/studio/studio-overview.webp` |
| **ST-002** | `studio/upload-product-images.mdx` | `/studio` | References uploaded (Front, Back, Fabric, Bottom, Style) | Product References card with 5 active thumbnail cards and role selector dropdowns | 1400x700 | `images/studio/product-references-uploaded.webp` |
| **ST-003** | `studio/reference-roles.mdx` | `/studio` | Role selection dropdown open on a tile | Single image card highlighting the 8 selectable roles (`front`, `back`, `bottom`, etc.) | 800x600 | `images/studio/reference-roles-dropdown.webp` |
| **ST-004** | `studio/sku-details.mdx` | `/studio` | SKU details input with text | Product Name input field, Garment Category selector, and Special Instructions text area | 1000x500 | `images/studio/sku-details-panel.webp` |
| **ST-005** | `studio/ai-product-analysis.mdx` | `/studio` | Analysis completed | Analysis Profile container showing Garment Family badge, verified attributes, and confidence chips | 1400x900 | `images/studio/analysis-profile-card.webp` |
| **ST-006** | `studio/creative-direction.mdx` | `/studio` | Creative Direction accordion expanded | Studio environment description, lighting quality, camera angle, and editorial mood fields | 1200x800 | `images/studio/creative-direction-panel.webp` |
| **ST-007** | `studio/styling-recommendations.mdx` | `/studio` | Styling Plan accordion expanded | Footwear, jewellery, makeup, and hair stylist recommendation fields with edit controls | 1200x700 | `images/studio/styling-plan-panel.webp` |
| **ST-008** | `studio/pose-planning.mdx` | `/studio` | Pose Plan grid visible | 5 pose slot cards: Front Hero, Three-Quarter, Rear Full, Creative/Seated, Intimate Close-Up | 1600x600 | `images/studio/pose-plan-cards.webp` |
| **ST-009** | `studio/generation-progress.mdx` | `/studio` | Generation in progress | Live progress bar showing active pose generating (e.g. Pose 2 of 5) with token spend counter | 1400x600 | `images/studio/generation-progress-active.webp` |
| **ST-010** | `studio/quality-validation.mdx` | `/studio` | Completed poses with QA tags | Results grid showing verified checkmarks and QA status tags (`automatically_verified`, `unverified`) | 1600x900 | `images/studio/quality-validation-badges.webp` |
| **ST-011** | `studio/regenerate-retry.mdx` | `/studio` | Regenerate modal open for Pose 4 | Modal showing previous rejected attempt, optional correction notes field, and Regenerate button | 1000x750 | `images/studio/regenerate-pose-modal.webp` |

---

## 2. Catalog Production & Planning Screenshots

| Screenshot ID | Documentation Page | Route / Page | Exact UI State | Exact UI Section | Recommended Dimensions | Target Filename |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CP-001** | `catalog-production/overview.mdx` | `/planning` | Catalog Production tab selected | Main Catalog Production header showing metrics cards (Requested, Generation, QC, Listing) | 1920x1080 | `images/catalogs/catalog-production-overview.webp` |
| **CP-002** | `catalog-production/create-catalog.mdx` | `/planning` | "New Collection / Batch" modal | Modal with Collection Name, Campaign Season, Priority, and Marketplace selectors | 1000x800 | `images/catalogs/create-catalog-modal.webp` |
| **CP-003** | `catalog-production/colourways-skus.mdx` | `/planning` | Colourways table inside collection | Multi-SKU list showing Base SKU and 4 colorway variants with reference upload status | 1600x800 | `images/catalogs/colourways-sku-table.webp` |
| **CP-004** | `catalog-production/preflight-approval.mdx` | `/planning` | Preflight status banner on batch | Preflight review card displaying green checkmarks for verified colourways and preflight summary | 1400x600 | `images/catalogs/preflight-approval-card.webp` |
| **CP-005** | `catalog-production/production-tracking.mdx` | `/planning` | Production Board (Kanban view) | 5-column board (Requested, Generation, QC Review, Listing, Completed) with draggable SKU cards | 1920x1080 | `images/catalogs/production-kanban-board.webp` |
| **CP-006** | `catalog-production/production-tracking.mdx` | `/planning` | Production Table view with filters | Data table view with bulk select checkboxes, member assignment dropdowns, and status badges | 1920x1080 | `images/catalogs/production-data-table.webp` |
| **PL-001** | `planning/overview.mdx` | `/planning` | Planning Roadmap tab | Planning roadmap list showing active batches, target deadlines, and generation capacity | 1920x1080 | `images/planning/planning-roadmap-view.webp` |
| **PL-002** | `planning/create-plan.mdx` | `/planning` | Create Planning Request modal | Form capturing Request Code, Theme, Portal, Special Instructions, and Target Date | 1000x750 | `images/planning/create-plan-form.webp` |

---

## 3. Events Calendar Screenshots

| Screenshot ID | Documentation Page | Route / Page | Exact UI State | Exact UI Section | Recommended Dimensions | Target Filename |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **EV-001** | `events/overview.mdx` | `/events` | Timeline view with 90-day filter | Hero calendar timeline showing upcoming festive milestones (Diwali, Navratri) | 1920x1080 | `images/events/events-timeline-overview.webp` |
| **EV-002** | `events/calendar-views.mdx` | `/events` | Grid view with cards | Responsive event cards showing event type tag, prep status badge, and mood palette | 1600x900 | `images/events/events-grid-view.webp` |
| **EV-003** | `events/calendar-views.mdx` | `/events` | Table view with filters applied | Structured table view showing state tags, marketplace tags, dates, and action buttons | 1600x800 | `images/events/events-table-view.webp` |
| **EV-004** | `events/ai-event-research.mdx` | `/events` | AI Research completed toast | AI Research status indicator and verified event badges with source URLs | 1200x600 | `images/events/ai-research-results.webp` |
| **EV-005** | `events/plan-catalog-from-event.mdx` | `/events` | Event drawer open | Drawer showing "Plan Catalog from Event" button, theme notes, and styling props | 1200x900 | `images/events/event-detail-drawer.webp` |

---

## 4. Dashboard, History, Notifications & Administration Screenshots

| Screenshot ID | Documentation Page | Route / Page | Exact UI State | Exact UI Section | Recommended Dimensions | Target Filename |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DB-001** | `dashboard/overview.mdx` | `/dashboard` | Full dashboard with populated data | Top 3 metric cards (Generations, Provider Tokens, Generation Cost) | 1600x600 | `images/dashboard/dashboard-metrics-summary.webp` |
| **DB-002** | `dashboard/analytics-14-day.mdx` | `/dashboard` | 14-day chart section | 14-day Generation Volume and Daily USD Cost interactive bar charts | 1600x800 | `images/dashboard/14-day-analytics-charts.webp` |
| **DB-003** | `dashboard/active-jobs-live-progress.mdx` | `/dashboard` | Active job generating | "Generating now" card with SKU ID and live delivery progress bar | 800x500 | `images/dashboard/generating-now-card.webp` |
| **HI-001** | `history/view-past-generations.mdx` | `/history` | History table with jobs | History table listing Job ID, SKU Name, Total Poses, Created At, and Status | 1800x900 | `images/history/history-table-view.webp` |
| **HI-002** | `history/inspect-generation-flow.mdx` | `/history/flow/:id` | Generation DAG flow view | Interactive node graph showing Reference Nodes -> Analysis Node -> 5 Pose Nodes | 1920x1080 | `images/history/generation-flow-dag.webp` |
| **NT-001** | `notifications/overview.mdx` | `/notifications` | Notifications list with unread items | Notification cards with timestamp, category icon (success/warning/info), and mark read button | 1200x800 | `images/notifications/notifications-center.webp` |
| **AD-001** | `admin/users.mdx` | `/admin` (Users Tab) | User management table | Member list with role badges, status toggle, and "Invite Member" modal | 1600x900 | `images/admin/admin-users-table.webp` |
| **AD-002** | `admin/teams.mdx` | `/admin` (Teams Tab) | Teams management view | Team cards (Planning, Generation, Review, Listing) with assigned leads | 1600x900 | `images/admin/admin-teams-view.webp` |
| **AD-003** | `admin/roles-permissions.mdx` | `/admin` (Roles Tab) | Role editor open | Granular permission matrix grouped by module (Studio, Planning, Reports, Admin) | 1400x1000 | `images/admin/admin-roles-permissions.webp` |
| **AD-004** | `admin/ai-routing-models.mdx` | `/admin` (AI Tab) | AI Model Policies configuration | 3-card policy editor: Product Truth, Image QA, Image Generation with provider/thinking dropdowns | 1600x900 | `images/admin/admin-ai-routing.webp` |
| **AD-005** | `admin/costs-budgets.mdx` | `/admin` (Costs Tab) | Cost monitoring & budget limits | Daily USD budget limit configuration and OpenAI token cost sync status | 1400x800 | `images/admin/admin-costs-budgets.webp` |
