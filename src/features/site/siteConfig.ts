// One place for the public site's address, name and contact links, used by the pages,
// the SEO tags and the sitemap. Set VITE_SITE_URL at build time to change the address.

export const SITE_URL = (
  (import.meta.env.VITE_SITE_URL as string | undefined) || "https://aistudio.youthnic.com"
).replace(/\/+$/, "");

export const SITE_NAME = "Youthnic AI Studio";
export const SITE_TAGLINE = "AI catalog photoshoots for fashion e-commerce";
export const SITE_DESCRIPTION =
  "Upload the front and back of a garment and get a six-frame AI catalog photoshoot: one model, one set, and images that keep the cut, print and colour of your product.";

export const CONTACT_EMAIL = "pawan@youthnic.shop";
export const COMPANY_LOCATION = "Surat, Gujarat, India";

export const SOCIAL_LINKS = [
  ["LinkedIn", "https://www.linkedin.com/company/youthnic"],
  ["Instagram", "https://www.instagram.com/youthnic.in"],
] as const;

export const absoluteUrl = (path: string) => `${SITE_URL}${path === "/" ? "/" : path}`;
