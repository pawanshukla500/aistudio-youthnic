// A small markdown reader for the blog and legal pages: front matter, headings, paragraphs,
// lists, images and quotes, with bold and links inline. Pure, so the Deno suite can test it.

export type Block =
  | { type: "heading"; level: 2 | 3; text: string; id: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "image"; src: string; alt: string }
  | { type: "quote"; text: string };

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "link"; text: string; href: string };

export type ParsedDocument = { meta: Record<string, string>; blocks: Block[] };

const slugify = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function parseDocument(source: string): ParsedDocument {
  const text = source.replace(/\r\n/g, "\n");
  const meta: Record<string, string> = {};
  let body = text;
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (front) {
    body = text.slice(front[0].length);
    for (const line of front[1].split("\n")) {
      const colon = line.indexOf(":");
      if (colon > 0) meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }

  const blocks: Block[] = [];
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((line) => line.trimEnd()).filter(Boolean);
    if (!lines.length) continue;
    const first = lines[0];
    const heading = /^(#{2,3}) (.+)$/.exec(first);
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(first);
    if (heading && lines.length === 1) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 2 | 3,
        text: heading[2],
        id: slugify(heading[2]),
      });
    } else if (image && lines.length === 1) {
      blocks.push({ type: "image", alt: image[1], src: image[2] });
    } else if (lines.every((line) => /^- /.test(line))) {
      blocks.push({ type: "list", ordered: false, items: lines.map((line) => line.slice(2)) });
    } else if (lines.every((line) => /^\d+\. /.test(line))) {
      blocks.push({
        type: "list",
        ordered: true,
        items: lines.map((line) => line.replace(/^\d+\. /, "")),
      });
    } else if (first.startsWith(">")) {
      // A quote may wrap: only its first line has to start with ">"
      blocks.push({ type: "quote", text: lines.map((line) => line.replace(/^> ?/, "")).join(" ") });
    } else {
      blocks.push({ type: "paragraph", text: lines.join(" ") });
    }
  }
  return { meta, blocks };
}

/** Splits a line into plain text, **bold** and [link](href) pieces. */
export function inlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) tokens.push({ type: "text", text: text.slice(last, match.index) });
    if (match[1] !== undefined) tokens.push({ type: "bold", text: match[1] });
    else tokens.push({ type: "link", text: match[2], href: match[3] });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ type: "text", text: text.slice(last) });
  return tokens;
}

/** Plain text of a document, for word counts and descriptions. */
export function plainText(blocks: Block[]): string {
  return blocks
    .map((block) =>
      block.type === "list" ? block.items.join(" ") : block.type === "image" ? "" : block.text,
    )
    .join(" ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1");
}
