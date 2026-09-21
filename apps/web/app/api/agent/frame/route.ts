import { NextResponse } from "next/server";
import { getAgentForApi } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * The document that logs an agent into VICIdial, loaded inside the hidden frame.
 *
 * This exists so four credentials never enter the dialer page itself. The page only points an
 * iframe at this route; the browser fetches it with the agent's own session cookie, and the
 * credentials live and die inside that frame's document.
 *
 * They are POSTed, not put on a URL. VICIdial's own example (extras/crm_iframe/front.php) builds
 * a GET, which writes the agent's password, the phone's password and both logins into browser
 * history and the dialer's Apache access log. Confirmed at agc/vicidial.php:786-791 that POST is
 * accepted just the same.
 */

export const dynamic = "force-dynamic";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function page(body: string): NextResponse {
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dialer</title>` + body + `</html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Never cached, never shared: this document carries credentials.
      "cache-control": "no-store, no-cache, must-revalidate, private",
      "referrer-policy": "no-referrer",
    },
  });
}

function message(text: string): NextResponse {
  return page(
    `<body style="font:14px/1.5 system-ui;margin:0;padding:24px;color:#33383f;background:#f6f7f9">${escapeAttr(text)}</body>`,
  );
}

export async function GET() {
  const { agent, status } = await getAgentForApi();
  if (!agent) {
    return message(status === 401 ? "Please sign in again." : "This account is not set up as an agent.");
  }

  const screenUrl = process.env.VICIDIAL_AGENT_SCREEN_URL;
  if (!screenUrl || !screenUrl.startsWith("https://")) {
    return message("The dialer address is not configured on this deployment (VICIDIAL_AGENT_SCREEN_URL).");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agent_session");
  const session = Array.isArray(data) ? data[0] : data;
  if (error || !session) {
    return message("Your dialer credentials are missing. Ask an administrator to set them up.");
  }

  const fields: Record<string, string> = {
    phone_login: session.phone_login ?? "",
    phone_pass: session.phone_pass ?? "",
    VD_login: session.agent_user ?? "",
    VD_pass: session.agent_pass ?? "",
    VD_campaign: session.campaign_id ?? "",
  };
  if (process.env.VICIDIAL_DB) fields.DB = process.env.VICIDIAL_DB;

  const inputs = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${escapeAttr(name)}" value="${escapeAttr(value)}">`)
    .join("");

  // Submitted on load, then the VICIdial agent screen owns this document for the rest of the shift.
  return page(
    `<body style="margin:0">` +
      `<form id="f" method="post" action="${escapeAttr(screenUrl)}">${inputs}</form>` +
      `<script>document.getElementById("f").submit();</script>` +
      `</body>`,
  );
}
