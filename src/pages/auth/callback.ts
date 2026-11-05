import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
  STATE_COOKIE,
  checkMembership,
  cookieOptions,
  encodeSession,
  safeNext,
  userIdFromCode,
} from '../../lib/auth';
import { setMember } from '../../lib/db';

export const prerender = false;

function page(status: number, message: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tambayan 404 News</title>
<body style="font:15px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px">
<p>${message}</p><p><a href="/auth/login">Try again</a></p></body>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  let saved: { state?: string; next?: string } = {};
  try {
    saved = JSON.parse(cookies.get(STATE_COOKIE)?.value ?? '{}');
  } catch {}
  cookies.delete(STATE_COOKIE, cookieOptions(0, '/auth/'));

  if (url.searchParams.has('error')) return page(401, 'Discord login was cancelled.');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !saved.state || state !== saved.state) {
    return page(400, 'That login link expired or was already used.');
  }

  const uid = await userIdFromCode(env, url, code);
  if (!uid) return page(502, 'Discord didn’t confirm the login.');

  const membership = await checkMembership(env, uid);
  if (membership === 'unknown') return page(503, 'Couldn’t reach Discord to check your membership.');
  if (membership === 'not-member') {
    return page(403, 'This site is only for members of the Tambayan 404 Discord server.');
  }

  const now = Date.now();
  await setMember(env.DB, uid, true, now);
  cookies.set(SESSION_COOKIE, await encodeSession(env, { uid, chk: now }), cookieOptions(SESSION_MAX_AGE_S));
  return redirect(safeNext(saved.next), 302);
};
