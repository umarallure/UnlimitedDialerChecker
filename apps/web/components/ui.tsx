import type { ComponentProps, ReactNode } from "react";

/** Shared primitives built from DESIGN.md components. Keep one primary button per viewport. */

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 py-3 text-button transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export function PrimaryButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cx(buttonBase, "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed", className)}
      {...props}
    />
  );
}

export function SecondaryButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cx(buttonBase, "border border-line bg-surface text-ink hover:border-line-strong", className)}
      {...props}
    />
  );
}

export function GhostButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={cx("inline-flex min-h-11 items-center rounded-full px-3 py-2.5 text-button text-ink hover:bg-surface-alt", className)}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-caption text-body">{label}</span>
      {children}
    </label>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cx(
        "rounded-md border border-line-strong bg-surface px-3.5 py-3 text-body text-ink placeholder:text-muted focus:border-ink focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("rounded-lg border border-line bg-surface p-8", className)} {...props} />;
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-title-lg text-ink text-balance">{title}</h1>
        {description && <p className="max-w-[65ch] text-caption text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-label uppercase text-muted">{children}</h2>;
}

/** Metric panel: label, large number, one-line outcome. */
export function Metric({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-alt p-6">
      <dt className="text-label uppercase text-muted">{label}</dt>
      <dd className="text-title-lg tabular-nums text-ink">{value}</dd>
      {note && <dd className="text-caption text-muted">{note}</dd>}
    </div>
  );
}

type Tone = "neutral" | "success" | "warning" | "error" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-alt text-body border-line",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  error: "bg-error/10 text-error border-error/20",
  accent: "bg-soft-orange text-primary-pressed border-primary/20",
};

export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-legal font-semibold", TONES[tone])}>
      {children}
    </span>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "warning"; children: ReactNode }) {
  return (
    <p role="alert" className={cx("rounded-md border px-3.5 py-3 text-caption", tone === "error" ? TONES.error : TONES.warning)}>
      {children}
    </p>
  );
}

/** Border-led dense table shell; wraps its own horizontal scroll. */
export function DataTable({ head, children, minWidth = 640 }: { head: string[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-caption" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line bg-surface-alt text-left">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-3 text-label uppercase text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&_td]:px-4 [&_td]:py-3 [&_td]:text-body">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="!py-10 text-center !text-muted">
        {children}
      </td>
    </tr>
  );
}
