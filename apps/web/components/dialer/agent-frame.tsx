"use client";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * The VICIdial agent screen, running underneath ours.
 *
 * It cannot be removed — it registers the agent, receives predictive calls from the server and
 * hosts the webphone that carries the audio. What it can be is out of the way.
 *
 * It is never `display:none` and never zero-sized: a hidden iframe gets its timers throttled by
 * the browser, and VICIdial's agent screen is a polling loop. So it stays laid out and visible at
 * one pixel of height when collapsed, which keeps it running at full speed.
 *
 * The expand control stays in for now. While this is new, being able to see what the real agent
 * screen thinks is happening is worth more than the tidiness of hiding it completely.
 */
export function AgentFrame() {
  // Open to begin with. The webphone cannot start audio without a click inside its own frame —
  // browsers require a gesture in that document, and our page cannot supply one on its behalf.
  // Once the agent has answered the session call, they can collapse it and forget it exists.
  const [open, setOpen] = useState(true);

  return (
    <section className="shrink-0 border-t border-line bg-surface-alt">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between px-6 text-legal text-muted hover:text-ink"
        aria-expanded={open}
      >
        <span>{open ? "VICIdial session — answer the call here once, then collapse this" : "VICIdial session — running"}</span>
        {open ? <ChevronDown aria-hidden className="size-4" /> : <ChevronUp aria-hidden className="size-4" />}
      </button>

      <iframe
        id="vicidial-session"
        title="VICIdial agent session"
        src="/api/agent/frame"
        /*
         * The microphone is the point: the webphone is WebRTC and lives two frames down — this
         * one holds the agent screen, which holds CyburPhone. Permissions only travel as far as
         * each container allows, so anything withheld here is withheld from the phone.
         *
         * The origins are wildcarded to match what VICIdial's own nested frame asks for
         * (`microphone *`). Narrowing to the default 'src' would rely on the two frames staying
         * same-origin, which is VICIdial's business to change, not ours.
         */
        allow="microphone *; autoplay *; speaker-selection *"
        className="w-full border-0 bg-surface"
        style={{ height: open ? 620 : 1 }}
      />
    </section>
  );
}
