// ─────────────────────────────────────────────────────────────
// DISCORD → DISCORD RELAY
//
// Reads a channel you can see but don't own, and reposts new messages to your
// own webhook. Uses a bot on the REST API — `GET /channels/{id}/messages` every
// few minutes — so there is no gateway connection to keep alive, which is what
// makes it fit a serverless cron alongside everything else here.
//
// Two requirements on the Discord side, both of which fail SILENTLY if missed:
//
//   * the bot needs View Channel + Read Message History on that channel;
//   * the app needs the MESSAGE CONTENT intent enabled in the Developer Portal.
//     That intent gates `content`, `embeds`, `attachments` and `components`,
//     and it applies to the REST API too, not only to gateway events. Without
//     it the bot still sees the messages — it just sees them EMPTY, which reads
//     exactly like "the channel is quiet". Hence emptyContent in the response
//     and the ?peek action: both exist to make that failure visible.
//
// Reading a channel with a USER account would need no bot and no permission,
// and is a straight Terms of Service violation that gets accounts banned. Not
// offered here, deliberately.
// ─────────────────────────────────────────────────────────────

const API = "https://discord.com/api/v10";

export type RelayMessage = {
  id: string;
  content?: string;
  timestamp: string;
  author?: { username?: string; avatar?: string | null; id?: string; bot?: boolean };
  embeds?: Record<string, unknown>[];
  attachments?: { url: string; filename?: string }[];
};

// ── Snowflakes ────────────────────────────────────────────────────────
// A Discord id is a 64-bit snowflake, far past what a JS number holds exactly,
// so it is only ever handled as a string or a BigInt here. What gets STORED is
// the millisecond the last relayed message was posted — that comfortably fits a
// number, so the existing poll_state row works and no migration is needed — and
// the `after` snowflake is rebuilt from it.
const DISCORD_EPOCH = 1_420_070_400_000n;

/** The smallest snowflake that could exist at this millisecond. */
export function snowflakeFromMs(ms: number): string {
  const t = BigInt(Math.max(0, Math.floor(ms)));
  if (t <= DISCORD_EPOCH) return "0";
  return String((t - DISCORD_EPOCH) << 22n);
}

export function msFromSnowflake(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

async function api(path: string, token: string): Promise<Response> {
  return fetch(`${API}${path}`, {
    headers: { Authorization: `Bot ${token}` },
    cache: "no-store",
  });
}

/**
 * Messages posted after `afterMs`, oldest first.
 *
 * Rebuilding the cursor from a millisecond means a message sharing the exact
 * millisecond of the previous run's last one can come back twice. That is the
 * deliberate trade: a duplicate alert is a nuisance, a missed one is the whole
 * problem this exists to solve.
 */
export async function fetchNewMessages(
  token: string,
  channelId: string,
  afterMs: number,
  limit = 50
): Promise<RelayMessage[]> {
  const after = snowflakeFromMs(afterMs);
  const res = await api(`/channels/${channelId}/messages?limit=${limit}&after=${after}`, token);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 403 here almost always means the bot is in the server but can't see this
    // channel; 401 means the token is wrong; 404 means the channel id is.
    throw new Error(`Discord GET messages → ${res.status} ${body.slice(0, 200)}`);
  }
  const list = (await res.json()) as RelayMessage[];
  return list.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

/** Nothing readable in it — the symptom of a missing MESSAGE CONTENT intent. */
export function isEmpty(msg: RelayMessage): boolean {
  return !msg.content?.trim() && !(msg.embeds?.length ?? 0) && !(msg.attachments?.length ?? 0);
}

// Only these embed keys are forwarded. The API returns extras (`type`,
// `provider`, `video`, `reference_id`) that the webhook endpoint rejects, and a
// rejected post is a lost alert.
const EMBED_KEYS = [
  "title", "description", "url", "color", "fields",
  "author", "footer", "image", "thumbnail", "timestamp",
] as const;

function cleanEmbed(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EMBED_KEYS) if (e[k] !== undefined && e[k] !== null) out[k] = e[k];
  return out;
}

/**
 * One source message as a webhook payload for your own channel.
 *
 * `allowed_mentions: { parse: [] }` is not optional. This forwards text written
 * by someone else; without it, a relayed message containing @everyone would
 * fire @everyone in YOUR server. Only the role you configured may ping.
 */
export function relayPayload(msg: RelayMessage, roleId?: string): Record<string, unknown> {
  const parts: string[] = [];
  if (roleId) parts.push(`<@&${roleId}>`);
  if (msg.content?.trim()) parts.push(msg.content.trim());
  for (const a of msg.attachments ?? []) parts.push(a.url);

  const embeds = (msg.embeds ?? []).slice(0, 10).map(cleanEmbed);
  const content = parts.join("\n").slice(0, 2000);

  return {
    ...(content ? { content } : {}),
    ...(embeds.length ? { embeds } : {}),
    allowed_mentions: roleId ? { parse: [], roles: [roleId] } : { parse: [] },
    // Keep the original author's name so the relay reads like the source. The
    // suffix is there so a relayed message is never mistaken for a local one.
    username: `${msg.author?.username ?? "relay"} (relay)`.slice(0, 80),
    ...(msg.author?.id && msg.author.avatar
      ? { avatar_url: `https://cdn.discordapp.com/avatars/${msg.author.id}/${msg.author.avatar}.png` }
      : {}),
  };
}
