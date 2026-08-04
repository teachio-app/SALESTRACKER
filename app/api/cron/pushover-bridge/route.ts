import { NextResponse } from "next/server";
import {
  fetchMessages, acknowledge, login, registerDevice, createGroup, addUserToGroup,
  pushoverEmbed, type PushoverMessage,
} from "@/lib/pushover";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────
// PUSHOVER → DISCORD BRIDGE — a standalone module, like the Seatix alerter.
//
// Apps that can only shout into Pushover (the one in the screenshot takes a
// user key + app token and nothing else) get relayed into a Discord channel.
// No UI, no rows in `tickets`, nothing added to the client bundle.
//
// Actions, all behind the same Bearer CRON_SECRET as the other cron routes:
//
//   (none)              poll and relay — this is what the pinger calls
//   ?setup=1            one-time: log in, register the device, hand back the
//                       secret + device id to put in the environment
//   ?group=<name>       mint a group key for one source and add you to it
//   ?test=1             post a sample alert, to check the webhook and the ping
//
// Why setup is a separate action: logging in needs the ACCOUNT PASSWORD, and
// storing that would mean the whole account sits in an env var forever. Instead
// the password is passed once, at call time, and only the resulting `secret`
// and `device_id` are kept. Those can read messages; they cannot own the
// account or change anything.
// ─────────────────────────────────────────────────────────────

// The highest message id already relayed, so nothing is sent twice. Kept in the
// existing poll_state table under its own key — the shape is the same idea as a
// mail watermark (a monotonic id and where we got to), and reusing it means this
// module needs no schema change at all.
const STATE_KEY = "pushover@bridge";

async function state(): Promise<number> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  const { data } = await supabaseAdmin()
    .from("poll_state").select("last_uid").eq("mailbox", STATE_KEY).maybeSingle();
  return data?.last_uid ?? 0;
}

async function saveState(highestId: number): Promise<void> {
  const { supabaseAdmin } = await import("@/lib/supabase");
  await supabaseAdmin().from("poll_state").upsert(
    // uid_validity is NOT NULL and meaningless here; 1 is a constant, not data.
    { mailbox: STATE_KEY, uid_validity: 1, last_uid: highestId, updated_at: new Date().toISOString() },
    { onConflict: "mailbox" }
  );
}

async function toDiscord(url: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("Pushover bridge webhook returned", res.status);
    return res.ok;
  } catch (e) {
    console.error("Pushover bridge webhook failed:", e);
    return false;
  }
}

export async function GET(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    // Pushover reports "invalid email or password", "session expired" and the
    // like in its own error array, which lib/pushover.ts turns into a thrown
    // message. Letting that escape gives Next's bare 500 with an empty body —
    // useless precisely during setup, which is where the mistakes happen.
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

async function handle(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const q = new URL(req.url).searchParams;
  const webhook = process.env.PUSHOVER_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
  const roleId = process.env.PUSHOVER_ROLE_ID;

  // ── one-time setup ──
  // Credentials come in the query string and are used immediately; nothing is
  // written down. Run it once, paste the two values into the environment.
  if (q.get("setup")) {
    const email = q.get("email");
    const password = q.get("password");
    if (!email || !password) {
      return NextResponse.json(
        { error: "setup needs ?email=…&password=… (used once, never stored)" },
        { status: 400 }
      );
    }
    const { secret, userKey } = await login(email, password, q.get("twofa") ?? undefined);
    const { deviceId } = await registerDevice(secret, q.get("device") || "desktracker");
    return NextResponse.json({
      ok: true,
      next: "Put these in Vercel → Environment Variables, then redeploy.",
      PUSHOVER_SECRET: secret,
      PUSHOVER_DEVICE_ID: deviceId,
      PUSHOVER_USER_KEY: userKey,
      note: "Pushover requires a Pushover for Desktop licence within 30 days of activating an Open Client device.",
    });
  }

  // ── mint a group key for one source ──
  if (q.get("group")) {
    const token = process.env.PUSHOVER_APP_TOKEN;
    const user = process.env.PUSHOVER_USER_KEY;
    if (!token) return NextResponse.json({ error: "PUSHOVER_APP_TOKEN is not set" }, { status: 503 });
    const { groupKey } = await createGroup(token, q.get("group")!);
    // Add yourself, or the group delivers to nobody and the bridge sees nothing.
    if (user) await addUserToGroup(token, groupKey, user, "bridge");
    return NextResponse.json({
      ok: true,
      name: q.get("group"),
      groupKey,
      addedYou: !!user,
      next: "Paste this group key into that app's Pushover USER KEY field.",
    });
  }

  const secret = process.env.PUSHOVER_SECRET;
  const deviceId = process.env.PUSHOVER_DEVICE_ID;

  // ── webhook check ──
  if (q.get("test")) {
    if (!webhook) return NextResponse.json({ error: "no webhook configured" }, { status: 503 });
    const sample: PushoverMessage = {
      id: 0, app: "Test app", title: "Test alert",
      message: "Sample relay — no real notification.",
      date: Math.floor(Date.now() / 1000), priority: 0,
    };
    const ok = await toDiscord(webhook, pushoverEmbed(sample, roleId));
    return NextResponse.json({ test: true, delivered: ok, role: roleId ? `<@&${roleId}>` : "no ping" });
  }

  // ── the actual relay ──
  // Fail loudly instead of quietly doing nothing: a missing variable here looks
  // exactly like "no notifications arrived", which is the failure mode this
  // whole module exists to avoid.
  if (!secret || !deviceId) {
    return NextResponse.json(
      { error: "PUSHOVER_SECRET / PUSHOVER_DEVICE_ID are not set — run ?setup=1 first." },
      { status: 503 }
    );
  }
  if (!webhook) {
    return NextResponse.json({ error: "PUSHOVER_WEBHOOK_URL is not set." }, { status: 503 });
  }

  const messages = await fetchMessages(secret, deviceId);
  const already = await state();
  // Oldest first, so the channel reads in the order things happened.
  const fresh = messages.filter((m) => m.id > already).sort((a, b) => a.id - b.id);

  let delivered = 0;
  let highest = already;
  for (const m of fresh) {
    if (!(await toDiscord(webhook, pushoverEmbed(m, roleId)))) break; // stop at the first failure
    delivered++;
    highest = m.id;
  }

  // Acknowledge only what actually reached Discord. Anything after a failure
  // stays queued at Pushover and is retried on the next run.
  if (delivered > 0) {
    await saveState(highest);
    await acknowledge(secret, deviceId, highest);
  }

  return NextResponse.json({
    waiting: messages.length,
    new: fresh.length,
    delivered,
    highestId: highest,
    apps: [...new Set(fresh.map((m) => m.app))],
  });
}
