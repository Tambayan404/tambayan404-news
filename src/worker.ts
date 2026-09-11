/// <reference path="../worker-configuration.d.ts" />
import { handle } from '@astrojs/cloudflare/handler';
import { runIngest } from './lib/ingest';

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runIngest(env).then(
        (r) => console.log('ingest', JSON.stringify(r)),
        (e) => console.error('ingest failed', e),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
