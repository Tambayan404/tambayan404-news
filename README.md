# Tambayan 404 News

A Hacker News–style front page for every link shared on the Tambayan 404 Discord server, grouped by day.
No accounts, no votes, no comments: each entry links to the article, shows how many emoji reactions the
original Discord message earned, and offers a jump back to that message.

**Stack:** Astro 7 (SSR) · Cloudflare Workers · D1 (SQLite) · a Cron Trigger that polls the Discord REST API.

## How it works

```
Discord REST API  ──(cron, every 5 min)──▶  Worker `scheduled()`  ──▶  D1 `links` table
                                                                          │
                              browser  ◀──── Astro pages (SSR on Workers) ◀┘
```

- `src/lib/ingest.ts` lists the guild's text channels, announcement channels and active threads, fetches
  messages from the last `LOOKBACK_HOURS`, extracts `http(s)` links, sums every emoji reaction on the
  message, and upserts into D1. Re-fetching the lookback window each run keeps reaction counts fresh.
- Every run has a `SUBREQUEST_BUDGET` (Workers free plan allows 50 subrequests per invocation). Channels are
  walked round-robin from a stored cursor, so a large server is still fully covered over a few runs.
- Titles come from Discord's own link embed when present; otherwise a small fetch reads `og:title` /
  `<title>` in a later pass. GIF hosts, Discord links and media CDNs are ignored.
- Pages: `/` (front page: all links newest day first, 30 per page, `?p=2` for more), `/day/YYYY-MM-DD`,
  `/past`, plus an RSS feed of the 50 newest links at `/rss`. Days are bucketed in `SITE_TZ` (Asia/Manila).

## Setup

### 1. Discord bot

1. Go to <https://discord.com/developers/applications> → **New Application** → name it (e.g. `t404-news`).
2. **Bot** tab → **Reset Token** → copy the token (this is `DISCORD_BOT_TOKEN`). Under *Privileged
   Gateway Intents* enable **Message Content Intent**: without it Discord returns every message with
   empty `content`, even over REST, and no links are ever found. Turn **Public Bot** off.
3. **OAuth2 → URL Generator**: scope `bot`; permissions **View Channels** and **Read Message History**.
   Open the generated URL and add the bot to the server.
4. Server → **Server Settings → Widget** (or right-click the server icon with Developer Mode on) →
   **Copy Server ID**. This is `DISCORD_GUILD_ID`.
5. Optional: to keep a channel out of the site, deny the bot's role **View Channel** on that channel.

### 2. Cloudflare

```sh
pnpm install
pnpm wrangler login
pnpm wrangler d1 create t404-news        # paste the printed database_id into wrangler.jsonc
```

Edit `wrangler.jsonc`: set `database_id` and `DISCORD_GUILD_ID`.

```sh
pnpm wrangler secret put DISCORD_BOT_TOKEN
pnpm wrangler secret put INGEST_SECRET   # any random string; guards POST /api/ingest
pnpm db:migrate:remote
pnpm run deploy   # "run" is required: pnpm has a built-in "deploy" command
```

Then kick off the first backfill instead of waiting for the cron:

```sh
curl -X POST -H "Content-Type: application/json" \
     -H "Authorization: Bearer <INGEST_SECRET>" https://t404-news.<you>.workers.dev/api/ingest
```

The response is a JSON report (`channelsScanned`, `linksUpserted`, `budgetExhausted`, `errors`…).
If `budgetExhausted` is true, just call it again; each call continues from where the last one stopped.

### 3. Local development

```sh
cp .dev.vars.example .dev.vars   # fill in DISCORD_BOT_TOKEN and INGEST_SECRET
pnpm db:migrate:local
pnpm dev                      # http://localhost:4321
curl -X POST -H "Content-Type: application/json" \
     -H "Authorization: Bearer <INGEST_SECRET>" http://localhost:4321/api/ingest
```

To exercise the real cron path (the built Worker's `scheduled()` handler) instead of the API route:

```sh
pnpm dev:worker    # builds, then runs the Worker in wrangler on http://localhost:8787
pnpm cron:local    # in another terminal: fires the cron once; watch the wrangler log for the report
```

Local D1 state lives in `.wrangler/state/` (gitignored) and is shared by both dev modes.

## Configuration (`wrangler.jsonc` → `vars`)

| Var | Default | Meaning |
|---|---|---|
| `SITE_NAME` | Tambayan 404 News | Header / page titles |
| `SITE_TZ` | Asia/Manila | Timezone used to decide which day a link belongs to |
| `DISCORD_GUILD_ID` | — | The server to read from |
| `LOOKBACK_HOURS` | 72 | How far back each run re-reads messages (also how long reaction counts keep updating) |
| `SUBREQUEST_BUDGET` | 40 | Max outbound requests per cron run; keep under 50 on the free plan, can go to ~900 on paid |
| `SKIP_BOT_AUTHORS` | true | Ignore links posted by bots/webhooks |

Cron cadence is in `triggers.crons` (default every 5 minutes).

## Project layout

```
src/worker.ts            Worker entry: fetch → Astro, scheduled → ingest
src/lib/ingest.ts        Cron job
src/lib/discord.ts       Tiny Discord REST client + budget/rate-limit handling
src/lib/links.ts         URL extraction & normalization
src/lib/title.ts         og:title / <title> fetcher (HTMLRewriter)
src/lib/db.ts            D1 queries
src/pages/               index, day/[day], past, rss, api/ingest
migrations/              D1 schema
```
