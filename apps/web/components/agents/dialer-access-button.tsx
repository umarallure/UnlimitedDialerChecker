"use client";
import { useState } from "react";
import { Headset } from "lucide-react";
import { Modal } from "@/components/modal";
import { DialerAccessForm } from "./dialer-access-form";

/** Opens the dialer-access form in a dialog, matching how agents are added. */
export function DialerAccessButton({ agents }: { agents: { user_name: string; full_name: string | null; campaign_id: string | null }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong"
      >
        <Headset aria-hidden className="size-4" />
        Dialer access
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Give dialer access"
        description="Link a sign-in account to a VICIdial agent, so signing in opens their dialer screen."
      >
        <DialerAccessForm agents={agents} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
