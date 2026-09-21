import { NextResponse } from "next/server";
import { getAgentForApi } from "@/lib/dal";
import { AgentApiNotConfigured, agentApi, isAgentFunction } from "@/lib/vicidial/agent-api";

/**
 * Everything the dialer screen asks VICIdial to do.
 *
 * The agent whose session is affected comes from the caller's own roster row, never from the
 * request body. Without that, any signed-in agent could hang up someone else's call by naming
 * them — the API takes `agent_user` as a plain parameter and asks no further questions.
 */

export const dynamic = "force-dynamic";

/** Per-function parameters we pass through, with what VICIdial expects them to look like. */
const PARAM_RULES: Record<string, RegExp> = {
  // A disposition code, a pause state (PAUSE/RESUME), a number to dial, DTMF digits.
  value: /^[A-Za-z0-9*#+_-]{1,30}$/,
  phone_code: /^\d{1,4}$/,
  lead_id: /^\d{1,12}$/,
  search: /^(YES|NO)$/,
  preview: /^(YES|NO)$/,
  focus: /^(YES|NO)$/,
  pause_code: /^[A-Z0-9_]{1,12}$/,
};

export async function POST(request: Request) {
  const { agent, status } = await getAgentForApi();
  if (!agent) {
    return NextResponse.json({ error: status === 401 ? "Not signed in." : "Not an agent." }, { status });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const fn = (body as { function?: unknown }).function;
  if (!isAgentFunction(fn)) {
    return NextResponse.json({ error: "That is not something this screen may do." }, { status: 400 });
  }

  const params: Record<string, string> = {};
  for (const [key, rule] of Object.entries(PARAM_RULES)) {
    const value = (body as Record<string, unknown>)[key];
    if (value === undefined || value === null || value === "") continue;
    const text = String(value);
    if (!rule.test(text)) {
      return NextResponse.json({ error: `"${key}" is not in a form the dialer accepts.` }, { status: 400 });
    }
    params[key] = text;
  }

  try {
    const result = await agentApi(fn, agent.agentUser, params);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    if (err instanceof AgentApiNotConfigured) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}
