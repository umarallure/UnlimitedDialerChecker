import { Wordmark } from "@/components/auth-shell";
import { NavLink } from "@/components/nav-link";
import { GhostButton } from "@/components/ui";
import { requireAdmin } from "@/lib/dal";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/numbers", label: "Numbers" },
  { href: "/agents", label: "Agents" },
];

export default async function AdminLayout({ children }: LayoutProps<"/">) {
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-x-10 px-6 lg:px-8">
          <div className="flex h-[72px] items-center">
            <Wordmark />
          </div>
          <nav aria-label="Main" className="flex gap-8">
            {NAV.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex h-[72px] items-center gap-2">
            <span className="hidden text-caption text-muted sm:inline">{admin.email}</span>
            <form action="/auth/signout" method="post">
              <GhostButton>Sign out</GhostButton>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-10 px-6 py-10 lg:px-8">{children}</main>
    </div>
  );
}
