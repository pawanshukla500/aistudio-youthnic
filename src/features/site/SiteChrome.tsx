import { LEGAL_PAGES } from "./content";
import { COMPANY_LOCATION, CONTACT_EMAIL, SITE_NAME, SOCIAL_LINKS } from "./siteConfig";

// Plain links on purpose: the landing page, the blog and the app are separate entry points,
// so moving between them is a normal page load.

const QUICK_LINKS = [
  ["How a shoot runs", "/#workflow"],
  ["Pricing", "/#pricing"],
  ["Blog", "/blog"],
  ["Contact", "/#contact"],
  ["Documentation", "/docs"],
];

const FOOTER_LINK =
  "text-inverse-on-surface/75 underline-offset-4 transition-colors hover:text-white hover:underline";

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <ul className="mt-4 space-y-2.5 text-sm">{children}</ul>
    </nav>
  );
}

/** The site-wide footer: who we are, quick links, legal pages and social accounts. */
export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-on-surface px-5 py-14 sm:px-8 lg:px-10 xl:px-14">
      <div className="mx-auto grid max-w-[1560px] gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="text-sm text-inverse-on-surface/75">
          <p className="font-syne text-lg font-bold text-white">{SITE_NAME}</p>
          <p className="mt-3 max-w-xs leading-relaxed">
            Six-frame catalog photoshoots from your product photos.
          </p>
          <p className="mt-4">{COMPANY_LOCATION}</p>
          <a href={`mailto:${CONTACT_EMAIL}`} className={`mt-1 inline-block ${FOOTER_LINK}`}>
            {CONTACT_EMAIL}
          </a>
        </div>
        <FooterColumn title="Quick links">
          {QUICK_LINKS.map(([label, href]) => (
            <li key={href}>
              <a href={href} className={FOOTER_LINK}>
                {label}
              </a>
            </li>
          ))}
        </FooterColumn>
        <FooterColumn title="Legal">
          {LEGAL_PAGES.map((page) => (
            <li key={page.slug}>
              <a href={`/${page.slug}`} className={FOOTER_LINK}>
                {page.title}
              </a>
            </li>
          ))}
        </FooterColumn>
        <FooterColumn title="Socials">
          {SOCIAL_LINKS.map(([label, href]) => (
            <li key={href}>
              <a href={href} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>
                {label}
              </a>
            </li>
          ))}
        </FooterColumn>
      </div>
    </footer>
  );
}

/** The top bar of the blog and legal pages. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-outline-variant/40 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1560px] items-center justify-between gap-4 px-5 sm:px-8 lg:px-10 xl:px-14">
        <a href="/" className="flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="h-9 w-9 object-contain" />
          <span className="whitespace-nowrap font-syne text-lg font-bold tracking-tight text-on-surface">
            Youthnic{" "}
            <span className="font-manrope text-sm font-semibold text-primary">AI Studio</span>
          </span>
        </a>
        <nav
          aria-label="Site"
          className="flex items-center gap-5 text-sm font-semibold text-secondary sm:gap-7"
        >
          <a href="/blog" className="transition-colors hover:text-on-surface">
            Blog
          </a>
          <a href="/#pricing" className="hidden transition-colors hover:text-on-surface sm:inline">
            Pricing
          </a>
          <a href="/docs" className="hidden transition-colors hover:text-on-surface sm:inline">
            Docs
          </a>
          <a
            href="/"
            className="whitespace-nowrap rounded-full bg-on-surface px-4 py-2 text-inverse-on-surface transition-colors hover:bg-primary"
          >
            Sign in
          </a>
        </nav>
      </div>
    </header>
  );
}
