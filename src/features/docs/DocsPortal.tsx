import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Search,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Menu,
  X,
  Sparkles,
  PlayCircle,
  Camera,
  Layers,
  Calendar,
  Compass,
  BarChart3,
  Clock,
  Bell,
  Shield,
  AlertTriangle,
  HelpCircle,
  GitCommit,
  Code,
  ArrowLeft,
  ArrowRight,
  LogIn,
  LayoutDashboard,
} from "lucide-react";
import { DOCS_GROUPS, DOCS_PAGES, DOCS_SLUGS, type DocPage } from "./docsData";
import { DocsContent } from "./DocsContent";
import { DocsSearchModal } from "./DocsSearchModal";
import type { User } from "firebase/auth";

interface DocsPortalProps {
  user?: User | null;
}

// Group icon helper
function getGroupIcon(groupName: string) {
  const map: Record<string, React.ReactNode> = {
    Introduction: <Sparkles className="h-4 w-4" />,
    "Getting Started": <PlayCircle className="h-4 w-4" />,
    Studio: <Camera className="h-4 w-4" />,
    "Catalog Production": <Layers className="h-4 w-4" />,
    "Events & Marketing Calendar": <Calendar className="h-4 w-4" />,
    Planning: <Compass className="h-4 w-4" />,
    Dashboard: <BarChart3 className="h-4 w-4" />,
    "Generation History": <Clock className="h-4 w-4" />,
    Notifications: <Bell className="h-4 w-4" />,
    Administration: <Shield className="h-4 w-4" />,
    Troubleshooting: <AlertTriangle className="h-4 w-4" />,
    FAQ: <HelpCircle className="h-4 w-4" />,
    "Release Notes": <GitCommit className="h-4 w-4" />,
    "Developer Reference": <Code className="h-4 w-4" />,
  };
  return map[groupName] || <BookOpen className="h-4 w-4" />;
}

