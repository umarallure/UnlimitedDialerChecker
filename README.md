# Unlimited Dialer Checker

Internal super-admin app for a VICIdial outbound dialer:

- **Number health:** caller-ID DIDs, lifecycle (NEW → WARMING → ACTIVE → COOLING → RETIRED), calls vs caps, answer rate, short calls, SIP rejects, reputation scans.
- **Rotation:** per-DID daily/hourly caps and automatic cool-off, enforced on the dialer by a small agent (dry run first).
- **Live agents:** who is ready, in call or paused.

See [docs/PLAN.md](docs/PLAN.md) for the full plan.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js admin UI (Vercel) |
| `apps/agent` | Dialer-side sync/enforcement service (Phase 1, not built yet) |
| `packages/policy` | Pure lifecycle and cap rules, unit-tested, shared by web and agent |
| `supabase/migrations` | Database schema, RLS (admin + MFA only), Realtime |

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # fill in Supabase URL + publishable key
pnpm dev
```

1. Apply `supabase/migrations/*` to the Supabase project (Supabase CLI `supabase db push`, or the SQL editor).
2. In Supabase Auth: disable public sign-ups, enable TOTP MFA, create your user (Authentication → Users → Add user).
3. Add yourself to the allowlist:
   ```sql
   insert into public.admins (user_id, email)
   select id, email from auth.users where email = 'you@example.com';
   ```
4. Sign in at `/login`, enroll an authenticator app at `/mfa`.

## Security notes

This repository is public. Never commit dialer hostnames, IPs, phone numbers, or keys. They belong in environment variables (`.env.local`, Vercel env, `/etc/dialer-agent.env` on the dialer).
