/**
 * Ingest job: poll Discord channels for recent messages, extract links, record reaction totals.
 *
 * Designed for Cloudflare Cron Triggers and the per-invocation subrequest limit:
 * every run has a fixed subrequest budget, walks channels round-robin from a stored
 * cursor, and stops cleanly when the budget is spent. The next run picks up where it left off.
 * Messages within LOOKBACK_HOURS are re-fetched each pass so reaction counts stay fresh.
 */
import { BudgetExhausted, ChannelType, DiscordClient, displayName, snowflakeFromTime, type DiscordChannel, type DiscordMessage } from './discord';
import { extractLinks } from './links';
import { fetchTitle } from './title';
import { dayOf } from './time';
import { getState, linksMissingTitle, setStateStatement, setTitleStatement, upsertStatement, type UpsertLink } from './db';

export interface IngestEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN: string;
  DISCORD_GUILD_ID: string;
  SITE_TZ: string;
  LOOKBACK_HOURS?: string;
  SUBREQUEST_BUDGET?: string;
  SKIP_BOT_AUTHORS?: string;
}

export interface IngestReport {
  channelsScanned: number;
  messagesSeen: number;
  linksUpserted: number;
  titlesFetched: number;
  subrequestsUsed: number;
  budgetExhausted: boolean;
  errors: string[];
}

const CURSOR_KEY = 'channel_cursor';
const TITLE_BUDGET_SHARE = 0.25; // fraction of the budget reserved for title fetches

function reactionTotal(m: DiscordMessage): number {
  return (m.reactions ?? []).reduce((n, r) => n + (r.count ?? 0), 0);
}

function embedTitleFor(m: DiscordMessage, url: string): string | null {
  for (const e of m.embeds ?? []) {
    if (!e.title) continue;
    if (e.url && (e.url === url || e.url.startsWith(url) || url.startsWith(e.url))) return e.title.slice(0, 200);
  }
  return null;
}

function isTextLike(c: DiscordChannel): boolean {
  return (
    c.type === ChannelType.GuildText ||
    c.type === ChannelType.GuildAnnouncement ||
    c.type === ChannelType.PublicThread ||
    c.type === ChannelType.AnnouncementThread
  );
}

export async function runIngest(env: IngestEnv): Promise<IngestReport> {
  const report: IngestReport = {
    channelsScanned: 0, messagesSeen: 0, linksUpserted: 0, titlesFetched: 0,
    subrequestsUsed: 0, budgetExhausted: false, errors: [],
  };
  if (!env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN is not set');
  if (!env.DISCORD_GUILD_ID || env.DISCORD_GUILD_ID.startsWith('REPLACE')) throw new Error('DISCORD_GUILD_ID is not set');

  const budget = Number(env.SUBREQUEST_BUDGET ?? 40);
  const lookbackHours = Number(env.LOOKBACK_HOURS ?? 72);
  const skipBots = (env.SKIP_BOT_AUTHORS ?? 'true') !== 'false';
  const tz = env.SITE_TZ || 'UTC';
  const guildId = env.DISCORD_GUILD_ID;
  const discord = new DiscordClient(env.DISCORD_BOT_TOKEN, budget);
  const db = env.DB;

  try {
    // 1. Enumerate channels (2 subrequests).
    const [channels, threads] = await Promise.all([discord.guildChannels(guildId), discord.activeThreads(guildId)]);
    if (!channels) throw new Error('Could not list guild channels: is the bot in the server with View Channels?');
    const parentName = new Map(channels.map((c) => [c.id, c.name ?? c.id]));
    const targets = [...channels, ...threads]
      .filter(isTextLike)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id));

    // 2. Round-robin start position so a tight budget still covers every channel over time.
    const cursorId = await getState(db, CURSOR_KEY);
    let start = cursorId ? targets.findIndex((c) => c.id === cursorId) : 0;
    if (start < 0) start = 0;
    const ordered = [...targets.slice(start), ...targets.slice(0, start)];

    const after = snowflakeFromTime(Date.now() - lookbackHours * 3600_000);
    const messageBudgetCeiling = Math.floor(budget * (1 - TITLE_BUDGET_SHARE));
    let nextCursor: string | null = null;

    for (const ch of ordered) {
      if (discord.used >= messageBudgetCeiling) {
        nextCursor = ch.id;
        break;
      }
      const channelName =
        ch.type === ChannelType.PublicThread || ch.type === ChannelType.AnnouncementThread
          ? `${parentName.get(ch.parent_id ?? '') ?? 'thread'} › ${ch.name ?? 'thread'}`
          : (ch.name ?? ch.id);
      let cursor = after;
      try {
        // Paginate oldest→newest until a short page.
        for (;;) {
          const page = await discord.messagesAfter(ch.id, cursor);
          if (!page || page.length === 0) break;
          const statements: D1PreparedStatement[] = [];
          for (const m of page) {
            report.messagesSeen++;
            if (skipBots && m.author.bot) continue;
            const links = extractLinks(m.content);
            for (const l of links) {
              const row: UpsertLink = {
                url: l.url, urlNorm: l.urlNorm, domain: l.domain,
                title: embedTitleFor(m, l.url) ?? embedTitleFor(m, l.urlNorm),
                guildId, channelId: ch.id, channelName,
                messageId: m.id, authorId: m.author.id, authorName: displayName(m.author),
                postedAt: new Date(m.timestamp).toISOString(),
                day: dayOf(new Date(m.timestamp), tz),
                reactions: reactionTotal(m),
              };
              statements.push(upsertStatement(db, row));
            }
          }
          if (statements.length) {
            await db.batch(statements);
            report.linksUpserted += statements.length;
          }
          if (page.length < 100) break;
          // Advance past the newest id on the page regardless of the order Discord returned it in.
          cursor = page.reduce((max, m) => (BigInt(m.id) > BigInt(max) ? m.id : max), cursor);
        }
      } catch (e) {
        if (e instanceof BudgetExhausted) { nextCursor = ch.id; break; }
        report.errors.push(`${channelName}: ${(e as Error).message}`);
      }
      report.channelsScanned++;
    }
    await db.batch([setStateStatement(db, CURSOR_KEY, nextCursor ?? (targets[0]?.id ?? ''))]);
    if (nextCursor) report.budgetExhausted = true;

    // 3. Backfill titles for links that had no Discord embed title.
    const titleSlots = discord.remaining;
    if (titleSlots > 0) {
      const pending = await linksMissingTitle(db, titleSlots);
      const updates: D1PreparedStatement[] = [];
      await Promise.all(
        pending.map(async ({ id, url }) => {
          discord.take(); // account against the same budget
          const title = await fetchTitle(url);
          updates.push(setTitleStatement(db, id, title));
          if (title) report.titlesFetched++;
        }),
      );
      if (updates.length) await db.batch(updates);
    }
  } catch (e) {
    if (e instanceof BudgetExhausted) report.budgetExhausted = true;
    else report.errors.push((e as Error).message);
  }
  report.subrequestsUsed = discord.used;
  return report;
}
