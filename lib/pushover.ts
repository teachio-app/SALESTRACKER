// ─────────────────────────────────────────────────────────────
// PUSHOVER OPEN CLIENT
//
// Pushover's ordinary API only SENDS. To receive what other apps push at you,
// you have to be a client — that's the Open Client API, and it's what makes a
// Pushover → Discord bridge possible at all:
//
//   POST /1/users/login.json                          email+password → secret
//   POST /1/devices.json            secret, os=O                     → device_id
//   GET  /1/messages.json           secret, device_id                → messages
//   POST /1/devices/<id>/update_highest_message.json                 → acknowledge
//
// Two things worth knowing before relying on this:
//
//   * Login takes the ACCOUNT PASSWORD, not a key. So it happens once, during
//     setup, and only the resulting `secret` and `device_id` are kept — the
//     password is never stored anywhere. A leaked secret can read messages;
//     a leaked password owns the account.
//   * Pushover licenses an Open Client as a desktop device: a Pushover for
//     Desktop licence is required within 30 days of activating one.
//
// The Groups API is here too, because a group key can be handed out IN PLACE OF
// a user key — one per source, so every bot gets its own and the bridge can tell
// them apart:
//
//   POST /1/groups.json                    token, name → new group key
//   POST /1/groups/<key>/add_user.json     token, user
// ─────────────────────────────────────────────────────────────

const API = "https://api.pushover.net/1";

export type PushoverMessage = {
  id: number;
  message: string;
  title?: string;
  app: string;
  aid?: number;
  icon?: string;
  date: number; // unix seconds
  priority?: number;
  url?: string;
  url_title?: string;
  acked?: number;
  umid?: number;
};

async function call(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "POST"
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params);
  const url = method === "GET" ? `${API}${path}?${body}` : `${API}${path}`;
  const res = await fetch(url, {
    method,
    ...(method === "POST"
      ? { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
      : {}),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.status !== 1) {
    // Pushover reports failures in an `errors` array with a 4xx; surface it
    // verbatim so a wrong password or an expired secret says so.
    const errs = Array.isArray(json.errors) ? json.errors.join("; ") : `HTTP ${res.status}`;
    throw new Error(`Pushover ${path}: ${errs}`);
  }
  return json;
}

/** Step 1 of setup. Returns the session secret — the password is not kept. */
export async function login(email: string, password: string, twofa?: string) {
  const json = await call("/users/login.json", {
    email,
    password,
    ...(twofa ? { twofa } : {}),
  });
  return { secret: String(json.secret), userKey: String(json.id) };
}

/** Step 2 of setup. `os=O` is what marks this as an Open Client device. */
export async function registerDevice(secret: string, name: string) {
  const json = await call("/devices.json", { secret, name, os: "O" });
  return { deviceId: String(json.id) };
}

/** Everything queued for this device since the last acknowledgement. */
export async function fetchMessages(secret: string, deviceId: string): Promise<PushoverMessage[]> {
  const json = await call("/messages.json", { secret, device_id: deviceId }, "GET");
  return Array.isArray(json.messages) ? (json.messages as PushoverMessage[]) : [];
}

/**
 * Mark everything up to `highestId` as delivered — Pushover then drops those
 * messages for this device. Called only AFTER they reached Discord, so a
 * webhook outage delays alerts instead of losing them (same contract as the
 * mail poller's watermark).
 */
export async function acknowledge(secret: string, deviceId: string, highestId: number) {
  await call(`/devices/${encodeURIComponent(deviceId)}/update_highest_message.json`, {
    secret,
    message: String(highestId),
  });
}

/** Mint a group key to hand to one source, in place of the user key. */
export async function createGroup(token: string, name: string) {
  const json = await call("/groups.json", { token, name });
  return { groupKey: String(json.group_key ?? json.group ?? json.key) };
}

/** Put a user (yours) into a group, so pushes to that key still reach you. */
export async function addUserToGroup(token: string, groupKey: string, user: string, memo?: string) {
  await call(`/groups/${encodeURIComponent(groupKey)}/add_user.json`, {
    token,
    user,
    ...(memo ? { memo } : {}),
  });
}

// ── Discord rendering ─────────────────────────────────────────────────
// Pushover's own priority scale, coloured the way the rest of this app colours
// things: red for emergency/high, blue for normal, grey for quiet.
const PRIORITY_COLOR: Record<number, number> = {
  2: 0xd03b3b, // emergency
  1: 0xd9a441, // high
  0: 0x3987e5, // normal
  [-1]: 0x6f6f6f, // low
  [-2]: 0x3d3d3d, // lowest
};
const PRIORITY_NAME: Record<number, string> = {
  2: "emergency", 1: "high", 0: "normal", [-1]: "low", [-2]: "lowest",
};

function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + "…";
}

/**
 * One Pushover message as a Discord payload.
 *
 * The sending app's name is the headline, because with a group key per source
 * that's the thing you need to see first: WHICH bot is shouting. The message
 * title, when there is one, becomes the embed title; when there isn't, the app
 * name carries it alone rather than leaving an empty heading.
 */
export function pushoverEmbed(msg: PushoverMessage, roleId?: string): Record<string, unknown> {
  const priority = msg.priority ?? 0;
  const title = (msg.title ?? "").trim();

  const embed: Record<string, unknown> = {
    title: clamp(title || msg.app || "Pushover", 256),
    description: clamp((msg.message ?? "").trim(), 4096) || undefined,
    color: PRIORITY_COLOR[priority] ?? PRIORITY_COLOR[0],
    ...(msg.url ? { url: msg.url } : {}),
    fields: [
      { name: "App", value: clamp(msg.app || "—", 1024), inline: true },
      ...(priority !== 0
        ? [{ name: "Priority", value: PRIORITY_NAME[priority] ?? String(priority), inline: true }]
        : []),
      ...(msg.url ? [{ name: msg.url_title || "Link", value: clamp(msg.url, 1024), inline: false }] : []),
    ],
    footer: { text: "Pushover" },
    // Pushover dates are unix seconds; Discord wants ISO.
    timestamp: new Date((msg.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
  };

  return {
    ...(roleId ? { content: `<@&${roleId}>`, allowed_mentions: { parse: [], roles: [roleId] } } : {}),
    embeds: [embed],
  };
}
