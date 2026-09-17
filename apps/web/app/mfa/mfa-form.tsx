"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Field, Input, PrimaryButton } from "@/components/ui";
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
    return error ? <Alert>{error}</Alert> : <p className="text-caption text-muted">Loading…</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {mode.kind === "enroll" && (
        <div className="flex flex-col gap-4 rounded-lg bg-surface-alt p-6">
          <p className="text-caption text-graphite">Scan this code with your authenticator app, then enter the 6-digit code below.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- data: URI from Supabase */}
          <img src={mode.qr} alt="Authenticator QR code" className="size-44 rounded-md border border-line bg-surface p-2" />
          <p className="text-legal text-muted">
            Can’t scan? Enter this secret: <code className="break-all font-mono text-code text-ink">{mode.secret}</code>
          </p>
        </div>
      )}
      <Field label="6-digit code">
        <Input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="font-mono tracking-[0.3em]"
        />
      </Field>
      {error && <Alert>{error}</Alert>}
      <PrimaryButton disabled={busy} className="mt-2 w-full">
        {busy ? "Verifying…" : "Verify"}
      </PrimaryButton>
    </form>
  );
}
