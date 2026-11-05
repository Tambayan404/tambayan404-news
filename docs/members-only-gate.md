# Members-only gate (Discord login)

Status: built and tested locally, **not deployed**. A real Discord login has not been exercised yet,
because that needs the OAuth client secret. Thread: https://ampcode.com/threads/T-01a1a37a-9fd7-7329-b90d-9f108a253a93

## Why

Pre-prod check: the site should only be readable by members of the Tambayan 404 Discord server, not by
anyone with the URL. RSS still has to work in feed readers, which can't log in.

## How it works

1. **Login** (`src/pages/auth/login.ts`): redirects to Discord OAuth2 with the `identify` scope only. A
   random `state` value is kept in a short-lived HttpOnly cookie scoped to `/auth/`, along with the
   page to return to (`next`).
2. **Callback** (`src/pages/auth/callback.ts`): checks `state`, exchanges the code for the user id
   (`/users/@me`), then asks Discord **as the bot** (`GET /guilds/{id}/members/{user}`) whether that user
   is in the server. A 404 or `pending: true` (hasn't passed membership screening) means no access. The
   OAuth access token is thrown away; only the user id is kept.
3. **Session**: an HMAC-SHA256 signed cookie `__Host-t404_session` holding `{uid, chk}`, where `chk` is
   when membership was last confirmed. Signed with `SESSION_SECRET` via Web Crypto. No accounts table.
4. **Gate** (`src/middleware.ts`): every route except `/auth/*`, `/api/ingest` (own bearer secret) and
   `/rss` (own key) requires a valid session. Anonymous GETs redirect to login; other methods get 401.
   The cron ingest is unaffected because it runs through `scheduled()`, not `fetch`.
5. **Re-check every 3 days** (`refreshSession` / `memberStatus` in `src/lib/auth.ts`): once `chk` is older
   than 3 days, the next request consults the D1 `members` table and, if that's stale too, asks Discord.
   - If Discord is unreachable or rate-limiting, the last good answer is honoured for up to 6 days.
   - A session unused for 6+ days must log in again (no Discord call).
   - At most one Discord call per user per minute, recorded in `members.attempted_at`, so replaying an old
     cookie can't hammer the bot token (which ingest also uses).
6. **RSS** (`src/pages/feed.astro`, `src/pages/rss.ts`): the header's "rss" link opens `/feed`, which shows a
   personal URL `/rss?key=<uid>.<HMAC(FEED_SECRET, "feed:"+uid)>` with a Copy button. `/rss` verifies the
   signature, then uses the same `members` table and 3-day re-check. A leaver's feed returns 403 within
   3 days.

Pages now send `Cache-Control: private, …` instead of `public, s-maxage=…`.

## Compute cost

- Normal page view: one HMAC verify (~41 µs measured in Node), no D1, no Discord.
- Login: 2 Worker requests + 3 Discord calls, once per person.
- Re-check: 1 D1 read, plus 1 Discord call and 1 D1 write every 3 days per active user.
- RSS poll: 1 HMAC verify + 1 D1 read; 1 Discord call every 3 days per subscriber.
- Anonymous visitors/crawlers: a redirect with no D1 query (cheaper than today).

## Security review

A separate review was run on the first version. Findings and what was done:

| Finding                                                                                   | Fix                                                                                           |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| High: `preview_urls: true` keeps older, ungated versions publicly reachable               | `preview_urls: false` in `wrangler.jsonc` (takes effect on deploy; old URLs not verified)     |
| Medium: `next=/%09/evil.example` passed the return-path check → open redirect after login | `safeNext` now parses with `new URL()` like a browser and only keeps same-origin paths        |
| Medium: replaying a stale cookie forced a Discord call per request; 429s extended grace   | D1 `members` cache, 1 call/user/minute throttle, sessions older than 6 days rejected outright |
| Low: malformed base64 signature threw → 500                                               | `unb64url` returns null on decode errors                                                      |
| Low: feed key computed on every page; missing `FEED_SECRET` broke all pages               | Key only rendered on `/feed`                                                                  |
| Low: `/rss/` and `/api/ingest/` with trailing slash were gated                            | Middleware strips one trailing slash before matching                                          |
| Hardening                                                                                 | `__Host-` cookie, always `Secure`, 5 s timeout on Discord calls, tidy `atom:link` self URL    |

Found sound: signature checks (constant-time Web Crypto verify, payload authenticated before parsing),
domain separation between session and feed keys, OAuth state / login CSRF, middleware allowlist (encoded or
case variants fail closed), static assets, Astro's origin check, the 50-subrequest limit.

## Known gaps / open decisions

- No logout button. With `prompt=none`, Discord would sign returning members straight back in anyway.
- No per-user revocation: rotating `SESSION_SECRET` signs everyone out; rotating `FEED_SECRET` breaks every
  feed link.
- OAuth state is single-use only in the browser; a rate-limit rule on `/auth/callback` would bound
  token-exchange abuse.
- 401/403 from Discord (bad bot token, bot removed) is treated like "Discord down" for the 6-day grace.
- README still says "No accounts" — true in the sense of no sign-ups; reword if wanted.

## To deploy

1. Discord application → **OAuth2**: copy the Client ID, reset the client secret, add redirects
   `https://<site>/auth/callback` (and `http://localhost:4321/auth/callback`,
   `http://localhost:8787/auth/callback` for local dev).
2. `pnpm wrangler secret put` for `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`,
   `FEED_SECRET` (the last two: long random strings). Add them to `.dev.vars` locally.
3. `pnpm db:migrate:remote` **before** deploying (creates `members`), otherwise every login 500s.
4. `pnpm run deploy`, then log in with a member account and a non-member account, and add the `/feed`
   link to a reader.

## Files

- `src/lib/auth.ts` — signing, sessions, feed keys, membership checks, OAuth helpers
- `src/middleware.ts` — the gate
- `src/pages/auth/login.ts`, `src/pages/auth/callback.ts` — OAuth flow
- `src/pages/feed.astro` — personal feed link page; `src/pages/rss.ts` — key-guarded feed
- `src/lib/db.ts` — `getMember` / `setMember` / `markMemberAttempt`; `migrations/0002_members.sql`
- `src/env.d.ts`, `.dev.vars.example`, `README.md`, `wrangler.jsonc`, cache headers in `src/pages/*.astro`
