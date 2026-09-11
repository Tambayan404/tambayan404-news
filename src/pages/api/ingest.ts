/**
 * Manual ingest trigger, for local dev and for a first backfill right after deploying:
 *
 *   curl -X POST -H "Content-Type: application/json" \
 *        -H "Authorization: Bearer $INGEST_SECRET" https://<your-worker>/api/ingest
 *
 * (The JSON content type matters: Astro rejects cross-site form-encoded POSTs by default.)
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { runIngest } from '../../lib/ingest';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const secret = env.INGEST_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const report = await runIngest(env);
    return Response.json(report, { status: report.errors.length ? 207 : 200 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
};
