import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";

type ActionDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  confirmDisabled = false,
  children,
  onConfirm,
  onCancel,
}: ActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  cancelRef.current = onCancel;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusableSelector = "textarea:not([disabled]), input:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";
    const focusTimer = window.requestAnimationFrame(() => {
      const initialFocus = dialogRef.current?.querySelector<HTMLElement>("textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [data-dialog-confirm]")
        || dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      initialFocus?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) cancelRef.current();
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) return null;

  const danger = tone === "danger";
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-[#111827]/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={() => { if (!busy) onCancel(); }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-4 border-b border-outline-variant/35 p-5 sm:p-6">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${danger ? "bg-red-50 text-red-700" : "bg-primary/10 text-primary"}`}>
            {danger ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-syne text-lg font-bold text-on-surface">{title}</h2>
            <p id={descriptionId} className="mt-1.5 text-sm leading-6 text-secondary">{description}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close dialog" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-container text-secondary transition hover:text-on-surface disabled:opacity-40">
            <X className="h-4 w-4" />
          </button>
        </div>

        {children && <div className="p-5 sm:p-6">{children}</div>}

        <div className="flex flex-col-reverse gap-2 border-t border-outline-variant/35 bg-surface-container/25 p-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-outline-variant bg-white px-4 py-2.5 text-sm font-bold text-secondary transition hover:bg-surface-container disabled:opacity-40">
            {cancelLabel}
          </button>
          <button data-dialog-confirm type="button" onClick={onConfirm} disabled={busy || confirmDisabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "bg-red-600 shadow-red-200 hover:bg-red-700" : "bg-primary shadow-primary/20 hover:bg-primary/90"}`}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
