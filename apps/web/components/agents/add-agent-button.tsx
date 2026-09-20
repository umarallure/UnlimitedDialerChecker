"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Modal } from "@/components/modal";
import { NewAgentForm } from "./new-agent-form";

/** Opens the agent form in a dialog, so the page stays a list of who exists. */
export function AddAgentButton({ nextListId, takenCampaigns }: { nextListId: number; takenCampaigns: string[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary shadow-sm hover:bg-primary-hover active:bg-primary-pressed"
      >
        <UserPlus aria-hidden className="size-4" />
        Add an agent
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add an agent" description="Account, campaign and list in one go.">
        <NewAgentForm nextListId={nextListId} takenCampaigns={takenCampaigns} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
