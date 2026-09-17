"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CircleHelp,
  Database,
  Hash,
  Headset,
  House,
  Megaphone,
  PhoneOutgoing,
  Repeat,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { PRIMARY_NAV, type NavItem } from "./nav-items";

const ICONS: Record<NavItem["icon"], LucideIcon> = {
  overview: House,
  numbers: Hash,
  calls: PhoneOutgoing,
  agents: Headset,
  rotation: Repeat,
  alerts: Bell,
  campaigns: Megaphone,
  data: Database,
  settings: Settings,
};

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function Item({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = ICONS[item.icon];
  const base = "relative flex min-h-11 items-center gap-3 rounded-md px-4 text-body";

  if (item.soon) {
    return (
      <span aria-disabled="true" className={`${base} cursor-default text-muted/70`} title={`Coming in ${item.soon}`}>
        <Icon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full bg-surface-alt px-2 py-0.5 text-legal text-muted">Soon</span>
      </span>
    );
  }

  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`${base} transition-colors ${
        active
          ? "bg-surface-alt font-semibold text-ink before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] before:rounded-full before:bg-primary"
          : "text-graphite hover:bg-surface-alt hover:text-ink"
      }`}
    >
      <Icon aria-hidden className="size-5 shrink-0" strokeWidth={active ? 2 : 1.75} />
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden w-[248px] shrink-0 overflow-y-auto border-r border-line bg-surface lg:block">
      <div className="flex min-h-full flex-col justify-between gap-8 px-6 py-6">
        <nav aria-label="Main" className="flex flex-col gap-1.5">
          {PRIMARY_NAV.map((item) => (
            <Item key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>
        <div className="flex flex-col gap-1.5">
          <Item item={{ href: "/settings", label: "Settings", icon: "settings", soon: "a later phase" }} pathname={pathname} />
          <a
            href="https://github.com/umarallure/UnlimitedDialerChecker#readme"
            target="_blank"
            rel="noreferrer"
            className="flex min-h-11 items-center gap-3 rounded-md px-4 text-body text-graphite hover:bg-surface-alt hover:text-ink"
          >
            <CircleHelp aria-hidden className="size-5" strokeWidth={1.75} />
            Help &amp; docs
          </a>
        </div>
      </div>
    </aside>
  );
}

/** Horizontal nav for screens narrower than the sidebar breakpoint. */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 lg:hidden">
      {PRIMARY_NAV.filter((i) => !i.soon).map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 text-button ${
              active ? "bg-surface-alt text-ink" : "text-graphite"
            }`}
          >
            <Icon aria-hidden className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

