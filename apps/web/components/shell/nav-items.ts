export type NavItem = {
  href: string;
  label: string;
  icon: "overview" | "numbers" | "calls" | "agents" | "rotation" | "alerts" | "campaigns" | "data" | "settings";
  /** Not built yet: shown muted with a "Soon" tag and not clickable. */
  soon?: string;
};

export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/numbers", label: "Numbers", icon: "numbers" },
  { href: "/calls", label: "Calls", icon: "calls" },
  { href: "/agents", label: "Agents", icon: "agents" },
  { href: "/rotation", label: "Rotation", icon: "rotation", soon: "Phase 3" },
  { href: "/alerts", label: "Alerts", icon: "alerts", soon: "Phase 2" },
  { href: "/campaigns", label: "Campaigns", icon: "campaigns", soon: "Phase 5" },
  { href: "/data", label: "Data", icon: "data", soon: "Phase 6" },
];
