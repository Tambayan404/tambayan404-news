/** Minimal Discord REST client with rate-limit handling and a subrequest budget. */

const API = 'https://discord.com/api/v10';

export const ChannelType = {
  GuildText: 0,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
  GuildForum: 15,
  GuildMedia: 16,
} as const;

export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  parent_id?: string | null;
  position?: number;
}

export interface DiscordEmbed {
  type?: string; // "rich" | "link" | "video" | "article" | "image" | "gifv" | ...
  title?: string;
  url?: string;
  description?: string;
  author?: { name?: string; url?: string };
  provider?: { name?: string; url?: string };
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  author: { id: string; username: string; global_name?: string | null; bot?: boolean };
  embeds?: DiscordEmbed[];
  reactions?: { count: number; emoji: { id: string | null; name: string | null } }[];
}

export class BudgetExhausted extends Error {
  constructor() {
    super('subrequest budget exhausted');
  }
}

export class DiscordClient {
  #token: string;
  #budget: number;
  used = 0;

  constructor(token: string, budget: number) {
    this.#token = token;
    this.#budget = budget;
  }

  get remaining(): number {
    return this.#budget - this.used;
  }

  /** Reserve one subrequest from the budget, throwing when exhausted. */
  take(): void {
    if (this.used >= this.#budget) throw new BudgetExhausted();
    this.used++;
  }

  async #request<T>(path: string, attempt = 0): Promise<T | null> {
    this.take();
    const res = await fetch(API + path, {
      headers: {
        Authorization: `Bot ${this.#token}`,
        'User-Agent': 'DiscordBot (https://github.com/tambayan404/t404-news, 1.0)',
      },
    });
    if (res.status === 429 && attempt < 2) {
      const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const wait = Math.min(5000, Math.ceil((body.retry_after ?? 1) * 1000));
      await new Promise((r) => setTimeout(r, wait));
      return this.#request<T>(path, attempt + 1);
    }
    if (res.status === 403 || res.status === 404) return null; // no access / gone: skip quietly
    if (!res.ok) throw new Error(`Discord ${res.status} on ${path}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  guildChannels(guildId: string): Promise<DiscordChannel[] | null> {
    return this.#request<DiscordChannel[]>(`/guilds/${guildId}/channels`);
  }

  async activeThreads(guildId: string): Promise<DiscordChannel[]> {
    const r = await this.#request<{ threads: DiscordChannel[] }>(`/guilds/${guildId}/threads/active`);
    return r?.threads ?? [];
  }

  /** Messages strictly after `afterId` (snowflake), oldest→newest, up to 100 per call. */
  messagesAfter(channelId: string, afterId: string): Promise<DiscordMessage[] | null> {
    return this.#request<DiscordMessage[]>(`/channels/${channelId}/messages?limit=100&after=${afterId}`);
  }
}

const DISCORD_EPOCH = 1420070400000n;

/** Snowflake whose timestamp is `ms` — usable as an `after=` cursor. */
export function snowflakeFromTime(ms: number): string {
  return ((BigInt(ms) - DISCORD_EPOCH) << 22n).toString();
}

export function messageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export function displayName(author: DiscordMessage['author']): string {
  return author.global_name || author.username;
}
