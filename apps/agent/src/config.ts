import { normalizeCid } from "./cid";
import type { ApiConfig } from "./vicidial-api";

export type Config = {
  dialerName: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  mysql: { host: string; port: number; user: string; password: string; database: string };
  /** Attribute calls whose logged CID is invalid (e.g. 0000000000) to this number, while the dial plan forces a caller ID. */
  cidOverride: string | null;
  /** CID group whose entries the engine keeps in step; unset means never touch VICIdial caller IDs. */
  cidGroupId: string | null;
  liveIntervalMs: number;
  statsIntervalMs: number;
  rotationIntervalMs: number;
  commandIntervalMs: number;
  /** VICIdial API credentials, or null when the dialer has not been given any. */
  api: ApiConfig | null;
  shortCallSeconds: number;
  recentCallDays: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name} (see /etc/dialer-agent.env)`);
  return value;
}

export function loadConfig(): Config {
  const override = process.env.CID_OVERRIDE ? normalizeCid(process.env.CID_OVERRIDE) : null;
  if (process.env.CID_OVERRIDE && !override) {
    throw new Error("CID_OVERRIDE is set but is not a valid US number (expected +1NXXNXXXXXX)");
  }
  return {
    dialerName: process.env.DIALER_NAME ?? "primary",
    supabaseUrl: required("SUPABASE_URL"),
    supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    mysql: {
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: required("MYSQL_USER"),
      password: required("MYSQL_PASSWORD"),
      database: process.env.MYSQL_DATABASE ?? "asterisk",
    },
    cidOverride: override,
    cidGroupId: process.env.CID_GROUP_ID || null,
    liveIntervalMs: Number(process.env.LIVE_INTERVAL_MS ?? 5000),
    statsIntervalMs: Number(process.env.STATS_INTERVAL_MS ?? 60000),
    rotationIntervalMs: Number(process.env.ROTATION_INTERVAL_MS ?? 900000),
    commandIntervalMs: Number(process.env.COMMAND_INTERVAL_MS ?? 3000),
    api:
      process.env.VICIDIAL_API_USER && process.env.VICIDIAL_API_PASS
        ? {
            url: process.env.VICIDIAL_API_URL ?? "http://127.0.0.1/vicidial/non_agent_api.php",
            user: process.env.VICIDIAL_API_USER,
            pass: process.env.VICIDIAL_API_PASS,
            source: process.env.VICIDIAL_API_SOURCE ?? "udc",
          }
        : null,
    shortCallSeconds: Number(process.env.SHORT_CALL_SECONDS ?? 6),
    recentCallDays: Number(process.env.RECENT_CALL_DAYS ?? 7),
  };
}
