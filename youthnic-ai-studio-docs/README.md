# Youthnic AI Studio Documentation

Welcome to the official documentation repository for **Youthnic AI Studio**, the enterprise AI fashion catalog production platform.

This documentation portal is built using [Mintlify](https://mintlify.com) and MDX.

---

## Local Development

Follow these steps to preview and edit the documentation locally:

### 1. Prerequisites
- [Node.js](https://nodejs.org) (v18 or higher)
- npm, yarn, or pnpm

### 2. Install Mintlify CLI
Install the Mintlify CLI globally:
```bash
npm install -g mintlify
```

### 3. Run the Development Server
From within this `youthnic-ai-studio-docs` directory:
```bash
mintlify dev
```
The documentation portal will start locally at:
`http://localhost:3000`

Mintlify supports instant hot reloading: any edit made to an `.mdx` file or `mint.json` will immediately reflect in your browser.

---

## Deployment & Hosting

### Deploying with Mintlify Cloud
1. Create a repository on GitHub (e.g. `youthnic-ai-studio-docs` or push this folder).
2. Go to [dashboard.mintlify.com](https://dashboard.mintlify.com).
3. Connect your GitHub repository.
4. Mintlify will automatically build and deploy every push to the default branch.

### Custom Domain Configuration (`docs.youthnic.com`)
1. In your Mintlify project settings, navigate to **Custom Domain**.
2. Add `docs.youthnic.com`.
3. In your DNS provider (Cloudflare, GoDaddy, AWS Route 53, etc.), configure a CNAME record:
   - **Type**: `CNAME`
   - **Host/Name**: `docs`
   - **Value**: `cname.mintlify.com`
4. Mintlify will provision and manage SSL certificates automatically.

---

## Project Structure

```text
youthnic-ai-studio-docs/
├── mint.json                      # Mintlify global configuration & navigation tree
├── README.md                      # Local setup & deployment instructions
├── PRODUCT_FEATURE_AUDIT.md       # Full application capability audit
├── DOCUMENTATION_STATUS.md        # Page writing & code-verification checklist
├── SCREENSHOT_CHECKLIST.md        # Exact specifications for required UI screenshots
├── VIDEO_CHECKLIST.md             # Specifications for walkthrough & tutorial videos
├── images/                        # Static diagrams, logos, and UI asset directories
├── introduction/                  # Overview, audience, capabilities & product tour
├── getting-started/               # Onboarding, login, interface tour & first photoshoot
├── studio/                        # Single-SKU studio workflow & 5-pose standard
├── catalog-production/            # Multi-SKU & colourway batch production
├── events/                        # Marketing & festival calendar roadmaps
├── planning/                      # Batches, campaigns, capacity & scheduling
├── dashboard/                     # Telemetry, tokens, cost tracking & analytics
├── history/                       # Audit trail, workflow graphs, and retries
├── notifications/                 # Alert center & automated messaging
├── admin/                         # User access, teams, RBAC, AI routing, and budgets
├── troubleshooting/               # Real failure resolution guides
├── faq/                           # Frequently asked operational questions
├── changelog/                     # Release notes & version changelogs
└── developer/                     # Developer reference & API architecture
```
