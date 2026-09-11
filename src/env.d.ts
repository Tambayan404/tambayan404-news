// Secrets are not part of `wrangler types` output (they live in `.dev.vars` / `wrangler secret`),
// so declare them here to keep both the global `Env` and `cloudflare:workers` `env` fully typed.
interface __SecretsEnv {
  DISCORD_GUILD_ID: string;
  DISCORD_BOT_TOKEN: string;
  INGEST_SECRET: string;
}
interface Env extends __SecretsEnv {}
declare namespace Cloudflare {
  interface Env extends __SecretsEnv {}
}
