/**
 * Members-only gate: Discord OAuth2 (`identify`) proves who the visitor is, the bot token proves they are
 * in the server. Sessions and feed keys are HMAC-signed values, so a normal page view costs one signature
 * check and no D1 or Discord call. Membership is re-checked against Discord every RECHECK_MS.
 */
import { getMember, markMemberAttempt, setMember } from './db';

const API = 'https://discord.com/api/v10';

// __Host- pins the cookie to this exact host with Path=/ and Secure.
export const SESSION_COOKIE = '__Host-t404_session';
export const STATE_COOKIE = 't404_oauth';
/** How often a session or feed key is re-checked against the server's member list. */
export const RECHECK_MS = 3 * 24 * 60 * 60 * 1000;
/** If Discord can't be reached, keep honouring the last good check for this long at most. */
const GRACE_MS = 2 * RECHECK_MS;
/** Minimum gap between Discord membership calls for the same user. */
const RETRY_MS = 60 * 1000;
/** Browser cookie lifetime; the membership re-check above is what actually bounds access. */
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export interface Session {
  uid: string;
  /** Epoch ms of the last successful membership check. */
  chk: number;
}

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null; // e.g. a length that no base64 string can have
  }
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hmacKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret) throw new Error('auth secret is not configured');
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

async function sign(secret: string | undefined, data: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data)));
}

/** Constant-time check via WebCrypto. */
async function verify(secret: string | undefined, data: string, sig: string): Promise<boolean> {
  const raw = unb64url(sig);
  if (!raw) return false;
  return crypto.subtle.verify('HMAC', await hmacKey(secret), raw, enc.encode(data));
}

const SNOWFLAKE = /^\d{1,20}$/;

export async function encodeSession(env: Env, s: Session): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(s)));
  return `${payload}.${await sign(env.SESSION_SECRET, `session:${payload}`)}`;
}

export async function decodeSession(env: Env, value: string | undefined): Promise<Session | null> {
  if (!value) return null;
  const [payload, sig, extra] = value.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  if (!(await verify(env.SESSION_SECRET, `session:${payload}`, sig))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(unb64url(payload)!)) as Session;
    if (typeof s.uid !== 'string' || !SNOWFLAKE.test(s.uid) || typeof s.chk !== 'number') return null;
    return s;
  } catch {
    return null;
  }
}

/** Personal, long-lived feed key: `<user id>.<signature>`. Rotate FEED_SECRET to revoke all keys. */
export async function feedKey(env: Env, uid: string): Promise<string> {
  return `${uid}.${await sign(env.FEED_SECRET, `feed:${uid}`)}`;
}

export async function feedKeyUser(env: Env, key: string | null): Promise<string | null> {
  const [uid, sig, extra] = (key ?? '').split('.');
  if (!uid || !sig || extra !== undefined || !SNOWFLAKE.test(uid)) return null;
  return (await verify(env.FEED_SECRET, `feed:${uid}`, sig)) ? uid : null;
}

export type Membership = 'member' | 'not-member' | 'unknown';

/** Asks Discord (as the bot) whether `uid` is a full member of the server. One subrequest. */
export async function checkMembership(env: Env, uid: string): Promise<Membership> {
  try {
    const res = await fetch(`${API}/guilds/${env.DISCORD_GUILD_ID}/members/${uid}`, {
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'User-Agent': 'DiscordBot (https://github.com/tambayan404/t404-news, 1.0)',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return 'not-member';
    if (!res.ok) {
      console.error('membership check failed', res.status);
      return 'unknown';
    }
    // `pending` = joined but hasn't passed the server's membership screening yet.
    const member = (await res.json()) as { pending?: boolean };
    return member.pending ? 'not-member' : 'member';
  } catch (e) {
    console.error('membership check failed', e);
    return 'unknown';
  }
}

/** Last membership answer for `uid`: whether to let them in, and when Discord last confirmed it. */
export async function memberStatus(
  env: Env,
  uid: string,
  now = Date.now(),
): Promise<{ allowed: boolean; checkedAt: number }> {
  const row = await getMember(env.DB, uid);
  if (row && now - row.checked_at < RECHECK_MS)
    return { allowed: row.is_member === 1, checkedAt: row.checked_at };
  // While Discord can't answer, honour the last good check for a while instead of locking everyone out.
  const fallback = {
    allowed: !!row && row.is_member === 1 && now - row.checked_at < GRACE_MS,
    checkedAt: row?.checked_at ?? 0,
  };
  // At most one Discord call per user per RETRY_MS, however often a stale cookie or feed key is replayed.
  if (row && now - row.attempted_at < RETRY_MS) return fallback;
  await markMemberAttempt(env.DB, uid, now);
  const m = await checkMembership(env, uid);
  if (m === 'unknown') return fallback;
  await setMember(env.DB, uid, m === 'member', now);
  return { allowed: m === 'member', checkedAt: now };
}

/**
 * Re-checks a session whose last check is older than RECHECK_MS. Returns the session to continue with
 * (`renewed` when the cookie should be re-issued), or null when access should end.
 */
export async function refreshSession(
  env: Env,
  s: Session,
  now = Date.now(),
): Promise<{ session: Session; renewed: boolean } | null> {
  if (now - s.chk < RECHECK_MS) return { session: s, renewed: false };
  if (now - s.chk >= GRACE_MS) return null; // long unused: sign in again rather than ask Discord
  const status = await memberStatus(env, s.uid, now);
  if (!status.allowed) return null;
  if (status.checkedAt > s.chk) return { session: { uid: s.uid, chk: status.checkedAt }, renewed: true };
  return { session: s, renewed: false };
}

/** Secure is always set: browsers also accept Secure cookies on http://localhost. */
export function cookieOptions(maxAge: number, path = '/') {
  return { httpOnly: true, secure: true, sameSite: 'lax', path, maxAge } as const;
}

/**
 * Only same-site paths survive the login round trip. Parsing like a browser does catches tricks such as
 * `/\t/evil.example`, which browsers read as `//evil.example`.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next) return '/';
  const base = 'https://next.invalid';
  try {
    const u = new URL(next, base);
    return u.origin === base ? u.pathname + u.search : '/';
  } catch {
    return '/';
  }
}

export function randomToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function oauthRedirectUri(url: URL): string {
  return `${url.origin}/auth/callback`;
}

export function authorizeUrl(env: Env, url: URL, state: string): string {
  const q = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: oauthRedirectUri(url),
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${q}`;
}

/** Exchanges an OAuth code for the Discord user id. Two subrequests; the token itself is not kept. */
export async function userIdFromCode(env: Env, url: URL, code: string): Promise<string | null> {
  try {
    return await exchangeCode(env, url, code);
  } catch (e) {
    console.error('oauth login failed', e);
    return null;
  }
}

async function exchangeCode(env: Env, url: URL, code: string): Promise<string | null> {
  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauthRedirectUri(url),
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
    }),
  });
  if (!tokenRes.ok) {
    console.error('oauth token exchange failed', tokenRes.status);
    return null;
  }
  const { access_token } = (await tokenRes.json()) as { access_token?: string };
  if (!access_token) return null;
  const meRes = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!meRes.ok) return null;
  const { id } = (await meRes.json()) as { id?: string };
  return id && SNOWFLAKE.test(id) ? id : null;
}
