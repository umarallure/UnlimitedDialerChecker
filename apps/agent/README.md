# Dialer agent (Phase 1)

Runs **on the VICIdial server** as a systemd service (Node 22). Not built yet — this folder is a placeholder.

Responsibilities, in build order:

1. **Sync (read-only):** `vicidial_live_agents` → `agents_live` every 5 s; per-DID counters from
   `vicidial_dial_cid_log` ⨝ `vicidial_log_extended` ⨝ `vicidial_log` / `vicidial_dial_log` → `did_stats_live` every 60 s;
   nightly `did_stats_daily`; 7-day `calls_recent`; heartbeat on `dialers`.
2. **Enforce:** apply `@udc/policy` caps by toggling `active` in `vicidial_campaign_cid_areacodes`
   (logs only while the active policy is `dry_run`).
3. **Commands:** execute rows from `commands` (hold/release/force cool/retire/set cap/resync).

Runs with two local MySQL users: read-only for sync, and a user limited to the CID tables for enforcement.
Configuration comes from `/etc/dialer-agent.env` (root-only), never from this repo.
