/** URL extraction + normalization for Discord message content. */

const URL_RE = /https?:\/\/[^\s<>\[\]{}"'`]+/gi;

/** Hosts whose links are noise for a link-aggregator (GIFs, Discord itself, media CDNs). */
const SKIP_HOSTS = [
  'discord.com',
  'discordapp.com',
  'discord.gg',
  'media.discordapp.net',
  'cdn.discordapp.com',
  'tenor.com',
  'giphy.com',
  'media.giphy.com',
];

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|si$|ref_src$)/;

export function shouldSkipHost(host: string): boolean {
  return SKIP_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

/** Strip trailing punctuation people type after a URL ("see https://x.com." → "https://x.com"). */
function trimTrailing(raw: string): string {
  let s = raw;
  for (;;) {
    if (/[.,;:!?'"*_~]$/.test(s)) { s = s.slice(0, -1); continue; }
    // Drop a trailing ")" only when unbalanced, so "https://en.wikipedia.org/wiki/Foo_(bar)" survives
    // but "(see https://example.com)" does not keep the closing paren.
    if (s.endsWith(')') && (s.match(/\(/g) ?? []).length < (s.match(/\)/g) ?? []).length) { s = s.slice(0, -1); continue; }
    return s;
  }
}

export function normalizeUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(trimTrailing(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u;
}

export interface ExtractedLink {
  url: string;
  urlNorm: string;
  domain: string;
}

/**
 * Pull unique, normalized http(s) links out of message text.
 * Handles Discord's `<https://…>` embed-suppression syntax and markdown `[text](url)`.
 */
export function extractLinks(text: string): ExtractedLink[] {
  const seen = new Map<string, ExtractedLink>();
  for (const match of text.matchAll(URL_RE)) {
    const u = normalizeUrl(match[0]);
    if (!u) continue;
    if (shouldSkipHost(u.hostname)) continue;
    const urlNorm = u.toString();
    if (seen.has(urlNorm)) continue;
    seen.set(urlNorm, {
      url: trimTrailing(match[0]),
      urlNorm,
      domain: u.hostname.replace(/^www\./, ''),
    });
  }
  return [...seen.values()];
}
