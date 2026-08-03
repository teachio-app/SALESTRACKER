import { ParsedSale } from "./parsers";
import type { ViagogoPayment } from "./parsers/viagogoPayment";

// A ping only fires if the message CONTENT holds `<@id>` (embeds never ping),
// and Discord needs the numeric user ID — a username can't be mentioned. Set
// DISCORD_MENTION_USER_ID to your ID and every alert tags you.
function mention(): { content?: string; allowed_mentions?: object } {
  const id = process.env.DISCORD_MENTION_USER_ID;
  return id ? { content: `<@${id}>`, allowed_mentions: { parse: [], users: [id] } } : {};
}

async function post(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // A Discord hiccup must never break the poll.
    console.error("Discord notify failed:", err);
  }
}

// Fire-and-forget Discord notification. Discord is notification-only here —
// it never feeds data back into the app.
export async function notifyDiscord(sale: ParsedSale): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  // Seat identity lives in three fields now; join them for display only.
  const seat = [
    sale.section && `Section ${sale.section}`,
    sale.seatRow && `Row ${sale.seatRow}`,
    sale.seats && `Seats ${sale.seats}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const embed = {
    title: `💰 Sold — ${sale.eventName}`,
    color: 0x0ca30c,
    fields: [
      { name: "Payout", value: `${sale.sellPrice.toFixed(2)} ${sale.currency}`, inline: true },
      { name: "Qty", value: String(sale.qty), inline: true },
      { name: "Source", value: sale.source, inline: true },
      ...(seat ? [{ name: "Seat", value: seat, inline: false }] : []),
      ...(sale.location ? [{ name: "Location", value: sale.location, inline: false }] : []),
      ...(sale.orderRef ? [{ name: "Order", value: sale.orderRef, inline: true }] : []),
    ],
    timestamp: new Date().toISOString(),
  };

  await post(url, { ...mention(), embeds: [embed] });
}

// ── Scanner finish notification ───────────────────────────────────────
// Unlike the sale/payout pings, the webhook URL here is USER-SUPPLIED (typed
// into the Scanner UI), not an env var — so a live webhook token never has to
// live in the repo. Optionally attaches the results CSV as a real file, exactly
// like the old standalone scraper did. Returns a result so the UI can show it.
const MAX_CSV_BYTES = 7 * 1024 * 1024; // Discord's limit is 8 MB — keep a margin

export async function notifyScan(opts: {
  url: string;
  mentionId?: string;
  matches: number;
  scanned: number;
  account: string;
  scope?: string;
  stopped?: boolean;
  csv?: { name: string; content: string };
}): Promise<{ ok: boolean; detail: string }> {
  if (!opts.url || !/^https?:\/\//i.test(opts.url)) return { ok: false, detail: "no/invalid webhook URL" };

  const embed = {
    title: opts.stopped ? "🟠 Scan stopped" : "✅ Scan finished",
    color: opts.stopped ? 0xf0a93b : 0x3ecf8e,
    fields: [
      { name: "Matches", value: `**${opts.matches}**`, inline: true },
      { name: "Scanned", value: String(opts.scanned), inline: true },
      { name: "Account", value: opts.account || "—", inline: true },
      ...(opts.scope ? [{ name: "Filter", value: opts.scope.slice(0, 1000), inline: false }] : []),
    ],
    footer: { text: "DeskTracker · Scanner" },
    timestamp: new Date().toISOString(),
  };

  const payloadObj: Record<string, unknown> = { embeds: [embed] };
  if (opts.mentionId) {
    payloadObj.content = `<@${opts.mentionId}>`;
    payloadObj.allowed_mentions = { parse: [], users: [opts.mentionId] };
  }
  const payload = JSON.stringify(payloadObj);

  try {
    const attach = opts.csv && opts.csv.content && opts.csv.content.length <= MAX_CSV_BYTES;
    if (attach && opts.csv) {
      // multipart/form-data: payload_json + the CSV as files[0], same shape Discord
      // expects and the old scraper used. Blob carries the boundary content-type.
      const boundary = "----desktracker" + Math.random().toString(16).slice(2);
      const body = new Blob(
        [
          `--${boundary}\r\nContent-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json\r\n\r\n`,
          payload,
          `\r\n--${boundary}\r\nContent-Disposition: form-data; name="files[0]"; filename="${opts.csv.name}"\r\nContent-Type: text/csv; charset=utf-8\r\n\r\n`,
          opts.csv.content,
          `\r\n--${boundary}--\r\n`,
        ],
        { type: `multipart/form-data; boundary=${boundary}` }
      );
      const res = await fetch(opts.url, { method: "POST", body });
      return { ok: res.ok, detail: `HTTP ${res.status}` + (res.ok ? " + CSV" : "") };
    }
    const res = await fetch(opts.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ── Seatix sale alert (standalone module) ─────────────────────────────
// Its own webhook, its own channel, its own role ping — see
// app/api/cron/seatix-alert/route.ts. Nothing here touches the dashboard or the
// tickets table; it is a mail→Discord relay and nothing else.
//
// A ROLE is mentioned as `<@&id>`. The user syntax `<@id>` renders as a dead
// grey "@unknown-user" and pings nobody — the single easiest thing to get wrong
// here, hence the test in lib/discord.test.ts.
//
// allowed_mentions is the second half: `parse: []` blocks @everyone and every
// stray mention the embed text might contain, and `roles: [id]` re-permits
// exactly the one role we mean. Without it a webhook can be turned into an
// @everyone megaphone by anything that lands in an event name.
// Two separate jobs, deliberately not one function: flattening belongs to text
// that came out of an email (an event name can carry newlines and runs of
// spaces), while clamping applies to strings this file composed and whose
// layout — the line break between "where" and "seat" — must survive.
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

// Discord rejects the whole request when a limit is exceeded: an over-long
// title is a 400 and no alert at all, not a shortened title. Cut on a word
// boundary so what's left reads as a name rather than a severed string.
function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + "…";
}

export function seatixAlertPayload(
  sale: ParsedSale,
  roleId?: string
): Record<string, unknown> {
  // Seat identity on ONE line, labelled, in the order the ticket states it.
  const seat = [
    sale.section && `Section **${sale.section}**`,
    sale.seatRow && `Row **${sale.seatRow}**`,
    sale.seats && `Seat **${sale.seats}**`,
  ]
    .filter(Boolean)
    .join("  ·  ");

  // Where and when go in the description, so the fields below hold only money
  // and counts — three tidy columns instead of a ragged six.
  const where = [sale.eventDate, sale.location].filter(Boolean).join("  ·  ");

  const embed = {
    title: clamp(oneLine(`🎟️ Seatix — ${sale.eventName}`), 256),
    color: 0x0ca30c,
    description: clamp([where, seat].filter(Boolean).join("\n"), 4096) || undefined,
    fields: [
      { name: "Payout", value: `**${sale.sellPrice.toFixed(2)} ${sale.currency}**`, inline: true },
      { name: "Tickets", value: String(sale.qty), inline: true },
      {
        name: "Face value",
        value: sale.faceValue != null ? `${sale.faceValue.toFixed(2)} ${sale.currency}` : "—",
        inline: true,
      },
    ],
    footer: { text: sale.orderRef ? `Seatix · order ${sale.orderRef}` : "Seatix" },
    timestamp: new Date().toISOString(),
  };

  return {
    ...(roleId ? { content: `<@&${roleId}>`, allowed_mentions: { parse: [], roles: [roleId] } } : {}),
    embeds: [embed],
  };
}

/** Post one Seatix sale to the standalone alert webhook. */
export async function notifySeatixSale(sale: ParsedSale): Promise<boolean> {
  const url = process.env.SEATIX_WEBHOOK_URL;
  if (!url) return false;
  const payload = seatixAlertPayload(sale, process.env.SEATIX_ROLE_ID);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error("Seatix alert webhook returned", res.status);
    return res.ok;
  } catch (err) {
    // A Discord hiccup must never break the run — the watermark decides what
    // gets retried, not this.
    console.error("Seatix alert failed:", err);
    return false;
  }
}

// Payout notification — a separate webhook (DISCORD_PAYMENT_WEBHOOK_URL) so
// "money landed" pings can go to their own channel, apart from sale alerts.
export async function notifyPayment(payment: ViagogoPayment, markedPaid = 0): Promise<void> {
  const url = process.env.DISCORD_PAYMENT_WEBHOOK_URL;
  if (!url) return;

  const lines = payment.items.map(
    (it) => `• ${it.eventName ?? "—"} — €${it.amount.toFixed(2)}${it.qty ? ` (${it.qty})` : ""}`
  );

  const embed = {
    title: `💸 Paid out — €${payment.total.toFixed(2)}`,
    color: 0x3987e5,
    description: lines.join("\n") || undefined,
    fields: [
      { name: "Reference", value: payment.reference, inline: true },
      ...(payment.paidOn ? [{ name: "Processed", value: payment.paidOn, inline: true }] : []),
      { name: "Orders", value: String(payment.items.length), inline: true },
      ...(markedPaid > 0
        ? [{ name: "Auto-marked paid", value: `${markedPaid} sale${markedPaid === 1 ? "" : "s"} ✓`, inline: true }]
        : []),
    ],
    footer: { text: "viagogo · may take up to 8 business days to hit the bank" },
    timestamp: new Date().toISOString(),
  };

  await post(url, { ...mention(), embeds: [embed] });
}
