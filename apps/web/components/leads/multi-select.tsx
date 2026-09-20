"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

export type Option = { value: string; label: string; count?: number };

/**
 * Compact multi-select: a button showing what is chosen, and a panel to change it.
 *
 * A long checklist pushes everything else off the screen, so the list only exists while it is
 * open, and the button summarises the choice the rest of the time.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Any",
  emptyLabel = "Nothing to choose",
  search = true,
}: {
  options: Option[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  search?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const shown = query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options;
  const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-3 text-left text-caption text-ink hover:border-ink"
      >
        <span className="truncate">
          {selected.length === 0 ? (
            <span className="text-muted">{placeholder}</span>
          ) : selected.length <= 2 ? (
            selected.join(", ")
          ) : (
            `${selected.length} selected`
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {selected.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
              onKeyDown={(e) => e.key === "Enter" && onChange([])}
              className="inline-flex size-6 items-center justify-center rounded-full text-muted hover:bg-surface-alt hover:text-ink"
            >
              <X aria-hidden className="size-3.5" />
            </span>
          )}
          <ChevronDown aria-hidden className={`size-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 flex w-full flex-col rounded-md border border-line bg-surface shadow-lg">
          {search && options.length > 8 && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="h-10 border-b border-line bg-surface px-3 text-caption text-ink placeholder:text-muted focus:outline-none"
            />
          )}

          <div className="max-h-60 overflow-y-auto p-1">
            {shown.length === 0 && <p className="px-3 py-2 text-caption text-muted">{emptyLabel}</p>}
            {shown.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex min-h-9 w-full items-center gap-2 rounded px-2 text-left text-caption hover:bg-surface-alt"
                >
                  <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-on-primary" : "border-line-strong"}`}>
                    {on && <Check aria-hidden className="size-3" />}
                  </span>
                  <span className="flex-1 truncate text-ink">{o.label}</span>
                  {o.count !== undefined && <span className="text-legal text-muted tabular-nums">{o.count.toLocaleString()}</span>}
                </button>
              );
            })}
          </div>

          {options.length > 1 && (
            <div className="flex items-center justify-between border-t border-line px-2 py-1">
              <button type="button" onClick={() => onChange(options.map((o) => o.value))} className="min-h-9 px-2 text-legal text-graphite hover:text-ink">
                Select all
              </button>
              <button type="button" onClick={() => setOpen(false)} className="min-h-9 px-2 text-legal font-semibold text-ink">
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
