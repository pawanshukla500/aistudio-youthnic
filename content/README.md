# Public site content

Everything here is published on the public site at build time.

## Add a blog post

Create `content/blog/<address>.md`. The file name becomes the address: `my-post.md` is published at `/blog/my-post`.

```md
---
title: The title shown on the page and in search results
description: One or two sentences for search results and link previews.
date: 2026-11-23
image: /images/showcase/wine-kaftan-pose-1.webp
imageAlt: What the image shows
---

The first paragraph.

## A section heading

- A list item
- **Bold text** and a [link](/blog/another-post)

![What this image shows](/images/showcase/wine-kaftan-pose-1.webp)
```

- `title`, `description` and `date` are required. `image` and `imageAlt` are optional.
- Posts are listed newest first, by `date`.
- Supported: `##` and `###` headings, paragraphs, `-` and `1.` lists, images, `>` quotes, `**bold**` and `[links](...)`.
- Put images in `public/images/` and link them with a leading `/`.

`npm run build` writes each post as its own HTML page and adds it to `sitemap.xml`. Nothing else needs editing.

## Legal pages

`content/legal/privacy.md`, `terms.md` and `refund-policy.md` are published at `/privacy`, `/terms` and `/refund-policy` and linked from the footer. A new legal file also needs its address added to the public-page check in `src/main.tsx`.

## Site address

The address used in the sitemap and page tags is `https://aistudio.youthnic.com`. Set `VITE_SITE_URL` at build time to change it.
