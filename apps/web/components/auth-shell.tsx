import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/brand";

/** Centered white card on the neutral canvas for sign-in, MFA and access pages. */
export function AuthShell({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center bg-canvas px-6 py-16">
      <div className="flex w-full max-w-[440px] flex-col gap-8">
        <BrandMark />
        <div className="flex flex-col gap-6 rounded-lg border border-line bg-surface p-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-title-lg font-bold text-ink text-balance">{title}</h1>
            <p className="text-body text-graphite">{description}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
