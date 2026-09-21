import "server-only";

/**
 * VICIdial's Agent API, reached through the authenticated gateway on the dialer.
 *
 * Three rules hold this together:
 *
 * 1. **Never from the browser.** `api.php` takes an administrative username and password as
 *    request parameters. Those live in this process's environment and go no further. A page asks
 *    our own route handler, which asks this.
 * 2. **Always POST.** A GET would write the API password into the dialer's access log, which is
 *    the same reason `apps/agent/src/vicidial-api.ts` refuses GET.
 * 3. **Allowlisted functions only.** The gateway cannot inspect a query string, so the list of
 *    things an agent screen may be told to do is enforced here.
 *
 * The API acts on an *existing* agent session — it cannot create one. The session comes from the
 * agent screen running in the hidden frame; if that is not loaded, every call here fails.
 */

/** What our UI is allowed to ask for. Anything absent is refused before a request is made. */
export const AGENT_FUNCTIONS = [
  "version",
  "external_dial",
  "external_hangup",
  "external_status",
  "external_pause",
  "preview_dial_action",
  "send_dtmf",
  "pause_code",
  "calls_in_queue_count",
  "logout",
] as const;

export type AgentFunction = (typeof AGENT_FUNCTIONS)[number];

export function isAgentFunction(value: unknown): value is AgentFunction {
  return typeof value === "string" && (AGENT_FUNCTIONS as readonly string[]).includes(value);
}

export type AgentApiResult = {
  ok: boolean;
  /** The raw line VICIdial returned, kept for the UI and for logs. */
  text: string;
  /** Pipe-delimited rows, for functions that return data rather than a status. */
  rows: string[][];
  error?: string;
};

const TIMEOUT_MS = 10_000;

type Config = {
  url: string;
  apiUser: string;
  apiPass: string;
  gatewayUser: string;
  gatewayPass: string;
  source: string;
};

export class AgentApiNotConfigured extends Error {}

function config(): Config {
  const url = process.env.VICIDIAL_AGENT_API_URL;
  const apiUser = process.env.VICIDIAL_API_USER;
  const apiPass = process.env.VICIDIAL_API_PASS;
  const gatewayUser = process.env.VICIDIAL_GATEWAY_USER;
  const gatewayPass = process.env.VICIDIAL_GATEWAY_PASS;

  if (!url || !apiUser || !apiPass || !gatewayUser || !gatewayPass) {
    throw new AgentApiNotConfigured(
      "The dialer connection is not configured on this deployment (VICIDIAL_AGENT_API_URL, VICIDIAL_API_USER, VICIDIAL_API_PASS, VICIDIAL_GATEWAY_USER, VICIDIAL_GATEWAY_PASS).",
    );
  }
  if (!url.startsWith("https://")) {
    // Basic credentials over plain HTTP are base64, not a secret.
    throw new AgentApiNotConfigured("The agent API gateway must be an https address.");
  }

  return { url, apiUser, apiPass, gatewayUser, gatewayPass, source: "udc-dialer" };
}

/**
 * VICIdial answers in text: "SUCCESS: ...", "ERROR: ...", or pipe-delimited rows for the
 * functions that return data. Anything else is treated as a failure rather than guessed at.
 */
export function parseAgentResponse(body: string): AgentApiResult {
  const text = body.trim();
  if (!text) return { ok: false, text: "", rows: [], error: "The dialer returned nothing." };

  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.includes("|"))
    .map((line) => line.split("|").map((cell) => cell.trim()));

  if (/^ERROR/i.test(text)) {
    return { ok: false, text, rows, error: text.replace(/^ERROR:?\s*/i, "") };
  }
  if (/^SUCCESS/i.test(text) || rows.length > 0) {
    return { ok: true, text, rows };
  }
  return { ok: false, text, rows, error: text };
}

/**
 * Send one command to one agent's session.
 *
 * `agentUser` is always resolved from the caller's own roster row by the route handler — it is
 * never taken from a request body, or one agent could hang up another's call.
 */
export async function agentApi(
  fn: AgentFunction,
  agentUser: string,
  params: Record<string, string> = {},
): Promise<AgentApiResult> {
  const cfg = config();

  const body = new URLSearchParams({
    source: cfg.source,
    user: cfg.apiUser,
    pass: cfg.apiPass,
    agent_user: agentUser,
    function: fn,
    ...params,
  });

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${cfg.gatewayUser}:${cfg.gatewayPass}`).toString("base64")}`,
      },
      body,
      signal,
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return {
      ok: false,
      text: "",
      rows: [],
      error: timedOut ? "The dialer did not answer in time." : "Could not reach the dialer.",
    };
  }

  if (res.status === 401) {
    return { ok: false, text: "", rows: [], error: "The dialer refused our gateway credentials." };
  }
  if (!res.ok) {
    return { ok: false, text: "", rows: [], error: `The dialer answered ${res.status}.` };
  }

  return parseAgentResponse(await res.text());
}

/** The one call that needs no session: proves the gateway and credentials work. */
export async function pingAgentApi(): Promise<AgentApiResult> {
  return agentApi("version", "-");
}
