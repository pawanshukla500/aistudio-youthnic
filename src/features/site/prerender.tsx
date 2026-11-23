// Build-time only: scripts/prerender-site.mjs loads this module through Vite and writes each
// public page to its own HTML file, so search engines get the full text without running scripts.

import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { PublicRoutes } from "./PublicSite";
import { HOME_META, PUBLIC_PATHS, jsonLdFor, metaFor, type PageMeta } from "./pageMeta";
import { SITE_NAME, SITE_URL, absoluteUrl } from "./siteConfig";

export type PrerenderedPage = { meta: PageMeta; head: string; html: string };

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The title, description, canonical, social and structured-data tags of one page. */
export function headFor(meta: PageMeta): string {
  const url = absoluteUrl(meta.path);
  const image = absoluteUrl(meta.image);
  return [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    // "<" is escaped so page text can never close the script tag
    `<script type="application/ld+json">${JSON.stringify(jsonLdFor(meta)).replace(/</g, "\\u003c")}</script>`,
  ].join("\n    ");
}

export const siteUrl = SITE_URL;
export const homeHead = headFor(HOME_META);

/** Addresses for the sitemap: the home page, the public pages and the documentation. */
export const sitemapPaths = ["/", ...PUBLIC_PATHS, "/docs"];

export function renderPublicPages(): PrerenderedPage[] {
  return PUBLIC_PATHS.map((path) => {
    const meta = metaFor(path)!;
    return {
      meta,
      head: headFor(meta),
      html: renderToStaticMarkup(
        <StaticRouter location={path}>
          <PublicRoutes />
        </StaticRouter>,
      ),
    };
  });
}
