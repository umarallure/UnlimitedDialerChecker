import type { ReactNode } from "react";

/** Centered white card on the neutral canvas for sign-in, MFA and access pages. */
export function AuthShell({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-[420px] flex-col gap-6">
        <Wordmark />
        <div className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-title-md text-ink text-balance">{title}</h1>
            <p className="text-caption text-muted">{description}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden className="size-2.5 rounded-full bg-primary" />
      <span className="text-button text-ink">Unlimited Dialer Checker</span>
    </div>
  );
}
