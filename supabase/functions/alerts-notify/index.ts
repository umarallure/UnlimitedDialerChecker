// alerts-notify: called by pg_cron every 15 minutes (2 minutes after the health checks).
// 1) Emails any critical alert that hasn't been emailed yet (one email per run, batched).
// 2) Sends the daily digest once, at the configured Eastern-time hour.
//
// Auth: verify_jwt is off; the caller must present the Vault-held cron secret in `x-cron-secret`.
// Secrets (Supabase dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY  required
//   ALERT_FROM      e.g. "Dialer Alerts <alerts@yourdomain.com>" (domain verified in Resend)
//   APP_URL         e.g. https://your-app.example.com (links in emails; optional)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const TZ = "America/New_York";

type Alert = {
  id: number;
  kind: string;
  severity: "info" | "warning" | "critical";
  message: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const KIND_LABEL: Record<string, string> = {
  answer_rate_low: "Low answer rate",
  short_calls_high: "Too many short calls",
  short_calls_rising: "Short calls rising",
  drop_rate_high: "High drop rate",
  sip_608_spike: "Carrier rejections (608)",
  answer_rate_drop: "Answer rate falling",
  spam_label: "Spam label",
  sync_stale: "Dialer sync stopped",
  pool_drop_rate: "Pool drop rate",
  state_uncovered: "State without numbers",
};

function etParts(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(title: string, intro: string, body: string, appUrl: string | undefined, cta: string) {
  const button = appUrl
    ? `<p style="margin:24px 0 0"><a href="${appUrl}/alerts" style="display:inline-block;background:#FF5900;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 20px;border-radius:9999px">${cta}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#FCFCFD;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#15191E">
  <div style="max-width:640px;margin:0 auto;padding:32px 24px">
    <p style="margin:0 0 16px;font-size:12px;font-weight:600;letter-spacing:.08em;color:#60646C">UNLIMITED DIALER CHECKER</p>
    <div style="background:#fff;border:1px solid #E6E8EB;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;letter-spacing:-.02em">${escapeHtml(title)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#33383F">${intro}</p>
      ${body}
      ${button}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#60646C">Sent automatically by the dialer health checks.</p>
  </div></body></html>`;
}

function alertRows(alerts: Alert[]) {
  return `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${alerts
    .map(
      (a) => `<tr><td style="padding:12px 0;border-top:1px solid #E6E8EB;vertical-align:top;width:150px">
        <span style="display:inline-block;font-size:12px;font-weight:600;padding:2px 10px;border-radius:9999px;${
          a.severity === "critical" ? "background:#FBEAEA;color:#C92A2A" : "background:#F8EEE3;color:#B35C00"
        }">${escapeHtml(KIND_LABEL[a.kind] ?? a.kind)}</span></td>
        <td style="padding:12px 0 12px 12px;border-top:1px solid #E6E8EB;color:#33383F">${escapeHtml(a.message)}</td></tr>`,
    )
    .join("")}</table>`;
}

async function sendEmail(to: string[], subject: string, html: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("ALERT_FROM");
  if (!key || !from) throw new Error("Email is not configured: set RESEND_API_KEY and ALERT_FROM in Edge Function secrets");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const presented = req.headers.get("x-cron-secret") ?? "";
  const { data: ok } = await db.rpc("udc_cron_secret_matches", { presented });
  if (!ok) return new Response("unauthorized", { status: 401 });

  const { data: settings, error: settingsError } = await db.from("notification_settings").select("*").single();
  if (settingsError || !settings) return Response.json({ error: settingsError?.message ?? "no settings" }, { status: 500 });

  const appUrl = Deno.env.get("APP_URL")?.replace(/\/$/, "");
  const recipients: string[] = settings.recipients ?? [];
  const summary = { immediate: 0, digest: false, errors: [] as string[] };

  // Until email is configured, record that once per run instead of logging a failed send every 15 minutes.
  if (!Deno.env.get("RESEND_API_KEY") || !Deno.env.get("ALERT_FROM")) {
    const msg = "Email is not configured: set RESEND_API_KEY and ALERT_FROM in Edge Function secrets";
    await db.from("notification_settings").update({ last_run_at: new Date().toISOString(), last_error: msg }).eq("id", true);
    return Response.json({ ...summary, errors: [msg] }, { status: 503 });
  }

  // 1) Immediate emails for new critical alerts.
  if (settings.immediate_enabled && recipients.length) {
    const { data: pending } = await db
      .from("alerts")
      .select("id, kind, severity, message, created_at, resolved_at, resolved_by")
      .eq("severity", "critical")
      .is("resolved_at", null)
      .is("emailed_at", null)
      .order("created_at");
    const alerts = (pending ?? []) as Alert[];
    if (alerts.length) {
      const subject = alerts.length === 1 ? `Dialer alert: ${alerts[0].message}` : `Dialer alert: ${alerts.length} new critical problems`;
      const html = layout(
        alerts.length === 1 ? "A number needs attention" : `${alerts.length} new critical problems`,
        "These were detected by the latest health check. They stay open until the numbers recover or you resolve them.",
        alertRows(alerts),
        appUrl,
        "Review alerts",
      );
      try {
        await sendEmail(recipients, subject.slice(0, 180), html);
        await db.from("alerts").update({ emailed_at: new Date().toISOString() }).in("id", alerts.map((a) => a.id));
        await db.from("notification_log").insert({ kind: "immediate", status: "sent", recipients, subject, alert_ids: alerts.map((a) => a.id) });
        summary.immediate = alerts.length;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.errors.push(msg);
        await db.from("notification_log").insert({ kind: "immediate", status: "failed", recipients, subject, alert_ids: alerts.map((a) => a.id), error: msg });
      }
    }
  }

  // 2) Daily digest at the configured Eastern hour, once per day.
  const et = etParts();
  if (settings.digest_enabled && recipients.length && et.hour === settings.digest_hour_et) {
    const { data: already } = await db
      .from("notification_log")
      .select("id")
      .eq("kind", "digest")
      .eq("status", "sent")
      .eq("digest_day", et.day)
      .maybeSingle();

    if (!already) {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const yesterday = etParts(new Date(Date.now() - 86_400_000)).day;
      const [open, opened, resolved, pool, stats, dialers] = await Promise.all([
        db.from("alerts").select("id, kind, severity, message, created_at, resolved_at, resolved_by").is("resolved_at", null).order("severity", { ascending: false }).order("created_at"),
        db.from("alerts").select("id", { count: "exact", head: true }).gte("created_at", since),
        db.from("alerts").select("id", { count: "exact", head: true }).gte("resolved_at", since),
        db.from("dids").select("lifecycle, manual_hold"),
        db.from("did_stats_daily").select("calls, answered, drops").eq("day", yesterday),
        db.from("dialers").select("name, last_heartbeat_at"),
      ]);

      const openAlerts = (open.data ?? []) as Alert[];
      const lifecycles = ["ACTIVE", "WARMING", "NEW", "COOLING", "RETIRED"];
      const poolCounts = lifecycles.map((l) => `${l.charAt(0) + l.slice(1).toLowerCase()} ${(pool.data ?? []).filter((d) => d.lifecycle === l).length}`).join(" · ");
      const calls = (stats.data ?? []).reduce((n, r) => n + (r.calls ?? 0), 0);
      const answered = (stats.data ?? []).reduce((n, r) => n + (r.answered ?? 0), 0);
      const rate = calls ? `${((answered / calls) * 100).toFixed(1)}%` : "—";
      const lastSync = (dialers.data ?? []).map((d) => `${d.name}: ${d.last_heartbeat_at ? new Date(d.last_heartbeat_at).toLocaleString("en-US", { timeZone: TZ }) : "never"}`).join(", ") || "no dialer connected";
      const critical = openAlerts.filter((a) => a.severity === "critical").length;

      const metric = (label: string, value: string) =>
        `<td style="padding:12px;background:#F6F7F9;border-radius:8px"><div style="font-size:12px;color:#60646C">${label}</div><div style="font-size:22px;font-weight:700;letter-spacing:-.02em">${value}</div></td>`;
      const body = `
        <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px 20px"><tr>
          ${metric("Calls yesterday", calls.toLocaleString("en-US"))}${metric("Answer rate", rate)}${metric("Open alerts", String(openAlerts.length))}
        </tr></table>
        <p style="margin:0 0 6px;font-size:14px;color:#33383F"><strong>Pool:</strong> ${poolCounts}${(pool.data ?? []).some((d) => d.manual_hold) ? ` · Held ${(pool.data ?? []).filter((d) => d.manual_hold).length}` : ""}</p>
        <p style="margin:0 0 6px;font-size:14px;color:#33383F"><strong>Last 24 hours:</strong> ${opened.count ?? 0} alerts opened, ${resolved.count ?? 0} resolved</p>
        <p style="margin:0 0 20px;font-size:14px;color:#33383F"><strong>Dialer sync:</strong> ${escapeHtml(lastSync)}</p>
        ${openAlerts.length ? `<h2 style="margin:0 0 4px;font-size:16px">Open alerts</h2>${alertRows(openAlerts.slice(0, 25))}${openAlerts.length > 25 ? `<p style="font-size:13px;color:#60646C">…and ${openAlerts.length - 25} more.</p>` : ""}` : `<p style="margin:0;font-size:14px;color:#138A43"><strong>No open alerts.</strong> Every number is within its limits.</p>`}`;

      const subject = `Dialer daily summary: ${critical ? `${critical} critical, ` : ""}${openAlerts.length} open alert${openAlerts.length === 1 ? "" : "s"}`;
      try {
        await sendEmail(recipients, subject, layout(`Daily summary for ${et.day}`, "Caller-ID pool health from the last day of dialing.", body, appUrl, "Open the dashboard"));
        await db.from("notification_log").insert({ kind: "digest", status: "sent", recipients, subject, digest_day: et.day, alert_ids: openAlerts.map((a) => a.id) });
        summary.digest = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.errors.push(msg);
        await db.from("notification_log").insert({ kind: "digest", status: "failed", recipients, subject, digest_day: et.day, error: msg });
      }
    }
  }

  await db
    .from("notification_settings")
    .update({ last_run_at: new Date().toISOString(), last_error: summary.errors.length ? summary.errors.join(" | ").slice(0, 1000) : null })
    .eq("id", true);

  return Response.json(summary, { status: summary.errors.length ? 502 : 200 });
});
