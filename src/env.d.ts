// Secrets are not part of `wrangler types` output (they live in `.dev.vars` / `wrangler secret`),
// so declare them here to keep both the global `Env` and `cloudflare:workers` `env` fully typed.
interface __SecretsEnv {
  DISCORD_GUILD_ID: string;
  DISCORD_BOT_TOKEN: string;
  INGEST_SECRET: string;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  FEED_SECRET: string;
}
interface Env extends __SecretsEnv {}
declare namespace Cloudflare {
  interface Env extends __SecretsEnv {}
}
declare namespace App {
  interface Locals {
    /** Discord user id of the signed-in member; set by src/middleware.ts on gated routes. */
    uid?: string;
  }
}
