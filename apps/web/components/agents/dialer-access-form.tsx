"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Give somebody dialer access: the link between a sign-in account here and a VICIdial agent.
 *
 * The passwords are the ones VICIdial and the phone already have — this does not set them, it
 * records them so the dialer screen can open a session without asking the agent to type them
 * again. They go straight into Vault; nothing here keeps a copy.
 */
export function DialerAccessForm({
  agents,
  onDone,
}: {
  agents: { user_name: string; full_name: string | null; campaign_id: string | null }[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: "",
    agentUser: "",
    agentPass: "",
    phoneLogin: "",
    phonePass: "",
    campaignId: "",
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setForm((f) => {
      // Picking the VICIdial agent fills in what we already know about them.
      if (key === "agentUser") {
        const match = agents.find((a) => a.user_name === value);
        return { ...f, agentUser: value, campaignId: match?.campaign_id ?? f.campaignId, phoneLogin: f.phoneLogin };
      }
      return { ...f, [key]: value };
    });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/agents/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);

    if (!res?.ok) {
      toast.error("Not saved", { description: body.error ?? "Check the details and try again." });
      return;
    }
    toast.success(`${form.email} can now use the dialer`, { description: `Signed in, they land on the dialer screen as ${form.agentUser}.` });
    setForm({ email: "", agentUser: "", agentPass: "", phoneLogin: "", phonePass: "", campaignId: "" });
    router.refresh();
    onDone?.();
  }

  const field = "h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-caption text-ink placeholder:text-muted focus:border-ink focus:outline-none";
  const label = "flex flex-col gap-1 text-caption text-graphite";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" autoComplete="off">
      <label className={label}>
        Their sign-in email
        <input
          className={field}
          value={form.email}
          onChange={set("email")}
          placeholder="agent@example.com"
          autoComplete="off"
          name="dialer-access-email"
          required
        />
        <span className="text-legal text-muted">They need an account here already — invite them in Supabase first.</span>
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className={label}>
          VICIdial agent
          <select className={field} value={form.agentUser} onChange={set("agentUser")} name="dialer-access-agent" required>
            <option value="">Choose…</option>
            {agents.map((a) => (
              <option key={a.user_name} value={a.user_name}>
                {a.user_name}
                {a.full_name ? ` — ${a.full_name}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className={label}>
          Their campaign
          <input className={field} value={form.campaignId} onChange={set("campaignId")} placeholder="AG_AGT1" autoComplete="off" name="dialer-access-campaign" />
        </label>

        <label className={label}>
          VICIdial password
          <input className={field} type="password" value={form.agentPass} onChange={set("agentPass")} autoComplete="new-password" name="dialer-access-pass" required />
        </label>

        <label className={label}>
          Phone login
          <input className={field} value={form.phoneLogin} onChange={set("phoneLogin")} placeholder="1001" autoComplete="off" name="dialer-access-phone" required />
        </label>

        <label className={label}>
          Phone password
          <input className={field} type="password" value={form.phonePass} onChange={set("phonePass")} autoComplete="new-password" name="dialer-access-phone-pass" required />
        </label>
      </div>

      <p className="rounded-md bg-surface-alt p-3 text-legal text-muted">
        The phone must be one of theirs alone and set to <strong>webphone</strong> in VICIdial. Two sessions on one
        extension will fight over the call.
      </p>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover disabled:opacity-60"
        >
          {busy ? "Saving…" : "Give dialer access"}
        </button>
      </div>
    </form>
  );
}
