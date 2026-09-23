import { NextResponse } from "next/server";
import { fetchNewEmails, type MailAccount } from "@/lib/mail";
import { parseSneakerSale, type SneakerSale } from "@/lib/parsers/sneakers";
import { notifySneakerSale, sneakerAlertPayload } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────
// SNEAKER SALE ALERTER — Hypeboost and StockX, mail in, Discord out.
//
// Standalone like the Seatix alerter: no page, no client bundle, and nothing
// written to `tickets`. A shoe is not a ticket — no event, no seat, no date to
// play — and filing one in the ticket table would quietly start counting
// trainers in the ticket reports.
//
// It reads a DIFFERENT mailbox: these sales land in a Gmail account rather than
// the Zoho catch-all, so the connection comes from its own env vars. The
// watermark is its own too — a watermark records where ONE reader got to, and
// two readers sharing a row consume each other's mail.
//
//   (none)     poll and relay — what the pinger calls
//   ?test=1    post a sample alert, to check the webhook and the role ping
// ─────────────────────────────────────────────────────────────

const STATE_KEY = "GMAIL@sneaker-alert";
// Parsing is cheap here (no DB round-trips, no seat matching); the mail fetch is
// the slow part, and the run is bounded inside fetchNewEmails either way.
const MAX_PER_RUN = 40;

function account(): MailAccount | null {
  const user = process.env.SNEAKER_IMAP_USER;
  const pass = process.env.SNEAKER_IMAP_PASSWORD;
  if (!user || !pass) return null;
  return {
    host: process.env.SNEAKER_IMAP_HOST || "imap.gmail.com",
    port: Number(process.env.SNEAKER_IMAP_PORT || 993),
    user,
    pass,
  };
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

  const webhook = process.env.SNEAKER_WEBHOOK_URL;
  const roleId = process.env.SNEAKER_ROLE_ID;
  // Fail loudly rather than read mail into a webhook that isn't there: a missing
  // variable would otherwise advance the watermark past sales nobody was told
  // about, which looks exactly like "nothing sold".
  if (!webhook) {
    return NextResponse.json(
      { error: "SNEAKER_WEBHOOK_URL is not set — nothing was read or notified." },
      { status: 503 }
    );
  }

  if (new URL(req.url).searchParams.get("test")) {
    const sample: SneakerSale = {
      platform: "stockx", externalId: "stockx:test", orderRef: "04-TESTORDER",
      product: "Test alert — no real sale", size: "US M 8.5", sku: "CT8012-047",
      condition: "New", salePrice: 221, payout: 188.69, currency: "EUR",
      fees: 32.31, shipBy: new Date().toISOString().slice(0, 10),
    };
    const res = await fetch(webhook, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sneakerAlertPayload(sample, roleId)),
    });
    return NextResponse.json({
      test: true, webhook: `HTTP ${res.status}`,
      role: roleId ? `<@&${roleId}>` : "no SNEAKER_ROLE_ID set — sent without a ping",
    });
  }

  const acct = account();
  if (!acct) {
    return NextResponse.json(
      { error: "SNEAKER_IMAP_USER / SNEAKER_IMAP_PASSWORD are not set." },
      { status: 503 }
    );
  }

  const { emails, commit, info } = await fetchNewEmails({
    stateKey: STATE_KEY, maxPerRun: MAX_PER_RUN, account: acct,
  });

  const stats = { read: emails.length, sales: 0, notified: 0, platforms: [] as string[], info };
  let failed = false;

  for (const email of emails) {
    const sale = parseSneakerSale(email);
    if (!sale) continue; // both platforms send plenty that isn't a sale
    stats.sales++;
    if (await notifySneakerSale(sale)) {
      stats.notified++;
      if (!stats.platforms.includes(sale.platform)) stats.platforms.push(sale.platform);
    } else {
      failed = true; // hold the watermark so the alert is retried next run
    }
  }

  // Same contract as everywhere else: the watermark advances only on a clean
  // run, so a Discord outage delays alerts instead of losing them.
  if (!failed) await commit();

  return NextResponse.json({ ...stats, committed: !failed });
}
