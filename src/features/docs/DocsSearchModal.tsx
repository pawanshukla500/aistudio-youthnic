import React, { useState, useEffect, useRef } from "react";
import { Search, X, BookOpen, ChevronRight } from "lucide-react";
import { DOCS_PAGES, type DocPage } from "./docsData";

interface DocsSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (slug: string) => void;
}

// Precompute normalized search index at module load time for optimal search performance
interface SearchIndexEntry extends DocPage {
  lowerTitle: string;
  lowerGroup: string;
  lowerDesc: string;
  lowerContent: string;
}

const SEARCH_INDEX: SearchIndexEntry[] = Object.values(DOCS_PAGES).map((page) => ({
  ...page,
  lowerTitle: page.title.toLowerCase(),
  lowerGroup: page.group.toLowerCase(),
  lowerDesc: page.description.toLowerCase(),
  lowerContent: page.content.toLowerCase(),
}));

export function DocsSearchModal({ isOpen, onClose, onSelect }: DocsSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocPage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Debounced search over pre-indexed search entries
  useEffect(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      const matched = SEARCH_INDEX.filter((item) => {
        return (
          item.lowerTitle.includes(trimmed) ||
          item.lowerGroup.includes(trimmed) ||
          item.lowerDesc.includes(trimmed) ||
          item.lowerContent.includes(trimmed)
        );
      });

      // Prioritize title and group matches
      matched.sort((a, b) => {
        const aTitleMatch = a.lowerTitle.includes(trimmed) ? 2 : a.lowerGroup.includes(trimmed) ? 1 : 0;
        const bTitleMatch = b.lowerTitle.includes(trimmed) ? 2 : b.lowerGroup.includes(trimmed) ? 1 : 0;
        return bTitleMatch - aTitleMatch;
      });

      setResults(matched.slice(0, 15));
      setSelectedIndex(0);
    }, 120);

    return () => clearTimeout(timer);
  }, [query]);

  // Handle keyboard events
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      onSelect(results[selectedIndex].slug);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16 backdrop-blur-sm sm:pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center border-b border-outline-variant/50 px-4 py-3.5">
          <Search className="h-5 w-5 text-primary shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search documentation across 97 guides, workflows, APIs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="ml-3 flex-1 bg-transparent text-sm text-on-surface placeholder:text-secondary focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="mr-2 rounded p-1 text-secondary hover:text-on-surface"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="rounded border border-outline-variant/60 bg-surface-container px-2 py-0.5 text-[11px] font-mono text-secondary">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[60vh] overflow-y-auto p-2">
          {query && results.length === 0 && (
            <div className="py-12 text-center text-sm text-secondary">
              No documentation pages found for <span className="font-semibold text-on-surface">"{query}"</span>.
            </div>
          )}

          {!query && (
            <div className="p-4 text-xs text-secondary">
              <p className="font-semibold text-on-surface mb-2">Quick Navigation Shortcuts</p>
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <button
                  onClick={() => { onSelect("introduction/what-is-youthnic-ai-studio"); onClose(); }}
                  className="rounded-lg border border-outline-variant/40 p-2.5 text-left hover:border-primary/50 hover:bg-surface-container-low transition"
                >
                  <span className="font-semibold text-on-surface block">Product Overview</span>
                  <span className="text-secondary text-[11px]">Architecture & core features</span>
                </button>
                <button
                  onClick={() => { onSelect("studio/ai-product-analysis"); onClose(); }}
                  className="rounded-lg border border-outline-variant/40 p-2.5 text-left hover:border-primary/50 hover:bg-surface-container-low transition"
                >
                  <span className="font-semibold text-on-surface block">AI Product Analysis</span>
                  <span className="text-secondary text-[11px]">Garment inspection & vision</span>
                </button>
                <button
                  onClick={() => { onSelect("catalog-production/overview"); onClose(); }}
                  className="rounded-lg border border-outline-variant/40 p-2.5 text-left hover:border-primary/50 hover:bg-surface-container-low transition"
                >
                  <span className="font-semibold text-on-surface block">Catalog Production</span>
                  <span className="text-secondary text-[11px]">Batch SKU generation</span>
                </button>
                <button
                  onClick={() => { onSelect("developer/api-endpoints"); onClose(); }}
                  className="rounded-lg border border-outline-variant/40 p-2.5 text-left hover:border-primary/50 hover:bg-surface-container-low transition"
                >
                  <span className="font-semibold text-on-surface block">Developer API</span>
                  <span className="text-secondary text-[11px]">Backend endpoints & auth</span>
                </button>
              </div>
            </div>
          )}

          {results.map((page, index) => (
            <div
              key={page.slug}
              onClick={() => {
                onSelect(page.slug);
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`flex items-start gap-3 rounded-xl p-3 cursor-pointer transition ${
                index === selectedIndex
                  ? "bg-primary/10 border-l-4 border-primary text-on-surface"
                  : "hover:bg-surface-container-low text-secondary"
              }`}
            >
              <div className="mt-0.5 rounded-lg bg-surface-container p-1.5 text-primary">
                <BookOpen className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    {page.group}
                  </span>
                  <ChevronRight className="h-3 w-3 text-secondary/40" />
                  <span className="text-xs font-bold text-on-surface truncate">
                    {page.title}
                  </span>
                </div>
                {page.description && (
                  <p className="mt-1 line-clamp-1 text-xs text-secondary">
                    {page.description}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer info */}
        <div className="border-t border-outline-variant/40 bg-surface-container-low px-4 py-2 text-[11px] text-secondary flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>Navigate <kbd className="font-mono bg-surface-container px-1 py-0.5 rounded">↑</kbd> <kbd className="font-mono bg-surface-container px-1 py-0.5 rounded">↓</kbd></span>
            <span>Select <kbd className="font-mono bg-surface-container px-1 py-0.5 rounded">↵</kbd></span>
          </div>
          <span>97 total guides in index</span>
        </div>
      </div>
    </div>
  );
}
