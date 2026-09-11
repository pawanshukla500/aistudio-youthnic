# Youthnic AI Studio Documentation — Video Checklist

Detailed production specifications for all UI walkthroughs, micro-demonstrations, and end-to-end tutorial videos across the documentation portal.

---

## 1. Micro-Demonstration Recordings (15–30 Seconds)

| Video ID | Documentation Page | Purpose | Start State | Actions Recorded | End State | Duration | Suggested Filename | Narration |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **VID-001** | `getting-started/understanding-the-interface.mdx` | Navigation & Organization Switching | Dashboard view | Click organization switcher in top bar, switch workspace, navigate to Studio, then to Planning | Planning board view | 15s | `videos/getting-started/navigation-tour.mp4` | No |
| **VID-002** | `studio/upload-product-images.mdx` | Multi-image drag and drop & role assignment | Clean Studio upload zone | Drag 4 images into dropzone; assign Front, Back, Bottom, and Style roles using dropdowns | All 4 thumbnails active with green role chips | 20s | `videos/studio/upload-and-assign-roles.mp4` | No |
| **VID-003** | `studio/ai-product-analysis.mdx` | Trigger AI analysis and inspect profile | References uploaded, SKU entered | Click "Analyze Product"; wait for spinner; expand Product Identity and Creative Direction accordions | Analysis profile fully displayed | 25s | `videos/studio/run-ai-analysis.mp4` | No |
| **VID-004** | `studio/regenerate-retry.mdx` | Regenerate a single pose with correction | 5 poses completed with Pose 4 flagged | Click Regenerate on Pose 4; enter user correction ("more visible hemline"); submit | Pose 4 re-queueing and updating to completed | 20s | `videos/studio/regenerate-pose.mp4` | No |
| **VID-005** | `catalog-production/create-catalog.mdx` | Create batch & add 3 colorways | Catalog Production tab | Click "Create Collection"; enter name; add 3 colourway rows; set priority to High | New batch appears in Planning board | 30s | `videos/catalogs/create-collection-batch.mp4` | No |
| **VID-006** | `catalog-production/production-tracking.mdx` | Kanban drag & team assignment | Production Board | Drag SKU card from "Requested" to "Generation"; assign generation lead from member dropdown | Card updated with member avatar | 20s | `videos/catalogs/kanban-stage-move.mp4` | No |
| **VID-007** | `events/calendar-views.mdx` | Switch Timeline, Grid, and Table views | Events Timeline view | Toggle view switcher: Timeline -> Grid -> Table; filter by "Festival" | Filtered Table view | 18s | `videos/events/view-switching-filters.mp4` | No |
| **VID-008** | `events/ai-event-research.mdx` | Trigger AI Event Research | Events page | Click "AI Research Events"; confirm modal; watch research progress toast; verified badges populate | Refreshed calendar with verified events | 25s | `videos/events/run-ai-research.mp4` | No |
| **VID-009** | `history/inspect-generation-flow.mdx` | Interactive DAG flow graph inspection | Generation Flow page | Hover over Reference nodes; click Pose 3 node; view node detail drawer showing prompt and token count | Drawer open with token breakdown | 22s | `videos/history/dag-flow-interaction.mp4` | No |
| **VID-010** | `admin/ai-routing-models.mdx` | Configure AI Model failover policy | Admin AI tab | Change Product Truth provider from Google Gemini to OpenAI; set fallback to Gemini Flash; save | Success confirmation banner | 20s | `videos/admin/configure-ai-routing.mp4` | No |

---

## 2. End-to-End Tutorial Videos (2–4 Minutes)

| Tutorial ID | Documentation Page | Tutorial Title | Comprehensive Workflow Covered | Target Duration | Suggested Filename | Narration Required |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TUT-001** | `getting-started/first-generation-walkthrough.mdx` | Complete Studio Photoshoot Tutorial | Sign in -> Open Studio -> Upload 5 product references -> Set SKU & category -> Run AI Analysis -> Review Product Identity & Styling Plan -> Review 5-Pose Plan -> Start Generation -> Live Progress -> Quality Validation -> Download ZIP | 3m 30s | `videos/getting-started/studio-end-to-end-tutorial.mp4` | Yes (or Subtitles) |
| **TUT-002** | `catalog-production/generate-catalog.mdx` | Multi-Colourway Catalog Production | Create Catalog Collection -> Add 5 SKU colourways -> Upload shared styling & model anchor -> Run AI Preflight -> Styling Approval -> Trigger Sequential Generation -> Monitor Kanban Board -> QC Passed -> Export Listing Assets | 4m 00s | `videos/catalogs/catalog-production-tutorial.mp4` | Yes (or Subtitles) |
| **TUT-003** | `events/plan-catalog-from-event.mdx` | Event-Driven Campaign Planning | Browse Festive Roadmap (Diwali / Navratri) -> Inspect AI Research brief & mood palette -> Click "Plan Catalog from Event" -> Link to Planning batch -> Schedule production milestones | 2m 45s | `videos/events/event-driven-campaign-tutorial.mp4` | Yes (or Subtitles) |
| **TUT-004** | `admin/overview.mdx` | Enterprise Administration & Governance | Member invitation -> Team setup -> RBAC Role creation -> AI Model Routing configuration -> Daily Budget Limits -> System Health audit | 3m 15s | `videos/admin/enterprise-administration-tutorial.mp4` | Yes (or Subtitles) |
