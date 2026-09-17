"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode =
  | { kind: "loading" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "verify"; factorId: string };

export function MfaForm() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") {
        router.replace("/");
        return;
      }

      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (listError) {
        setError(listError.message);
        return;
      }
      const verified = factors?.totp.find((f) => f.status === "verified");
      if (verified) {
        setMode({ kind: "verify", factorId: verified.id });
        return;
      }

      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `authenticator-${Date.now()}`,
      });
      if (cancelled) return;
      if (enrollError) {
        setError(enrollError.message);
        return;
      }
      setMode({ kind: "enroll", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.kind === "loading") return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: mode.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setError("That code didn’t match. Check your authenticator app and try again.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  if (mode.kind === "loading") {
    return <p className="text-sm text-zinc-500">{error ?? "Loading…"}</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {mode.kind === "enroll" && (
        <div className="flex flex-col gap-2 text-sm">
          <p>Scan this code with your authenticator app, then enter the 6-digit code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from Supabase */}
          <img src={mode.qr} alt="Authenticator QR code" className="h-44 w-44 rounded bg-white p-2" />
          <p className="text-zinc-500">
            Can’t scan? Secret: <code className="break-all">{mode.secret}</code>
          </p>
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm">
        6-digit code
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 tracking-widest dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {busy ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}
