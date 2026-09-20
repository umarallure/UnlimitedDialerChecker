"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { exampleLink } from "@/lib/crm/lead-link";

/**
 * The CRM link behind the agent screen's WEB FORM button.
 *
 * An agent on a call has the lead's name and number in front of them; this gives them the whole
 * record without searching the CRM for whoever they are speaking to.
 */
export function LeadLinkForm({
  connectionId,
  template,
  campaigns,
}: {
  connectionId: string;
  template: string | null;
  campaigns: { campaign_id: string; hasLink: boolean }[];
}) {
  const router = useRouter();
  const [value, setValue] = useState(template ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await fetch("/api/crm/lead-link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: connectionId, template: value, campaignIds: campaigns.map((c) => c.campaign_id) }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);

    if (!res?.ok) {
      toast.error("Not saved", { description: body.error ?? "Check the link and try again." });
      return;
    }
    toast.success(value.trim() ? "Link saved" : "Link removed", {
      description: body.campaigns
        ? `Sent to ${body.campaigns} campaign${body.campaigns === 1 ? "" : "s"}. Agents see it after their next login.`
        : "No campaigns to update yet.",
    });
    router.refresh();
  }

  const valid = value.includes("{id}") && /^https?:\/\//.test(value.trim());

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-caption text-graphite">CRM lead link</span>
        <input
          className="h-11 w-full rounded-md border border-line-strong bg-surface px-3 font-mono text-caption text-ink placeholder:text-muted focus:border-ink focus:outline-none"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://crm.powerpolicies.com/leads/{id}"
          autoComplete="off"
          name="crm-lead-link"
        />
        <span className="text-legal text-muted">
          Put <code className="text-ink">{"{id}"}</code> where the lead&rsquo;s id belongs. The dialer fills it in per call.
        </span>
      </label>

      {valid && (
        <p className="flex items-center gap-2 rounded-md bg-surface-alt p-3 text-legal text-graphite">
          <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted" />
          <span className="truncate font-mono">{exampleLink(value)}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || (value.trim().length > 0 && !valid)}
          className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save and put on campaigns"}
        </button>
        <span className="text-legal text-muted">
          {campaigns.length === 0
            ? "No agent campaigns yet."
            : `${campaigns.filter((c) => c.hasLink).length} of ${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} already has a link.`}
        </span>
      </div>
    </div>
  );
}
