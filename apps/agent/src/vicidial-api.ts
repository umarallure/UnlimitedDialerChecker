/**
 * Client for VICIdial's non-agent API.
 *
 * Always POST. The API accepts GET, but the credentials are request parameters, so a GET
 * writes the password into the web server's access log on every call.
 *
 * The API answers in plain text, not JSON: "SUCCESS: ..." or "ERROR: ...", with pipe-delimited
 * rows for list functions. Responses are parsed here so the rest of the agent deals in results
 * rather than strings.
 */

export type ApiConfig = { url: string; user: string; pass: string; source: string };

export type ApiResult =
  | { ok: true; message: string; rows: string[][]; raw: string }
  | { ok: false; error: string; raw: string };

/** The API answers 200 with an ERROR body, so success is decided by the body, not the status. */
export function parseApiResponse(raw: string): ApiResult {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, error: "Empty response from VICIdial", raw };

  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const first = lines[0] ?? "";

  if (/^ERROR/i.test(first)) {
    // "ERROR: campaigns_list USER DOES NOT HAVE PERMISSION...: |udcapi|0|"
    return { ok: false, error: first.replace(/^ERROR:\s*/i, "").trim(), raw };
  }

  const isSuccess = /^SUCCESS/i.test(first);
  const body = isSuccess ? lines.slice(1) : lines;
  return {
    ok: true,
    message: isSuccess ? first.replace(/^SUCCESS:\s*/i, "").trim() : first,
    rows: body.map((l) => l.split("|")),
    raw,
  };
}

export class VicidialApi {
  constructor(private readonly cfg: ApiConfig) {}

  async call(fn: string, params: Record<string, string | number | undefined> = {}, timeoutMs = 20_000): Promise<ApiResult> {
    const body = new URLSearchParams({ source: this.cfg.source, user: this.cfg.user, pass: this.cfg.pass, function: fn });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") body.set(k, String(v));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.cfg.url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
      const raw = await res.text();
      if (!res.ok) return { ok: false, error: `VICIdial returned HTTP ${res.status}`, raw };
      return parseApiResponse(raw);
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError" ? `No answer within ${timeoutMs / 1000}s` : err instanceof Error ? err.message : String(err);
      return { ok: false, error: reason, raw: "" };
    } finally {
      clearTimeout(timer);
    }
  }
}
