import { LEGAL_PAGES, POSTS } from "./content";
import {
  CONTACT_EMAIL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
  SOCIAL_LINKS,
  absoluteUrl,
} from "./siteConfig";

export type PageMeta = {
  path: string;
  title: string;
  description: string;
  type: "website" | "article";
  image: string;
  date?: string;
};

const DEFAULT_IMAGE = "/og-image.jpg";

export const BLOG_TITLE = "Guides to AI catalog photoshoots";
export const BLOG_DESCRIPTION =
  "Practical guides to AI catalog photoshoots for fashion sellers: what to upload, the six frames a listing needs, sarees, and when to use a studio instead.";

export const HOME_META: PageMeta = {
  path: "/",
  title: `${SITE_TAGLINE} | ${SITE_NAME}`,
  description: SITE_DESCRIPTION,
  type: "website",
  image: DEFAULT_IMAGE,
};

/** Every public page that is written to its own HTML file, in sitemap order. */
export const PUBLIC_PATHS = [
  "/blog",
  ...POSTS.map((post) => `/blog/${post.slug}`),
  ...LEGAL_PAGES.map((page) => `/${page.slug}`),
];

export function metaFor(pathname: string): PageMeta | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return HOME_META;
  if (path === "/blog") {
    return {
      path,
      title: `${BLOG_TITLE} | ${SITE_NAME}`,
      description: BLOG_DESCRIPTION,
      type: "website",
      image: DEFAULT_IMAGE,
    };
  }
  const post = POSTS.find((item) => path === `/blog/${item.slug}`);
  if (post) {
    return {
      path,
      title: `${post.title} | ${SITE_NAME}`,
      description: post.description,
      type: "article",
      image: post.image || DEFAULT_IMAGE,
      date: post.date,
    };
  }
  const legal = LEGAL_PAGES.find((item) => path === `/${item.slug}`);
  if (legal) {
    return {
      path,
      title: `${legal.title} | ${SITE_NAME}`,
      description: legal.description,
      type: "website",
      image: DEFAULT_IMAGE,
      date: legal.date,
    };
  }
  return null;
}

const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: "Youthnic",
  url: SITE_URL,
  logo: absoluteUrl("/logo.png"),
  email: CONTACT_EMAIL,
  address: {
    "@type": "PostalAddress",
    addressLocality: "Surat",
    addressRegion: "Gujarat",
    addressCountry: "IN",
  },
  sameAs: SOCIAL_LINKS.map(([, href]) => href),
};

/** Structured data for a page: the organization everywhere, plus what the page itself is. */
export function jsonLdFor(meta: PageMeta): Record<string, unknown> {
  const graph: Array<Record<string, unknown>> = [ORGANIZATION];
  if (meta.path === "/") {
    graph.push(
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        publisher: { "@id": ORGANIZATION["@id"] },
      },
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: SITE_DESCRIPTION,
        url: SITE_URL,
        publisher: { "@id": ORGANIZATION["@id"] },
      },
    );
  } else if (meta.type === "article") {
    graph.push({
      "@type": "BlogPosting",
      headline: meta.title.replace(` | ${SITE_NAME}`, ""),
      description: meta.description,
      datePublished: meta.date,
      dateModified: meta.date,
      image: absoluteUrl(meta.image),
      mainEntityOfPage: absoluteUrl(meta.path),
      author: { "@id": ORGANIZATION["@id"] },
      publisher: { "@id": ORGANIZATION["@id"] },
    });
  } else if (meta.path === "/blog") {
    graph.push({
      "@type": "Blog",
      name: BLOG_TITLE,
      description: BLOG_DESCRIPTION,
      url: absoluteUrl("/blog"),
      publisher: { "@id": ORGANIZATION["@id"] },
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}
