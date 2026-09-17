# CLAUDE.md

## Visual language
Follow the design system strictly: @DESIGN.md

## Next.js
The web app lives in `apps/web` and uses a Next.js version with breaking changes. Follow `apps/web/AGENTS.md` and read `apps/web/node_modules/next/dist/docs/` before writing Next.js code.

## Public repository
Never commit dialer hostnames, IPs, phone numbers or keys. Use environment variables.

## Private docs
`docs/private/` is gitignored and holds the real server details: `vicidial-server-log.md` (log every change made on the dialer server here, then copy it to `/root/SERVER-CHANGELOG.md` on the server), `dialer-control-app-plan.md` (full plan; `docs/PLAN.md` is the sanitized public copy) and `vicidial-crm-integration-plan.md`.
