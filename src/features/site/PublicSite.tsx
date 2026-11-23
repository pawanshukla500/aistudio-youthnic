import { useEffect } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useParams } from "react-router-dom";
import { LEGAL_PAGES, POSTS, formatDate, type SitePage } from "./content";
import { inlineTokens, type Block } from "./markdown";
import { BLOG_DESCRIPTION, BLOG_TITLE, metaFor } from "./pageMeta";
import { SiteFooter, SiteHeader } from "./SiteChrome";
import { absoluteUrl } from "./siteConfig";

const SHELL = "mx-auto max-w-[1560px] px-5 sm:px-8 lg:px-10 xl:px-14";
const LINK = "font-semibold text-primary underline underline-offset-4 hover:text-primary-container";

/** Keeps the tab title, description and canonical address right when moving between pages. */
function usePageMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = metaFor(pathname);
    document.title = meta ? meta.title : "Page not found | Youthnic AI Studio";
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute("content", meta ? meta.description : "");
    document
      .querySelector('link[rel="canonical"]')
      ?.setAttribute("href", absoluteUrl(meta ? meta.path : pathname));
    window.scrollTo(0, 0);
  }, [pathname]);
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((token, i) =>
        token.type === "bold" ? (
          <strong key={i} className="font-bold text-on-surface">
            {token.text}
          </strong>
        ) : token.type === "link" ? (
          token.href.startsWith("/blog") ? (
            <Link key={i} to={token.href} className={LINK}>
              {token.text}
            </Link>
          ) : (
            // The landing page and the app are a separate entry point: a normal page load
            <a
              key={i}
              href={token.href}
              className={LINK}
              {...(token.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
            >
              {token.text}
            </a>
          )
        ) : (
          token.text
        ),
      )}
    </>
  );
}

