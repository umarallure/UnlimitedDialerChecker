"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Modal built on the native <dialog> element, which brings focus trapping, Escape to close and
 * inert background content without a library. The backdrop is styled through ::backdrop in
 * globals.css.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  width = 640,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself, not its contents.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      // A modal <dialog> is centred by the browser's own `margin: auto`, which Tailwind's
      // preflight resets to 0 — hence fixed inset-0 with m-auto and a content-sized height.
      className="fixed inset-0 m-auto h-fit max-h-[85vh] w-[calc(100vw-32px)] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      style={{ maxWidth: width }}
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-title-md font-bold text-ink">{title}</h2>
          {description && <p className="text-caption text-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-alt hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-6 pb-6">{children}</div>
    </dialog>
  );
}
