/** Normalize a VICIdial caller ID to E.164 (+1NXXNXXXXXX), or null if it isn't a dialable US/Canada number. */
export function normalizeCid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return `+1${digits}`;
}

/** Resolve the caller ID a call actually used, applying the dial-plan override for invalid logged CIDs. */
export function resolveCid(raw: string | null | undefined, override: string | null): string | null {
  return normalizeCid(raw) ?? override;
}
