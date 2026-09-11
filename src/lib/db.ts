/** D1 access. All reads/writes for the site and the ingest job live here. */

export interface LinkRow {
  id: number;
  url: string;
  url_norm: string;
  domain: string;
  title: string | null;
  guild_id: string;
  channel_id: string;
  channel_name: string;
  message_id: string;
  author_id: string;
  author_name: string;
  posted_at: string;
  day: string;
  reactions: number;
}

export interface UpsertLink {
  url: string;
  urlNorm: string;
  domain: string;
  title: string | null;
  guildId: string;
  channelId: string;
  channelName: string;
  messageId: string;
  authorId: string;
  authorName: string;
  postedAt: string;
  day: string;
  reactions: number;
}

export async function linksForDay(db: D1Database, day: string): Promise<LinkRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, url, url_norm, domain, title, guild_id, channel_id, channel_name, message_id,
              author_id, author_name, posted_at, day, reactions
         FROM links WHERE day = ?
        ORDER BY reactions DESC, posted_at ASC`,
    )
    .bind(day)
    .all<LinkRow>();
  return results;
}

/** Nearest day with links before/after `day` (for prev/next navigation). */
export async function adjacentDays(
  db: D1Database,
  day: string,
): Promise<{ prev: string | null; next: string | null }> {
  const [prev, next] = await db.batch([
    db.prepare('SELECT day FROM links WHERE day < ? ORDER BY day DESC LIMIT 1').bind(day),
    db.prepare('SELECT day FROM links WHERE day > ? ORDER BY day ASC LIMIT 1').bind(day),
  ]);
  return {
    prev: (prev.results[0] as { day: string } | undefined)?.day ?? null,
    next: (next.results[0] as { day: string } | undefined)?.day ?? null,
  };
}

export async function latestDay(db: D1Database): Promise<string | null> {
  const row = await db.prepare('SELECT MAX(day) AS day FROM links').first<{ day: string | null }>();
  return row?.day ?? null;
}

export async function recentDays(db: D1Database, limit = 30): Promise<{ day: string; count: number }[]> {
  const { results } = await db
    .prepare('SELECT day, COUNT(*) AS count FROM links GROUP BY day ORDER BY day DESC LIMIT ?')
    .bind(limit)
    .all<{ day: string; count: number }>();
  return results;
}

export function upsertStatement(db: D1Database, l: UpsertLink): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO links (url, url_norm, domain, title, title_checked, guild_id, channel_id, channel_name,
                          message_id, author_id, author_name, posted_at, day, reactions, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
       ON CONFLICT (message_id, url_norm) DO UPDATE SET
         reactions    = excluded.reactions,
         channel_name = excluded.channel_name,
         author_name  = excluded.author_name,
         title        = COALESCE(links.title, excluded.title),
         title_checked = MAX(links.title_checked, excluded.title_checked),
         updated_at   = excluded.updated_at`,
    )
    .bind(
      l.url,
      l.urlNorm,
      l.domain,
      l.title,
      l.title ? 1 : 0,
      l.guildId,
      l.channelId,
      l.channelName,
      l.messageId,
      l.authorId,
      l.authorName,
      l.postedAt,
      l.day,
      l.reactions,
      new Date().toISOString(),
    );
}

export async function linksMissingTitle(
  db: D1Database,
  limit: number,
): Promise<{ id: number; url: string }[]> {
  const { results } = await db
    .prepare('SELECT id, url FROM links WHERE title_checked = 0 ORDER BY id DESC LIMIT ?')
    .bind(limit)
    .all<{ id: number; url: string }>();
  return results;
}

export function setTitleStatement(db: D1Database, id: number, title: string | null): D1PreparedStatement {
  return db.prepare('UPDATE links SET title = ?, title_checked = 1 WHERE id = ?').bind(title, id);
}

export async function getState(db: D1Database, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM sync_state WHERE key = ?')
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

export function setStateStatement(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    .bind(key, value);
}

/** Newest links across all days, for the RSS feed. */
export async function recentLinks(db: D1Database, limit = 50): Promise<LinkRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, url, url_norm, domain, title, guild_id, channel_id, channel_name, message_id,
              author_id, author_name, posted_at, day, reactions
         FROM links
        ORDER BY posted_at DESC, id DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<LinkRow>();
  return results;
}

/**
 * Front page: every link, newest day first, best-reacted first within a day. Paged HN-style.
 * Fetches one extra row to know whether a next page exists.
 */
export async function frontPage(
  db: D1Database,
  page: number,
  perPage: number,
): Promise<{ links: LinkRow[]; hasMore: boolean }> {
  const { results } = await db
    .prepare(
      `SELECT id, url, url_norm, domain, title, guild_id, channel_id, channel_name, message_id,
              author_id, author_name, posted_at, day, reactions
         FROM links
        ORDER BY day DESC, reactions DESC, posted_at DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(perPage + 1, (page - 1) * perPage)
    .all<LinkRow>();
  return { links: results.slice(0, perPage), hasMore: results.length > perPage };
}