export function DocsPortal({ user }: DocsPortalProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Derive current slug from pathname: /docs or /docs/group/page
  const pathWithoutDocs = location.pathname.replace(/^\/docs\/?/, "");
  const currentSlug = pathWithoutDocs ? pathWithoutDocs : "introduction/what-is-youthnic-ai-studio";

  const currentPage: DocPage = DOCS_PAGES[currentSlug] || DOCS_PAGES["introduction/what-is-youthnic-ai-studio"];

  // Collapsible groups state (active group open by default)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of DOCS_GROUPS) {
      initial[g.group] = g.group === currentPage.group || true; // keep all open or active open
    }
    return initial;
  });

  const toggleGroup = (group: string) => {
    setOpenGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  // Keyboard shortcut Ctrl+K / Cmd+K / Slash
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Calculate previous and next pages for pagination
  const currentIndex = DOCS_SLUGS.indexOf(currentPage.slug);
  const prevSlug = currentIndex > 0 ? DOCS_SLUGS[currentIndex - 1] : null;
  const nextSlug = currentIndex < DOCS_SLUGS.length - 1 ? DOCS_SLUGS[currentIndex + 1] : null;
  const prevPage = prevSlug ? DOCS_PAGES[prevSlug] : null;
  const nextPage = nextSlug ? DOCS_PAGES[nextSlug] : null;

  const navigateToSlug = (slug: string) => {
    navigate(`/docs/${slug}`);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-[#faf8ff] text-[#131b2e] antialiased">
      {/* Search Modal */}
      <DocsSearchModal
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={navigateToSlug}
      />

      {/* Top Header */}
      <header className="sticky top-0 z-40 border-b border-outline-variant/40 bg-[#faf8ff]/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Logo & Branding */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-lg p-2 text-secondary hover:bg-surface-container lg:hidden"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            <div
              onClick={() => navigateToSlug("introduction/what-is-youthnic-ai-studio")}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <img
                src="/images/logo-light.png"
                alt="Youthnic AI Studio"
                className="h-8 w-auto object-contain transition group-hover:scale-105"
                onError={(e) => {
                  // Fallback if image fails to load
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
              <div className="border-l border-outline-variant/60 pl-3">
                <span className="font-syne text-base font-bold tracking-tight text-on-surface">
                  Docs
                </span>
                <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  v2.4 Enterprise
                </span>
              </div>
            </div>
          </div>

          {/* Search Trigger Button */}
          <div className="hidden sm:block flex-1 max-w-md mx-6">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex w-full items-center justify-between rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3.5 py-2 text-xs text-secondary shadow-sm transition hover:border-primary/50 hover:bg-surface-container-low"
            >
              <span className="flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                <span>Search 97 guides, workflows, APIs...</span>
              </span>
              <kbd className="rounded border border-outline-variant/50 bg-surface-container px-1.5 py-0.5 text-[10px] font-mono text-secondary">
                Ctrl K
              </kbd>
            </button>
          </div>

          {/* Action Button: Authenticated vs Unauthenticated */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSearchOpen(true)}
              className="rounded-lg p-2 text-secondary hover:bg-surface-container sm:hidden"
              aria-label="Open search"
            >
              <Search className="h-5 w-5" />
            </button>

            {user ? (
              <button
                onClick={() => navigate("/dashboard")}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#7b003a]"
              >
                <LayoutDashboard className="h-4 w-4" />
                <span>Back to Studio</span>
              </button>
            ) : (
              <button
                onClick={() => navigate("/")}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-[#7b003a]"
              >
                <LogIn className="h-4 w-4" />
                <span>Sign In to AI Studio</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex gap-8">
          {/* Left Navigation Sidebar */}
          <aside
            className={`fixed inset-y-0 left-0 z-30 w-72 transform border-r border-outline-variant/40 bg-[#faf8ff] p-6 pt-20 transition-transform duration-200 ease-in-out lg:static lg:block lg:w-64 lg:p-0 lg:pt-8 lg:translate-x-0 shrink-0 ${
              mobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:translate-x-0"
            }`}
          >
            <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-3 space-y-4">
              {DOCS_GROUPS.map((group) => {
                const isOpen = openGroups[group.group] !== false;
                const isCurrentGroup = group.group === currentPage.group;

                return (
                  <div key={group.group} className="space-y-1">
                    <button
                      onClick={() => toggleGroup(group.group)}
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                        isCurrentGroup ? "text-primary" : "text-secondary hover:text-on-surface"
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        {getGroupIcon(group.group)}
                        <span className="truncate">{group.group}</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-[10px] text-secondary/60">
                        <span>{group.pages.length}</span>
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="ml-3.5 space-y-0.5 border-l border-outline-variant/50 pl-3">
                        {group.pages.map((page) => {
                          const isActive = page.slug === currentPage.slug;
                          return (
                            <button
                              key={page.slug}
                              onClick={() => navigateToSlug(page.slug)}
                              className={`block w-full text-left rounded-lg px-2.5 py-1.5 text-[13px] transition ${
                                isActive
                                  ? "bg-primary/10 font-bold text-primary"
                                  : "font-medium text-secondary hover:bg-surface-container hover:text-on-surface"
                              }`}
                            >
                              <span className="truncate block">{page.title}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Center Main Content */}
          <main className="min-w-0 flex-1 py-8">
            <DocsContent
              content={currentPage.content}
              title={currentPage.title}
              description={currentPage.description}
              group={currentPage.group}
            />

            {/* Pagination footer */}
            <div className="mx-auto max-w-4xl border-t border-outline-variant/40 pt-8 mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {prevPage ? (
                <button
                  onClick={() => navigateToSlug(prevPage.slug)}
                  className="flex flex-col items-start rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4 transition hover:border-primary/50 hover:bg-surface-container-low"
                >
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-secondary">
                    <ArrowLeft className="h-3.5 w-3.5" /> Previous
                  </span>
                  <span className="mt-1 font-syne text-sm font-bold text-on-surface truncate max-w-full">
                    {prevPage.title}
                  </span>
                </button>
              ) : (
                <div />
              )}

              {nextPage && (
                <button
                  onClick={() => navigateToSlug(nextPage.slug)}
                  className="flex flex-col items-end rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4 transition hover:border-primary/50 hover:bg-surface-container-low"
                >
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-secondary">
                    Next <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                  <span className="mt-1 font-syne text-sm font-bold text-on-surface truncate max-w-full">
                    {nextPage.title}
                  </span>
                </button>
              )}
            </div>
          </main>

          {/* Right Rail: Table of Contents & Quick Support */}
          <aside className="hidden xl:block w-64 pt-8 shrink-0">
            <div className="sticky top-24 space-y-6">
              {currentPage.headings && currentPage.headings.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-secondary mb-3">
                    On this page
                  </p>
                  <nav className="space-y-1 text-xs border-l border-outline-variant/40 pl-3">
                    {currentPage.headings.map((heading) => (
                      <a
                        key={heading.id}
                        href={`#${heading.id}`}
                        className={`block text-secondary hover:text-primary transition line-clamp-1 ${
                          heading.level === 3 ? "pl-3 text-[11px]" : "font-medium"
                        }`}
                      >
                        {heading.text}
                      </a>
                    ))}
                  </nav>
                </div>
              )}

              <div className="rounded-xl border border-outline-variant/50 bg-surface-container-low p-4 text-xs space-y-2.5">
                <p className="font-bold text-on-surface">Need assistance?</p>
                <p className="text-secondary leading-relaxed">
                  Our catalog engineering team is available for onboarding and support.
                </p>
                <a
                  href="mailto:returnorders@vbexports.co.in"
                  className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline"
                >
                  <span>Contact Support</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
