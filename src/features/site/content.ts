import { parseDocument, plainText, type Block } from "./markdown";

export type SitePage = {
  slug: string;
  title: string;
  description: string;
  /** ISO date, yyyy-mm-dd. */
  date: string;
  image?: string;
  imageAlt?: string;
  blocks: Block[];
  minutes: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-23" as "23 Nov 2026", the same on the server and in every browser locale. */
export function formatDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function load(files: Record<string, string>): SitePage[] {
  return Object.entries(files).map(([path, source]) => {
    const { meta, blocks } = parseDocument(source);
    const words = plainText(blocks).split(/\s+/).filter(Boolean).length;
    return {
      slug: path.split("/").pop()!.replace(/\.md$/, ""),
      title: meta.title,
      description: meta.description,
      date: meta.date,
      image: meta.image,
      imageAlt: meta.imageAlt,
      blocks,
      minutes: Math.max(1, Math.round(words / 200)),
    };
  });
}

/** Blog posts from content/blog/*.md, newest first. Add a file there to publish a post. */
export const POSTS = load(
  import.meta.glob("../../../content/blog/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
).sort((a, b) => b.date.localeCompare(a.date));

/** Legal pages from content/legal/*.md; the file name is the address (privacy.md is /privacy). */
export const LEGAL_PAGES = load(
  import.meta.glob("../../../content/legal/*.md", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>,
);