function Article({ blocks }: { blocks: Block[] }) {
  return (
    <div className="text-base leading-[1.75] text-on-surface-variant sm:text-[17px]">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            return block.level === 2 ? (
              <h2
                key={i}
                id={block.id}
                className="mt-12 scroll-mt-24 font-syne text-2xl font-bold leading-snug text-on-surface sm:text-3xl"
              >
                {block.text}
              </h2>
            ) : (
              <h3
                key={i}
                id={block.id}
                className="mt-8 scroll-mt-24 font-syne text-xl font-bold text-on-surface"
              >
                {block.text}
              </h3>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={i}
                className={`mt-5 space-y-2 pl-6 ${block.ordered ? "list-decimal" : "list-disc"}`}
              >
                {block.items.map((item) => (
                  <li key={item}>
                    <Inline text={item} />
                  </li>
                ))}
              </List>
            );
          }
          case "image":
            return (
              <figure key={i} className="mt-8">
                <img
                  src={block.src}
                  alt={block.alt}
                  loading="lazy"
                  decoding="async"
                  className="w-full max-w-sm rounded-lg border border-outline-variant/50"
                />
                <figcaption className="mt-2 max-w-sm text-sm text-secondary">{block.alt}</figcaption>
              </figure>
            );
          case "quote":
            return (
              <blockquote
                key={i}
                className="mt-6 border-l-2 border-primary pl-5 text-lg text-on-surface"
              >
                <Inline text={block.text} />
              </blockquote>
            );
          default:
            return (
              <p key={i} className="mt-5">
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}

function PostMeta({ post }: { post: SitePage }) {
  return (
    <p className="text-sm text-secondary">
      <time dateTime={post.date}>{formatDate(post.date)}</time>, {post.minutes} min read
    </p>
  );
}

function BlogIndex() {
  const [lead, ...rest] = POSTS;
  return (
    <div className={`${SHELL} py-14 lg:py-20`}>
      <h1 className="max-w-3xl font-syne text-4xl font-bold leading-[1.02] tracking-tighter text-on-surface sm:text-5xl lg:text-6xl">
        {BLOG_TITLE}
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-secondary sm:text-lg">
        {BLOG_DESCRIPTION}
      </p>

      <Link
        to={`/blog/${lead.slug}`}
        className="group mt-12 grid gap-8 border-y border-outline-variant/60 py-10 md:grid-cols-[0.42fr_1fr] md:items-center"
      >
        {lead.image && (
          <img
            src={lead.image}
            alt={lead.imageAlt || ""}
            className="aspect-[4/5] w-full max-w-sm rounded-lg object-cover"
          />
        )}
        <div>
          <PostMeta post={lead} />
          <h2 className="mt-3 font-syne text-3xl font-bold leading-tight tracking-tight text-on-surface underline-offset-4 group-hover:underline sm:text-4xl">
            {lead.title}
          </h2>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-secondary">
            {lead.description}
          </p>
        </div>
      </Link>

      <ul className="divide-y divide-outline-variant/60 border-b border-outline-variant/60">
        {rest.map((post) => (
          <li key={post.slug}>
            <Link
              to={`/blog/${post.slug}`}
              className="group grid gap-2 py-7 md:grid-cols-[0.42fr_1fr] md:gap-8"
            >
              <PostMeta post={post} />
              <div>
                <h2 className="font-syne text-2xl font-bold leading-snug text-on-surface underline-offset-4 group-hover:underline">
                  {post.title}
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-secondary">
                  {post.description}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BlogPost() {
  const { slug } = useParams();
  const post = POSTS.find((item) => item.slug === slug);
  if (!post) return <NotFound />;
  const others = POSTS.filter((item) => item.slug !== post.slug).slice(0, 3);
  return (
    <div className={`${SHELL} py-12 lg:py-16`}>
      <article className="mx-auto max-w-[44rem]">
        <p className="text-sm">
          <Link to="/blog" className={LINK}>
            Blog
          </Link>
        </p>
        <h1 className="mt-4 font-syne text-4xl font-bold leading-[1.05] tracking-tighter text-on-surface sm:text-5xl">
          {post.title}
        </h1>
        <div className="mt-5">
          <PostMeta post={post} />
        </div>
        <Article blocks={post.blocks} />

        <div className="mt-14 rounded-2xl bg-soft-blush p-7 sm:p-9">
          <h2 className="font-syne text-2xl font-bold text-on-surface">
            See it on your own product
          </h2>
          <p className="mt-2 max-w-md text-base text-secondary">
            Upload a front and a back photo and get six catalog frames to compare with the
            garment in your hand.
          </p>
          <a
            href="/"
            className="mt-6 inline-block rounded-full bg-primary px-6 py-3 text-sm font-bold text-on-primary transition-colors hover:bg-primary-container"
          >
            Start free studio
          </a>
        </div>
      </article>

      <nav aria-label="More guides" className="mx-auto mt-16 max-w-[44rem]">
        <h2 className="font-syne text-xl font-bold text-on-surface">More guides</h2>
        <ul className="mt-4 divide-y divide-outline-variant/60 border-y border-outline-variant/60">
          {others.map((item) => (
            <li key={item.slug}>
              <Link
                to={`/blog/${item.slug}`}
                className="block py-4 text-base font-semibold text-on-surface underline-offset-4 hover:underline"
              >
                {item.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function LegalPage() {
  const { legal } = useParams();
  const page = LEGAL_PAGES.find((item) => item.slug === legal);
  if (!page) return <NotFound />;
  return (
    <div className={`${SHELL} py-12 lg:py-16`}>
      <article className="mx-auto max-w-[44rem]">
        <h1 className="font-syne text-4xl font-bold leading-[1.05] tracking-tighter text-on-surface sm:text-5xl">
          {page.title}
        </h1>
        <p className="mt-5 text-sm text-secondary">
          Last updated <time dateTime={page.date}>{formatDate(page.date)}</time>
        </p>
        <Article blocks={page.blocks} />
      </article>
    </div>
  );
}

function NotFound() {
  return (
    <div className={`${SHELL} py-24`}>
      <h1 className="font-syne text-4xl font-bold tracking-tighter text-on-surface">
        This page does not exist.
      </h1>
      <p className="mt-4 text-base text-secondary">
        Go to the{" "}
        <Link to="/blog" className={LINK}>
          blog
        </Link>{" "}
        or the{" "}
        <a href="/" className={LINK}>
          home page
        </a>
        .
      </p>
    </div>
  );
}

/** The blog and legal pages. Rendered in the browser and, at build time, to static HTML. */
export function PublicRoutes() {
  usePageMeta();
  return (
    <div className="min-h-screen bg-background text-on-background">
      <SiteHeader />
      <main>
        <Routes>
          <Route path="/blog" element={<BlogIndex />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/:legal" element={<LegalPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <SiteFooter />
    </div>
  );
}

export default function PublicSite() {
  return (
    <BrowserRouter>
      <PublicRoutes />
    </BrowserRouter>
  );
}
