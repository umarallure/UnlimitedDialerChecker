import "server-only";
import { Client } from "pg";
import { createClient } from "@/lib/supabase/server";

/**
 * Connects to a CRM database to read leads.
 *
 * The connection string is fetched from Vault for the length of one query and is never returned
 * to the browser. Every connection is opened read-only and with a statement timeout, so a bad
 * filter against a large table cannot sit on the CRM's database.
 */

const CONNECT_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 20_000;

export type CrmColumn = { name: string; type: string; nullable: boolean };

/** A Supabase connection string points at their database; SSL is required and their certificate
 *  is signed by a CA we do not bundle, so verification is relaxed exactly as psql does by default. */
function clientFor(connectionString: string): Client {
  return new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    application_name: "unlimited-dialer-checker",
  });
}

export async function connectionStringFor(connectionId: string): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("crm_connection_string", { p_id: connectionId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That connection no longer exists.");
  return data as string;
}

/**
 * Run `fn` against the CRM with a connection that cannot write.
 * The read-only transaction is a second line of defence: the role we ask people to create only
 * has SELECT, but if someone connects with a stronger account by mistake, this still refuses
 * to modify anything.
 */
export async function withCrm<T>(connectionId: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = clientFor(await connectionStringFor(connectionId));
  await client.connect();
  try {
    await client.query("begin read only");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Same, for a connection string that has not been saved yet — used when testing one. */
export async function withRawCrm<T>(connectionString: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = clientFor(connectionString);
  await client.connect();
  try {
    await client.query("begin read only");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Tables the connected role may actually read. A role with no grants sees nothing, which is
 *  the clearest possible signal that the read-only setup has not been finished. */
export async function listTables(client: Client, schema: string): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = $1
        and table_type in ('BASE TABLE', 'VIEW')
        and has_table_privilege(format('%I.%I', table_schema, table_name), 'SELECT')
      order by table_name`,
    [schema],
  );
  return rows.map((r) => r.table_name);
}

export async function listColumns(client: Client, schema: string, table: string): Promise<CrmColumn[]> {
  const { rows } = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema = $1 and table_name = $2
      order by ordinal_position`,
    [schema, table],
  );
  return rows.map((r) => ({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === "YES" }));
}

/** Turns a driver error into something an operator can act on. */
export function explainCrmError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/password authentication failed/i.test(message)) return "Wrong username or password in the connection string.";
  if (/no pg_hba\.conf entry|SSL/i.test(message)) return "The database refused the connection. Check that it accepts connections from outside and that SSL is enabled.";
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(message)) return "That host could not be found. Check the connection string.";
  if (/ETIMEDOUT|timeout expired|connect ETIMEDOUT/i.test(message)) return "The database did not answer in time. If it is a Supabase project, use the pooler connection string.";
  if (/permission denied for/i.test(message)) return `${message}. Grant SELECT on that table to the read-only role.`;
  if (/statement timeout/i.test(message)) return "That query took too long. Narrow the filters or lower the limit.";
  if (/does not exist/i.test(message)) return message;
  return message;
}
