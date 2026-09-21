"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

/**
 * The VICIdial session, which carries the agent's audio.
 *
 * It cannot be removed — it registers the agent, receives predictive calls from the server and
 * hosts the webphone. What it can be is out of the way.
 *
 * **Embedded or in its own window.** Embedded is tidier and works for everything except, on some
 * browsers, the one thing that matters: the webphone registers but will not answer the call that
 * puts the agent into their conference, and every call is then silent at both ends. The same
 * screen in its own window answers immediately. The difference is a browser's rules about audio
 * and microphones in a third-party frame, which is not ours to overrule — so the choice is
 * offered rather than assumed, and remembered per browser.
 *
 * Either way the agent works in *our* screen. This is the phone, not the workplace.
 */

const FRAME_ID = "vicidial-session";
const WINDOW_NAME = "vicidial_session";
const STORAGE_KEY = "udc.dialer.session-window";

export function AgentFrame() {
  const [open, setOpen] = useState(true);
  const [windowed, setWindowed] = useState(false);
  const [windowLost, setWindowLost] = useState(false);
  const winRef = useRef<Window | null>(null);

  // Remembered per browser: an agent who needs the window needs it every shift. Read after the
  // first paint so the server and client agree on what to render to begin with.
  useEffect(() => {
    const remembered = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        // Private browsing, blocked storage: the default is simply the embedded one.
        return false;
      }
    })();
    if (remembered) queueMicrotask(() => setWindowed(true));
  }, []);

  const openWindow = useCallback(() => {
    const win = window.open("/api/agent/frame", WINDOW_NAME, "width=1120,height=760,noopener=no");
    if (!win) {
      setWindowLost(true);
      return;
    }
    winRef.current = win;
    win.focus();
    setWindowed(true);
    setWindowLost(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {}
  }, []);

  const useEmbedded = useCallback(() => {
    winRef.current?.close();
    winRef.current = null;
    setWindowed(false);
    setWindowLost(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  // A closed window means no audio, which is worth saying out loud rather than leaving an agent
  // to discover it on the next call.
  useEffect(() => {
    if (!windowed) return;
    const timer = setInterval(() => setWindowLost(Boolean(winRef.current?.closed)), 2000);
    return () => clearInterval(timer);
  }, [windowed]);

  return (
    <section className="shrink-0 border-t border-line bg-surface-alt">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-11 items-center gap-2 text-legal text-muted hover:text-ink"
          aria-expanded={open}
        >
          <span>
            {windowed
              ? "Dialer session — in its own window"
              : open
                ? "Dialer session — answer the call here once, then collapse this"
                : "Dialer session — running"}
          </span>
          {open ? <ChevronDown aria-hidden className="size-4" /> : <ChevronUp aria-hidden className="size-4" />}
        </button>

        <div className="flex items-center gap-3">
          {windowed ? (
            <>
              <button type="button" onClick={openWindow} className="min-h-11 text-legal text-graphite underline hover:text-ink">
                Reopen the window
              </button>
              <button type="button" onClick={useEmbedded} className="min-h-11 text-legal text-muted underline hover:text-ink">
                Put it back on the page
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={openWindow}
              className="inline-flex min-h-11 items-center gap-2 text-legal text-graphite underline hover:text-ink"
            >
              <ExternalLink aria-hidden className="size-3.5" />
              No audio? Open the phone in its own window
            </button>
          )}
        </div>
      </div>

      {windowLost && (
        <p className="mx-6 mb-3 rounded-md border border-warning/20 bg-warning/10 px-4 py-3 text-caption text-warning">
          The dialer session window is closed, so calls have no audio. Reopen it, then use{" "}
          <strong>Reconnect audio</strong>.
        </p>
      )}

      {!windowed && (
        <iframe
          id={FRAME_ID}
          title="VICIdial agent session"
          src="/api/agent/frame"
          /*
           * The microphone is the point: the webphone is WebRTC and lives two frames down — this
           * one holds the agent screen, which holds CyburPhone. Permissions only travel as far as
           * each container allows, so anything withheld here is withheld from the phone. The
           * origins are wildcarded to match what VICIdial's own nested frame asks for.
           */
          allow="microphone *; autoplay *; speaker-selection *"
          className="w-full border-0 bg-surface"
          style={{ height: open ? 620 : 1 }}
        />
      )}
    </section>
  );
}
