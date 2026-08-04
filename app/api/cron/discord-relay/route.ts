import { NextResponse } from "next/server";
import {
  fetchNewMessages, relayPayload, isEmpty, msFromSnowflake, type RelayMessage,
} from "@/lib/discordRelay";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────
// DISCORD → DISCORD RELAY — standalone, like the Seatix and Pushover modules.
// No UI, nothing written to `tickets`, nothing added to the client bundle.
//
//   (none)     relay new messages — what the pinger calls
//   ?peek=1    show the latest few messages WITHOUT relaying or moving the
//              cursor. This is the setup check: it proves the bot can see the
//              channel and, crucially, whether the content arrives empty.
//
// State is the millisecond of the last relayed message, in poll_state under its
// own key. A snowflake itself is a 64-bit id that a JS number cannot hold
// exactly, so it is never stored as one — see lib/discordRelay.ts.
// ─────────────────────────────────────────────────────────────

const STATE_KEY = "discord@relay";
// A quiet channel returns nothing; a busy one shouldn't flood the target in one
// go. 50 is Discord's default page and plenty for a 5-minute cadence.
const PER_RUN = 50;

async function lastMs(): Promise<number> {
  const { data } = await supabaseAdmin()
    .from("poll_state").select("last_uid").eq("mailbox", STATE_KEY).maybeSingle();
  return data?.last_uid ?? 0;
}

async function saveMs(ms: number): Promise<void> {
  await supabaseAdmin().from("poll_state").upsert(
    // uid_validity is NOT NULL and carries no meaning here; 1 is a constant.
    { mailbox: STATE_KEY, uid_validity: 1, last_uid: ms, updated_at: new Date().toISOString() },
    { onConflict: "mailbox" }
  );
}

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

async function handle(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = process.env.RELAY_BOT_TOKEN;
  const channelId = process.env.RELAY_SOURCE_CHANNEL_ID;
  const webhook = process.env.RELAY_TARGET_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
  const roleId = process.env.RELAY_ROLE_ID;

  // Fail loudly. A missing variable here looks exactly like a quiet channel,
  // which is the failure this module exists to prevent.
  const missing = [
    !token && "RELAY_BOT_TOKEN",
    !channelId && "RELAY_SOURCE_CHANNEL_ID",
    !webhook && "RELAY_TARGET_WEBHOOK_URL (or DISCORD_WEBHOOK_URL)",
  ].filter(Boolean);
  if (missing.length) {
    return NextResponse.json({ error: `not configured: ${missing.join(", ")}` }, { status: 503 });
  }

  const q = new URL(req.url).searchParams;

  // ── setup check ── read-only in every sense: no relaying, no cursor move.
  if (q.get("peek")) {
    const recent = await fetchNewMessages(token!, channelId!, 0, 5);
    return NextResponse.json({
      peek: true,
      canSeeChannel: true,
      messages: recent.length,
      empty: recent.filter(isEmpty).length,
      hint: recent.length && recent.every(isEmpty)
        ? "Every message came back empty — switch MESSAGE CONTENT INTENT on in the Developer Portal (Bot → Privileged Gateway Intents)."
        : recent.length === 0
        ? "The bot can reach the channel; there is simply nothing recent in it."
        : "Content is coming through.",
      sample: recent.slice(-3).map((m) => ({
        at: m.timestamp,
        from: m.author?.username,
        text: (m.content ?? "").slice(0, 120),
        embeds: m.embeds?.length ?? 0,
        embedTitle: (m.embeds?.[0]?.title as string) ?? null,
      })),
    });
  }

  const since = await lastMs();
  let messages: RelayMessage[] = await fetchNewMessages(token!, channelId!, since, PER_RUN);

  // First ever run: adopt the current position instead of dumping the channel's
  // whole recent history into the target. Same rule as the mail poller.
  if (since === 0) {
    const newest = messages.at(-1);
    const at = newest ? msFromSnowflake(newest.id) : Date.now();
    await saveMs(at);
    return NextResponse.json({
      first_run: true, relayed: 0, cursor: new Date(at).toISOString(),
      info: "Cursor set to now; nothing backfilled. New messages from here on.",
    });
  }

  let relayed = 0;
  let empty = 0;
  let cursor = since;
  for (const m of messages) {
    if (isEmpty(m)) {
      // Nothing to forward. Still advance past it, or the cursor sticks here
      // forever — the same trap the mail watermark fell into.
      empty++;
      cursor = msFromSnowflake(m.id);
      continue;
    }
    const res = await fetch(webhook!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(relayPayload(m, roleId)),
    });
    if (!res.ok) {
      console.error("Relay webhook returned", res.status, await res.text().catch(() => ""));
      break; // stop here; the cursor holds and this message is retried next run
    }
    relayed++;
    cursor = msFromSnowflake(m.id);
  }

  if (cursor > since) await saveMs(cursor);

  return NextResponse.json({
    seen: messages.length,
    relayed,
    emptyContent: empty,
    ...(empty > 0 && relayed === 0
      ? { warning: "Messages arrived with no readable content — MESSAGE CONTENT INTENT is probably off." }
      : {}),
    cursor: new Date(cursor).toISOString(),
  });
}
