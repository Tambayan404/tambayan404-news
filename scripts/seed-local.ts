/**
 * Sample links for local development: `pnpm db:seed:local`. Writes only to local D1 (.wrangler/state).
 * Rows go through the ingest's own helpers (URL normalization, SITE_TZ day bucketing, upsert), with
 * timestamps relative to now so the front page, /past and /day/* always have content.
 * Rerunnable: it replaces earlier seed rows, which are all marked with guild_id 'seed-guild'.
 */
import { getPlatformProxy } from 'wrangler';
import { upsertStatement } from '../src/lib/db.ts';
import { extractLinks } from '../src/lib/links.ts';
import { dayOf } from '../src/lib/time.ts';

const GUILD_ID = 'seed-guild';
const CHANNELS = { dev: 'seed-c1', tambayan: 'seed-c2', memes: 'seed-c3' };

// [minutes ago, url as posted, title (null shows the URL), channel, author, reactions]
const SAMPLES: [number, string, string | null, keyof typeof CHANNELS, string, number][] = [
  [
    45,
    'https://blog.cloudflare.com/d1-read-replication/',
    'D1 read replication is now generally available',
    'dev',
    'kiko',
    14,
  ],
  [130, 'https://astro.build/blog/astro-7/', 'Astro 7: background dev servers and more', 'dev', 'jem', 9],
  [
    200,
    'https://www.rappler.com/technology/',
    'PH internet speeds climb again in latest Ookla report',
    'tambayan',
    'bea',
    6,
  ],
  [235, 'https://github.com/sqlite/sqlite', null, 'dev', 'paolo', 2],
  [
    305,
    'https://news.ycombinator.com/item?id=41000001',
    'Show HN: A Discord link digest that runs on a cron',
    'tambayan',
    'kiko',
    0,
  ],
  [
    735,
    'https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme',
    'color-scheme - CSS | MDN',
    'dev',
    'jem',
    11,
  ],
  [
    940,
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=discord',
    'Rick Astley - Never Gonna Give You Up',
    'memes',
    'migs',
    23,
  ],
  [1290, 'https://lwn.net/Articles/990000/', 'A look at the 7.0 kernel merge window', 'dev', 'paolo', 4],
  [1510, 'https://www.inquirer.net/tech/', 'Manila startups bet on AI coding tools', 'tambayan', 'bea', 1],
  [
    2215,
    'https://simonwillison.net/2026/Nov/1/sqlite-tricks/',
    'Five SQLite tricks I keep forgetting',
    'dev',
    'kiko',
    7,
  ],
  [
    2540,
    'https://fxtwitter.com/astrodotbuild/status/1850000000000000000',
    'Astro on X: "Astro 7 is out"',
    'memes',
    'migs',
    3,
  ],
  [3105, 'https://example.com/a-very-long-path/that-goes-on/and-on', null, 'tambayan', 'jem', 0],
];

const { env, dispose } = await getPlatformProxy<Env>();
try {
  const db = env.DB;
  const tz = env.SITE_TZ || 'UTC';
  const now = Date.now();
  const rows = SAMPLES.map(([minsAgo, raw, title, channel, author, reactions], i) => {
    const [link] = extractLinks(raw);
    if (!link) throw new Error(`Sample URL is skipped by ingest: ${raw}`);
    const posted = new Date(now - minsAgo * 60_000);
    return upsertStatement(db, {
      ...link,
      title,
      guildId: GUILD_ID,
      channelId: CHANNELS[channel],
      channelName: channel,
      messageId: `seed-m${String(i + 1).padStart(2, '0')}`,
      authorId: `seed-u-${author}`,
      authorName: author,
      postedAt: posted.toISOString(),
      day: dayOf(posted, tz),
      reactions,
    });
  });
  await db.batch([db.prepare('DELETE FROM links WHERE guild_id = ?').bind(GUILD_ID), ...rows]);
  console.log(`Seeded ${rows.length} sample links into local D1.`);
} finally {
  await dispose();
}
