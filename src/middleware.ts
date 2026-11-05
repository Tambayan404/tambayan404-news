import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  cookieOptions,
  decodeSession,
  encodeSession,
  refreshSession,
} from './lib/auth';

/** Routes with their own access check: the OAuth flow, the bearer-guarded ingest, and key-guarded RSS. */
function isOpen(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname; // trailingSlash: 'ignore'
  return path.startsWith('/auth/') || path === '/api/ingest' || path === '/rss';
}

export const onRequest = defineMiddleware(async (ctx, next) => {
  if (isOpen(ctx.url.pathname)) return next();

  const session = await decodeSession(env, ctx.cookies.get(SESSION_COOKIE)?.value);
  const refreshed = session && (await refreshSession(env, session));
  if (!refreshed) {
    if (session) ctx.cookies.delete(SESSION_COOKIE, cookieOptions(0));
    if (ctx.request.method !== 'GET' && ctx.request.method !== 'HEAD') {
      return new Response('unauthorized', { status: 401 });
    }
    const nextPath = ctx.url.pathname + ctx.url.search;
    return ctx.redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`, 302);
  }
  if (refreshed.renewed) {
    ctx.cookies.set(
      SESSION_COOKIE,
      await encodeSession(env, refreshed.session),
      cookieOptions(SESSION_MAX_AGE_S),
    );
  }
  ctx.locals.uid = refreshed.session.uid;
  return next();
});
