import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { feedKeyUser, memberStatus } from '../lib/auth';
import { recentLinks } from '../lib/db';
import { messageUrl } from '../lib/discord';

export const prerender = false;

const FEED_SIZE = 50;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const GET: APIRoute = async ({ url }) => {
  // Personal key from /feed; feed readers can't log in, so the key stands in for the session cookie.
  const uid = await feedKeyUser(env, url.searchParams.get('key'));
  if (!uid) return new Response('not found', { status: 404 });
  if (!(await memberStatus(env, uid)).allowed) return new Response('forbidden', { status: 403 });

  const siteName = env.SITE_NAME || 'Tambayan 404 News';
  const origin = url.origin;
  const links = await recentLinks(env.DB, FEED_SIZE);

  const items = links
    .map((l) => {
      const title = l.title || l.url.replace(/^https?:\/\/(www\.)?/, '');
      const discord = messageUrl(l.guild_id, l.channel_id, l.message_id);
      const description =
        `Shared by a Tambay in #${esc(l.channel_name)} · ` +
        `${l.reactions} reaction${l.reactions === 1 ? '' : 's'} · ` +
        `<a href="${esc(discord)}">open in Discord</a>`;
      return `    <item>
      <title>${esc(title)}</title>
      <link>${esc(l.url)}</link>
      <guid isPermaLink="false">${esc(`${l.message_id}:${l.url_norm}`)}</guid>
      <pubDate>${new Date(l.posted_at).toUTCString()}</pubDate>
      <category>${esc(l.channel_name)}</category>
      <description>${esc(description)}</description>
    </item>`;
    })
    .join('\n');

  const lastBuild = links[0] ? new Date(links[0].posted_at).toUTCString() : new Date().toUTCString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(siteName)}</title>
    <link>${esc(origin)}/</link>
    <atom:link href="${esc(`${origin}/rss?key=${url.searchParams.get('key')}`)}" rel="self" type="application/rss+xml" />
    <description>Links shared on the ${esc(siteName.replace(/ News$/, ''))} Discord, newest first.</description>
    <language>en</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
  });
};
