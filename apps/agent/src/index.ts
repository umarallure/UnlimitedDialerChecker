import { createClient } from "@supabase/supabase-js";
import { loadConfig } from "./config";
import { syncCampaigns } from "./campaigns";
import { runRotation } from "./rotation";
import { syncLive, syncStats } from "./sync";
import { createPool } from "./vicidial";

const VERSION = "0.3.0";

function log(level: "info" | "error", msg: string, extra?: unknown) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${msg}`;
  if (level === "error") console.error(line, extra ?? "");
  else console.log(line);
}

/** Run `fn` every `intervalMs`, never overlapping, backing off (max 5 min) after consecutive failures. */
function loop(name: string, intervalMs: number, fn: () => Promise<string | void>) {
  let failures = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    const started = Date.now();
    try {
      const summary = await fn();
      if (failures > 0) log("info", `${name}: recovered after ${failures} failure(s)`);
      failures = 0;
      if (summary) log("info", `${name}: ${summary} (${Date.now() - started} ms)`);
    } catch (err) {
      failures++;
      log("error", `${name}: failed (${failures} in a row)`, err instanceof Error ? err.message : err);
    }
    if (stopped) return;
    const delay = failures ? Math.min(intervalMs * 2 ** failures, 300_000) : intervalMs;
    timer = setTimeout(tick, delay);
  };

  tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function main() {
  const cfg = loadConfig();
  const pool = createPool(cfg.mysql);
  const db = createClient(cfg.supabaseUrl, cfg.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  log(
    "info",
    `dialer-agent ${VERSION} starting: dialer=${cfg.dialerName} live=${cfg.liveIntervalMs}ms stats=${cfg.statsIntervalMs}ms cidOverride=${cfg.cidOverride ? "set" : "none"}`,
  );

  const statsState = { callsCursor: null as Date | null, lastPurge: 0 };
  let liveTicks = 0;

  const stopLive = loop("live", cfg.liveIntervalMs, async () => {
    const n = await syncLive(db, pool, cfg, VERSION);
    // Log the live loop about once a minute (every tick when the interval is a minute or longer).
    const every = Math.max(1, Math.round(60_000 / cfg.liveIntervalMs));
    if (liveTicks++ % every === 0) return `${n} agent(s) logged in`;
  });

  const stopStats = loop("stats", cfg.statsIntervalMs, async () => {
    const r = await syncStats(db, pool, cfg, statsState);
    const campaigns = await syncCampaigns(db, pool);
    return `${r.callsToday} call(s) today across ${r.callerIds} caller ID(s), ${r.feed} feed row(s) upserted, ${campaigns} campaign(s) synced`;
  });

  const stopRotation = loop("rotation", cfg.rotationIntervalMs, async () => {
    const r = await runRotation(db, pool, cfg);
    const cid = r.cidRows ? `, ${r.cidRows} caller ID row(s) changed` : "";
    return `${r.mode}: ${r.evaluated} number(s) evaluated, ${r.proposals} proposal(s), ${r.applied} applied${cid}`;
  });

  const shutdown = async (signal: string) => {
    log("info", `${signal} received, stopping`);
    stopLive();
    stopStats();
    stopRotation();
    await db.from("dialers").update({ status: "stopped" }).eq("name", cfg.dialerName);
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log("error", "fatal startup error", err instanceof Error ? err.message : err);
  process.exit(1);
});
