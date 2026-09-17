"use client";
import { Toaster as Sonner } from "sonner";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";

/** App-wide toasts in the DESIGN.md language: white card, 12px radius, ink text, semantic icon. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      visibleToasts={4}
      closeButton
      duration={5000}
      icons={{
        success: <CheckCircle2 className="size-5 text-success" strokeWidth={2} />,
        error: <XCircle className="size-5 text-error" strokeWidth={2} />,
        warning: <AlertTriangle className="size-5 text-warning" strokeWidth={2} />,
        info: <Info className="size-5 text-graphite" strokeWidth={2} />,
        loading: <Loader2 className="size-5 animate-spin text-graphite motion-reduce:animate-none" strokeWidth={2} />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[360px] max-w-[calc(100vw-32px)] items-start gap-3 rounded-lg border border-line bg-surface p-4 font-sans text-ink shadow-card-hover",
          icon: "mt-0.5 shrink-0",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "text-caption font-semibold text-ink",
          description: "text-caption text-graphite",
          closeButton:
            "order-last -mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-alt hover:text-ink [&_svg]:size-3.5",
          actionButton: "rounded-full bg-ink px-3 py-1 text-legal font-semibold text-on-dark",
          error: "border-error/30",
          warning: "border-warning/30",
        },
      }}
    />
  );
}
