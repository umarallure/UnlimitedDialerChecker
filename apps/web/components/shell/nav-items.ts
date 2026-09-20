export type NavItem = {
  href: string;
  label: string;
  icon: "overview" | "leads" | "numbers" | "calls" | "agents" | "rotation" | "alerts" | "campaigns" | "data" | "settings";
  /** Not built yet: shown muted with a "Soon" tag and not clickable. */
  soon?: string;
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/numbers", label: "Numbers", icon: "numbers" },
  { href: "/leads/import", label: "Leads", icon: "leads" },
  { href: "/calls", label: "Calls", icon: "calls" },
  { href: "/agents", label: "Agents", icon: "agents" },
  { href: "/rotation", label: "Rotation", icon: "rotation" },
  { href: "/alerts", label: "Alerts", icon: "alerts" },
  { href: "/campaigns", label: "Campaigns", icon: "campaigns" },
  { href: "/data", label: "Data", icon: "data", soon: "Phase 6" },
];
