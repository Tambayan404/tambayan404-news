# t404-news

HN-style daily link digest for the Tambayan 404 Discord. Astro 7 SSR on Cloudflare Workers, D1 storage,
cron-driven ingest via the Discord REST API (no gateway/bot process). See README.md for setup and the
data flow; `src/lib/ingest.ts` is the heart of the ingest job.

## Ask before acting

Never run a state-changing or outward-facing command without explicit permission from the human user
first. Propose the exact command, wait for a yes, then run it. A yes covers that one action, not the
next one of the same kind.

Always ask first:

- Git history and remotes: `git commit`, `git push`, `git rebase`, `git merge`, `git reset --hard`,
  `git checkout`/`git restore` over uncommitted work, `git stash drop`, tag or branch deletion,
  force-pushes of any kind.
- Cloudflare: `wrangler deploy`, `pnpm deploy`, `wrangler secret put`/`delete`, `wrangler d1 execute`
  or `d1 migrations apply` with `--remote`, KV/D1 resource creation or deletion, `wrangler rollback`.
- Anything that leaves the machine: hitting production `/api/ingest`, posting to Discord, calling the
  Cloudflare API, opening or commenting on PRs and issues, installing global tooling.
- Destructive local edits: deleting or overwriting files you did not create in this session, wiping
  `.wrangler/` local D1 state, rewriting `.dev.vars`.

Safe to run unprompted: reads and inspections (`git status`, `git diff`, `git log`, `cat`, `grep`),
`pnpm build`, `pnpm format`, local dev server commands, and local-only D1 work (`pnpm db:migrate:local`,
`wrangler d1 execute DB --local`).

Staging edits is fine; committing them is not. When work is ready, summarize what changed and let the
user decide whether to commit, push, or deploy.

## Development

Start the dev server in background mode:

```
astro dev --background
```

Manage it with `astro dev stop`, `astro dev status`, and `astro dev logs`.

- `pnpm build` runs `wrangler types` + `astro check` + `astro build`; keep it green.
- Local D1: `pnpm db:migrate:local`. Seed rows with `pnpm wrangler d1 execute DB --local --command "..."`.
- Secrets for local dev go in `.dev.vars` (gitignored); their types are declared in `src/env.d.ts`.
- Cloudflare bindings are read with `import { env } from 'cloudflare:workers'`, not `Astro.locals.runtime`.
- `POST /api/ingest` needs `Content-Type: application/json` plus `Authorization: Bearer <INGEST_SECRET>`.

## Constraints to keep in mind

- Workers free plan: 50 subrequests per invocation → the ingest has a budget and a round-robin channel
  cursor (`sync_state.channel_cursor`). Don't add unbounded fetch loops.
- Product rules: no accounts, no votes, no comments. Reaction counts are read-only sums from Discord.

## Documentation

- https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- https://developers.cloudflare.com/d1/
- https://discord.com/developers/docs/resources/message#get-channel-messages
