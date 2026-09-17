import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";

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
      <span className="text-caption text-graphite">{label}</span>
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

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-6">
      <div className="flex flex-col gap-1">
        {eyebrow && <p className="text-caption text-muted">{eyebrow}</p>}
        <h1 className="text-headline-lg font-bold text-ink text-balance">{title}</h1>
        {description && <p className="mt-1 max-w-[65ch] text-body text-graphite">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-3">{action}</div>}
    </div>
  );
}

/** Primary CTA rendered as a link (for navigation actions). */
export function PrimaryLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cx(buttonBase, "bg-primary text-on-primary shadow-sm hover:bg-primary-hover active:bg-primary-pressed", className)}
      {...props}
    />
  );
}

/** KPI card: title, large value, change note, optional icon circle. */
export function KpiCard({
  label,
  value,
  note,
  noteTone = "muted",
  icon,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  noteTone?: "muted" | "success" | "warning" | "error";
  icon?: ReactNode;
}) {
  const noteClass = { muted: "text-muted", success: "text-success", warning: "text-warning", error: "text-error" }[noteTone];
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-line bg-surface p-6">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-title-sm font-medium text-ink">{label}</p>
        <p className="text-[40px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">{value}</p>
        {note && <p className={cx("text-caption", noteClass)}>{note}</p>}
      </div>
      {icon && (
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-alt text-graphite">
          {icon}
        </span>
      )}
    </div>
  );
}

/** White module with a title row (title, subtitle, action) above its content. */
export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("flex min-w-0 flex-col rounded-lg border border-line bg-surface", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div className="flex flex-col gap-1">
            {title && <h2 className="text-title-md font-bold text-ink">{title}</h2>}
            {subtitle && <p className="text-caption text-muted">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className={cx("min-w-0", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Ink link with a trailing arrow (DESIGN.md button-link-arrow). */
export function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 text-caption text-graphite hover:text-ink">
      {children}
      <span aria-hidden>→</span>
    </Link>
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
  neutral: "bg-surface-alt text-graphite border-line",
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

/** Border-led dense table; wraps its own horizontal scroll. `bare` drops the outer card for use inside a Panel. */
export function DataTable({
  head,
  children,
  minWidth = 640,
  bare = false,
}: {
  head: string[];
  children: ReactNode;
  minWidth?: number;
  bare?: boolean;
}) {
  return (
    <div className={cx("overflow-x-auto", !bare && "rounded-lg border border-line bg-surface")}>
      <table className="w-full text-caption" style={{ minWidth }}>
        <thead>
          <tr className={cx("border-b border-line text-left", bare ? "bg-surface-alt" : "bg-surface")}>
            {head.map((h, i) => (
              <th key={`${h}-${i}`} scope="col" className="px-6 py-3.5 text-caption font-medium text-graphite">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-line [&>tr:last-child]:border-0 [&_td]:px-6 [&_td]:py-4 [&_td]:align-middle [&_td]:text-graphite">
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
