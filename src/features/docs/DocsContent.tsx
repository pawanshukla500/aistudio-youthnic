import React, { useState } from "react";
import {
  Check,
  Copy,
  Info,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  HelpCircle,
  Maximize2,
  X,
} from "lucide-react";

interface DocsContentProps {
  content: string;
  title: string;
  description?: string;
  group: string;
}

export function DocsContent({ content, title, description, group }: DocsContentProps) {
  const [modalImage, setModalImage] = useState<{ src: string; caption?: string } | null>(null);

  // Pre-process and render sections with useMemo for high performance
  const renderedElements = React.useMemo(() => {
    return renderMarkdownElements(content, (src, caption) => {
      setModalImage({ src, caption });
    });
  }, [content]);

  return (
    <div className="mx-auto max-w-4xl py-6">
      {/* Breadcrumbs */}
      <div className="mb-4 flex items-center gap-2 text-xs font-medium text-secondary">
        <span>Docs</span>
        <span>/</span>
        <span className="font-semibold text-primary">{group}</span>
        <span>/</span>
        <span className="truncate text-on-surface">{title}</span>
      </div>

      {/* Page Header */}
      <header className="mb-8 border-b border-outline-variant/40 pb-6">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          <span>{group}</span>
        </div>
        <h1 className="font-syne text-3xl font-bold tracking-tight text-on-surface lg:text-4xl">
          {title}
        </h1>
        {description && (
          <p className="mt-3 text-base leading-relaxed text-secondary lg:text-lg">
            {description}
          </p>
        )}
      </header>

      {/* Content Body */}
      <div className="prose-docs space-y-6 text-[15px] leading-relaxed text-on-surface">
        {renderedElements}
      </div>

      {/* Fullscreen Image Lightbox */}
      {modalImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setModalImage(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-5xl overflow-hidden rounded-2xl bg-surface-container-lowest p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setModalImage(null)}
              className="absolute right-4 top-4 z-10 rounded-full bg-black/60 p-2 text-white hover:bg-black"
              aria-label="Close image preview"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={modalImage.src}
              alt={modalImage.caption || "Screenshot preview"}
              className="max-h-[80vh] w-auto rounded-xl object-contain"
            />
            {modalImage.caption && (
              <p className="py-2 text-center text-xs font-medium text-secondary">
                {modalImage.caption}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative my-5 overflow-hidden rounded-xl border border-outline-variant/60 bg-[#161b26] text-slate-100 shadow-md">
      <div className="flex items-center justify-between border-b border-slate-700/60 bg-[#10141d] px-4 py-2 text-xs font-mono text-slate-400">
        <span className="uppercase tracking-wider">{language || "text"}</span>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-xs font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderMarkdownElements(
  text: string,
  onImageClick: (src: string, caption?: string) => void
): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Check for Code Block (```)
    if (line.trim().startsWith("```")) {
      const language = line.trim().replace(/^```/, "").trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume ending ```
      elements.push(
        <CodeBlock key={key++} code={codeLines.join("\n")} language={language} />
      );
      continue;
    }

    // 2. Check for Mintlify Frame / Image tag (<Frame caption="..."> ... </Frame>)
    if (line.includes("<Frame") || line.includes("<img")) {
      let frameBlock = line;
      if (!line.includes("</Frame>") && line.includes("<Frame")) {
        i++;
        while (i < lines.length && !lines[i].includes("</Frame>")) {
          frameBlock += "\n" + lines[i];
          i++;
        }
        if (i < lines.length) {
          frameBlock += "\n" + lines[i];
          i++;
        }
      } else {
        i++;
      }

      // Extract caption and src
      const captionMatch = frameBlock.match(/caption=["'](.*?)["']/);
      const srcMatch = frameBlock.match(/src=["'](.*?)["']/);
      const caption = captionMatch ? captionMatch[1] : undefined;
      let src = srcMatch ? srcMatch[1] : "";

      // Ensure proper image path resolution
      if (src && !src.startsWith("http") && !src.startsWith("/")) {
        src = "/" + src;
      }

      if (src) {
        elements.push(
          <div key={key++} className="group my-6 overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-low shadow-sm transition hover:shadow-md">
            <div className="relative cursor-pointer overflow-hidden bg-surface-container-lowest" onClick={() => onImageClick(src, caption)}>
              <img
                src={src}
                alt={caption || "AI Studio Screenshot"}
                className="w-full object-contain transition duration-200 group-hover:scale-[1.01]"
                loading="lazy"
              />
              <div className="absolute right-3 top-3 rounded-lg bg-black/50 p-1.5 text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
                <Maximize2 className="h-4 w-4" />
              </div>
            </div>
            {caption && (
              <div className="border-t border-outline-variant/40 bg-surface-container-low px-4 py-2.5 text-center text-xs font-medium text-secondary">
                {caption}
              </div>
            )}
          </div>
        );
      } else {
        // Fallback: If no image src was found, don't silently drop content.
        const cleanInner = frameBlock
          .replace(/<\/?Frame[^>]*>/gi, "")
          .replace(/<img[^>]*>/gi, "")
          .trim();
        if (cleanInner || caption) {
          elements.push(
            <div key={key++} className="my-4 rounded-xl border border-outline-variant/50 bg-surface-container-low p-4 text-xs text-secondary">
              {caption && <div className="font-semibold text-on-surface mb-1">{caption}</div>}
              {cleanInner && <p>{parseInlineFormatting(cleanInner)}</p>}
            </div>
          );
        }
      }
      continue;
    }

    // 3. Callout Cards (<Tip>, <Warning>, <Note>, <Info>, <Check>)
    const calloutMatch = line.match(/^<(Tip|Warning|Note|Info|Check)>/i);
    if (calloutMatch) {
      const type = calloutMatch[1].toLowerCase();
      const endTag = `</${calloutMatch[1]}>`;
      const calloutLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].includes(endTag)) {
        calloutLines.push(lines[i]);
        i++;
      }
      i++; // consume endTag

      const config = {
        tip: {
          border: "border-emerald-300 bg-emerald-50 text-emerald-950",
          icon: <Lightbulb className="h-5 w-5 text-emerald-600 shrink-0" />,
          title: "Tip",
        },
        warning: {
          border: "border-amber-300 bg-amber-50 text-amber-950",
          icon: <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />,
          title: "Warning",
        },
        note: {
          border: "border-primary/30 bg-soft-blush text-primary-fixed-variant",
          icon: <Info className="h-5 w-5 text-primary shrink-0" />,
          title: "Note",
        },
        info: {
          border: "border-sky-300 bg-sky-50 text-sky-950",
          icon: <Info className="h-5 w-5 text-sky-600 shrink-0" />,
          title: "Information",
        },
        check: {
          border: "border-teal-300 bg-teal-50 text-teal-950",
          icon: <CheckCircle2 className="h-5 w-5 text-teal-600 shrink-0" />,
          title: "Best Practice",
        },
      }[type] || {
        border: "border-outline-variant bg-surface-container-low text-on-surface",
        icon: <HelpCircle className="h-5 w-5 text-secondary shrink-0" />,
        title: "Notice",
      };

      elements.push(
        <div key={key++} className={`my-5 flex gap-3.5 rounded-xl border p-4 text-sm leading-relaxed ${config.border}`}>
          {config.icon}
          <div>
            <div className="font-semibold">{config.title}</div>
            <div className="mt-1 space-y-1 text-[13.5px]">
              {calloutLines.map((cl, idx) => (
                <p key={idx}>{parseInlineFormatting(cl)}</p>
              ))}
            </div>
          </div>
        </div>
      );
      continue;
    }

    // 4. Step tags (<Step title="...">)
    const stepMatch = line.match(/<Step\s+title=["'](.*?)["']>/i);
    if (stepMatch) {
      const stepTitle = stepMatch[1];
      const stepLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].includes("</Step>")) {
        stepLines.push(lines[i]);
        i++;
      }
      i++; // consume </Step>

      elements.push(
        <div key={key++} className="relative my-4 pl-7">
          <div className="absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 border-primary bg-white" />
          <h4 className="font-syne text-base font-bold text-on-surface">{stepTitle}</h4>
          <div className="mt-1.5 space-y-2 text-sm text-secondary">
            {stepLines.map((sl, idx) => (
              <p key={idx}>{parseInlineFormatting(sl)}</p>
            ))}
          </div>
        </div>
      );
      continue;
    }

    // Ignore container wrappers like <Steps>, </Steps>, <CardGroup>, </CardGroup>
    if (
      line.trim().startsWith("<Steps>") ||
      line.trim().startsWith("</Steps>") ||
      line.trim().startsWith("<CardGroup") ||
      line.trim().startsWith("</CardGroup>")
    ) {
      i++;
      continue;
    }

    // 5. Card (<Card title="..." ...>)
    const cardMatch = line.match(/<Card\s+title=["'](.*?)["'](.*?)>/i);
    if (cardMatch) {
      const cardTitle = cardMatch[1];
      const cardLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].includes("</Card>")) {
        cardLines.push(lines[i]);
        i++;
      }
      i++;

      elements.push(
        <div key={key++} className="my-4 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4 shadow-sm hover:border-primary/50 transition">
          <h4 className="font-syne text-sm font-bold text-on-surface">{cardTitle}</h4>
          <div className="mt-1.5 text-xs text-secondary leading-relaxed">
            {cardLines.map((l, idx) => (
              <p key={idx}>{parseInlineFormatting(l)}</p>
            ))}
          </div>
        </div>
      );
      continue;
    }

    // 6. Markdown Table (| Col | Col |)
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headerRow = tableLines[0].slice(1, -1).split("|").map((c) => c.trim());
        const dataRows = tableLines.slice(2).map((row) =>
          row.slice(1, -1).split("|").map((c) => c.trim())
        );

        elements.push(
          <div key={key++} className="my-6 overflow-x-auto rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-outline-variant/60 bg-surface-container-low text-on-surface font-semibold">
                  {headerRow.map((h, colIdx) => (
                    <th key={colIdx} className="p-3">
                      {parseInlineFormatting(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {dataRows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-surface-container/30 transition">
                    {row.map((cell, cellIdx) => (
                      <td key={cellIdx} className="p-3 text-secondary">
                        {parseInlineFormatting(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }

    // 7. Headings
    if (line.startsWith("## ")) {
      const textOnly = line.replace(/^##\s+/, "").replace(/<[^>]*>/g, "").trim();
      const id = textOnly.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      elements.push(
        <h2 key={key++} id={id} className="mt-8 mb-3 scroll-mt-20 font-syne text-xl font-bold tracking-tight text-on-surface border-b border-outline-variant/30 pb-2">
          {textOnly}
        </h2>
      );
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      const textOnly = line.replace(/^###\s+/, "").replace(/<[^>]*>/g, "").trim();
      const id = textOnly.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      elements.push(
        <h3 key={key++} id={id} className="mt-6 mb-2 scroll-mt-20 font-syne text-lg font-bold text-on-surface">
          {textOnly}
        </h3>
      );
      i++;
      continue;
    }

    if (line.startsWith("#### ")) {
      const textOnly = line.replace(/^####\s+/, "").replace(/<[^>]*>/g, "").trim();
      elements.push(
        <h4 key={key++} className="mt-4 mb-2 font-syne text-sm font-bold text-on-surface">
          {textOnly}
        </h4>
      );
      i++;
      continue;
    }

    // 8. Lists
    if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
      const listItems: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith("- ") || lines[i].trim().startsWith("* "))) {
        listItems.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      elements.push(
        <ul key={key++} className="my-3 ml-5 list-disc space-y-1.5 text-sm text-secondary">
          {listItems.map((item, idx) => (
            <li key={idx}>{parseInlineFormatting(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      elements.push(
        <ol key={key++} className="my-3 ml-5 list-decimal space-y-1.5 text-sm text-secondary">
          {listItems.map((item, idx) => (
            <li key={idx}>{parseInlineFormatting(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // 9. Blank lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // 10. Standard Paragraph
    elements.push(
      <p key={key++} className="my-2.5 text-secondary leading-relaxed">
        {parseInlineFormatting(line)}
      </p>
    );
    i++;
  }

  return elements;
}

// Inline formatting parser for bold, inline code, links
function parseInlineFormatting(text: string): React.ReactNode {
  if (!text) return null;

  // Split by markdown link [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  const parts: React.ReactNode[] = [];
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(...parseBoldAndCode(text.substring(lastIndex, match.index)));
    }
    const linkText = match[1];
    const linkHref = match[2];
    const isExternal = linkHref.startsWith("http://") || linkHref.startsWith("https://") || linkHref.startsWith("mailto:");
    parts.push(
      <a
        key={`link-${match.index}`}
        href={linkHref}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noopener noreferrer" : undefined}
        className="font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
      >
        {linkText}
      </a>
    );
    lastIndex = linkRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(...parseBoldAndCode(text.substring(lastIndex)));
  }

  return <>{parts}</>;
}

function parseBoldAndCode(str: string): React.ReactNode[] {
  // Regex to match **bold** or `code`
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(str)) !== null) {
    if (match.index > lastIdx) {
      parts.push(str.substring(lastIdx, match.index));
    }
    const token = match[1];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={`b-${match.index}`} className="font-semibold text-on-surface">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={`c-${match.index}`}
          className="rounded bg-surface-container px-1.5 py-0.5 text-xs font-mono font-medium text-primary"
        >
          {token.slice(1, -1)}
        </code>
      );
    }
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < str.length) {
    parts.push(str.substring(lastIdx));
  }

  return parts;
}
