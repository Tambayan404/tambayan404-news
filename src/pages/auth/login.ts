import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { STATE_COOKIE, authorizeUrl, cookieOptions, randomToken, safeNext } from '../../lib/auth';

export const prerender = false;

/** Starts Discord OAuth. The state cookie ties the callback to this browser and carries the return path. */
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const state = randomToken();
  const next = safeNext(url.searchParams.get('next'));
  cookies.set(STATE_COOKIE, JSON.stringify({ state, next }), cookieOptions(600, '/auth/'));
  return redirect(authorizeUrl(env, url, state), 302);
};
