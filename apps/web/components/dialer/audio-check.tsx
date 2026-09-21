"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Volume2 } from "lucide-react";

/**
 * Microphone and speaker check, before the agent takes a call.
 *
 * This exists because of where the webphone lives. The audio runs in the VICIdial frame, which is
 * a different origin and one pixel tall — so when it asks for the microphone, the browser puts the
 * prompt against *this* page, in the address bar, where it is trivial to miss. Miss it and
 * everything looks right: the agent registers, calls arrive, the screen updates, and nobody can
 * hear anybody.
 *
 * Asking from here instead makes the prompt arrive with an explanation attached. The grant is held
 * against this page's origin, which is what the frame needs, and the frame is reloaded afterwards
 * because the webphone only asks for the microphone once, when it starts.
 *
 * The speaker test plays through this page, not through the call. It proves the device and volume
 * are right; it cannot prove the frame will use the same output, since that follows the browser's
 * own choice.
 */

type State = "unknown" | "checking" | "ready" | "denied" | "failed";

const FRAME_ID = "vicidial-session";

export function AudioCheck() {
  const [state, setState] = useState<State>("unknown");
  const [level, setLevel] = useState(0);
  const [detail, setDetail] = useState<string>("");
  const [toneOn, setToneOn] = useState(false);
  const [heard, setHeard] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  // If the microphone was granted on a previous shift, say so without prompting again.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
        if (cancelled || !status) return;
        if (status.state === "granted") setState("ready");
        if (status.state === "denied") setState("denied");
      } catch {
        // Firefox and Safari do not all support querying this. Silence is fine; the check still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const check = useCallback(async () => {
    setState("checking");
    setDetail("");
    stop();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError") {
        setState("denied");
        setDetail("The browser blocked the microphone. Click the icon at the left of the address bar, allow the microphone, then check again.");
      } else if (name === "NotFoundError") {
        setState("failed");
        setDetail("No microphone found. Plug in a headset and check again.");
      } else {
        setState("failed");
        setDetail("The microphone could not be opened. Close anything else using it, then check again.");
      }
      return;
    }

    streamRef.current = stream;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      // Loudest departure from silence in this frame, as a rough 0-1 level.
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      setLevel(peak);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();

    const wasNew = state !== "ready";
    setState("ready");
    setDetail(stream.getAudioTracks()[0]?.label || "Microphone open");

    // The webphone asks for the microphone once, as it loads, so a *new* grant only reaches it
    // after a restart. Restarting when the microphone was already granted would be worse than
    // useless: it logs the agent out of VICIdial and back in, mid-shift, for nothing.
    if (wasNew) {
      const frame = document.getElementById(FRAME_ID) as HTMLIFrameElement | null;
      if (frame) frame.src = frame.src;
    }
  }, [stop, state]);

  const playTone = useCallback(async () => {
    const ctx = ctxRef.current ?? new AudioContext();
    ctxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.08; // Audible, never startling in a headset.
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    setToneOn(true);
    setTimeout(() => {
      osc.stop();
      setToneOn(false);
    }, 1200);
  }, []);

  const bar = Math.min(100, Math.round(level * 140));
  const hearingSomething = level > 0.02;

  if (state === "ready" && heard) {
    return (
      <p className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/10 px-4 py-3 text-caption text-success">
        <Mic aria-hidden className="size-4" /> Microphone and speaker checked. <button type="button" onClick={() => setHeard(false)} className="underline">Check again</button>
      </p>
    );
  }

  return (
    <section
      className={`rounded-lg border p-6 ${state === "denied" || state === "failed" ? "border-error/30 bg-error/5" : "border-primary/20 bg-soft-orange"}`}
    >
      <h2 className="text-title-sm font-bold text-ink">Check your headset before going ready</h2>
      <p className="mt-1 max-w-[65ch] text-caption text-graphite">
        The call audio runs in the dialer session below this page. If the browser has not been given the microphone,
        calls still arrive and nobody can hear anyone — so it is worth thirty seconds now.
      </p>

      {detail && <p className="mt-3 text-caption text-graphite">{detail}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={check}
          disabled={state === "checking"}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-button text-on-primary hover:bg-primary-hover disabled:opacity-60"
        >
          <Mic aria-hidden className="size-4" />
          {state === "checking" ? "Opening…" : state === "ready" ? "Restart the check" : "Allow the microphone"}
        </button>

        {state === "ready" && (
          <>
            <span className="flex min-w-40 items-center gap-2">
              <span className="flex h-2 w-40 overflow-hidden rounded-full bg-surface">
                <span
                  className={`h-full rounded-full transition-[width] duration-75 ${hearingSomething ? "bg-success" : "bg-line-strong"}`}
                  style={{ width: `${bar}%` }}
                />
              </span>
              <span className="text-legal text-muted">{hearingSomething ? "hearing you" : "say something"}</span>
            </span>

            <button
              type="button"
              onClick={playTone}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong"
            >
              <Volume2 aria-hidden className="size-4" />
              {toneOn ? "Playing…" : "Play a test tone"}
            </button>

            <button
              type="button"
              onClick={() => setHeard(true)}
              disabled={!hearingSomething}
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-5 text-button text-ink hover:border-line-strong disabled:opacity-40"
            >
              Both work
            </button>
          </>
        )}
      </div>

      {state === "denied" && (
        <p className="mt-4 text-legal text-muted">
          Blocking is remembered per site, so this will not prompt again until you clear it in the address bar.
        </p>
      )}
    </section>
  );
}
