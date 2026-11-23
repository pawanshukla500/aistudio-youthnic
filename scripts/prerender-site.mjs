// Runs after `vite build`. Writes every public page (blog, posts, legal) to its own HTML file
// with its own title, description and structured data and the page text already in it, plus
// sitemap.xml and robots.txt. Usage: node scripts/prerender-site.mjs [distDir]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.resolve(root, process.argv[2] || "dist");
const SEO_BLOCK = /<!--seo-->[\s\S]*?<!--\/seo-->/;
const EMPTY_ROOT = '<div id="root"></div>';

const template = fs.readFileSync(path.join(dist, "index.html"), "utf8");
if (!SEO_BLOCK.test(template) || !template.includes(EMPTY_ROOT)) {
  throw new Error("index.html must keep the <!--seo--> block and an empty #root for prerendering.");
}

// App routes behind the login; nothing there is for search engines.
const PRIVATE_PATHS = ["/dashboard", "/studio", "/planning", "/events", "/history", "/notifications", "/admin"];

const vite = await createServer({
  root,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, ws: false },
});

try {
  const site = await vite.ssrLoadModule("/src/features/site/prerender.tsx");
  const withHead = (head) => template.replace(SEO_BLOCK, `<!--seo-->\n    ${head}\n    <!--/seo-->`);

  // The home page keeps an empty root (the app renders it); only its tags are refreshed.
  fs.writeFileSync(path.join(dist, "index.html"), withHead(site.homeHead));

  const pages = site.renderPublicPages();
  for (const page of pages) {
    const file = path.join(dist, page.meta.path, "index.html");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, withHead(page.head).replace(EMPTY_ROOT, `<div id="root">${page.html}</div>`));
  }

  const today = new Date().toISOString().slice(0, 10);
  const urls = site.sitemapPaths.map((item) => {
    const page = pages.find((candidate) => candidate.meta.path === item);
    const address = `${site.siteUrl}${item === "/" ? "/" : item}`;
    return `  <url><loc>${address}</loc><lastmod>${page?.meta.date || today}</lastmod></url>`;
  });
  fs.writeFileSync(
    path.join(dist, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
  );
  fs.writeFileSync(
    path.join(dist, "robots.txt"),
    `User-agent: *\nAllow: /\n${PRIVATE_PATHS.map((item) => `Disallow: ${item}`).join("\n")}\n\nSitemap: ${site.siteUrl}/sitemap.xml\n`,
  );

  console.log(`✓ Prerendered ${pages.length} public pages, sitemap.xml and robots.txt for ${site.siteUrl}`);
} finally {
  await vite.close();
}
