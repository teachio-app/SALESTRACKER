import { NextResponse } from "next/server";
import { fetchNewEmails } from "@/lib/mail";
import { parseSeatix } from "@/lib/parsers/seatix";
import { notifySeatixSale, seatixAlertPayload } from "@/lib/discord";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────
// SEATIX SALE ALERTER — a standalone module. Mail in, Discord out.
//
// Deliberately NOT part of the dashboard:
//
//   * it has no page, no component and no context — a route handler never
//     reaches the client bundle, so the dashboard doesn't grow by a byte and
//     doesn't wait on anything here;
//   * it writes NOTHING to `tickets`. It doesn't create rows, doesn't match
//     seats, doesn't touch the review queue. The sale poller owns all of that
//     and is untouched by this file;
//   * its only state is one row in `poll_state` — its own watermark, under its
//     own key, so it and the sale poller can read the same INBOX without
//     eating each other's mail. No schema change: `poll_state` is keyed by
//     name, so the row appears on first run.
//
// Auth is the same Bearer CRON_SECRET the sale poller uses; `/api/cron/*` is
// outside the login middleware's matcher, so no session is involved.
//
// Scheduling: point a second external pinger job (cron-job.org) at this URL,
// exactly like /api/cron/poll-mail. It is deliberately NOT added to
// vercel.json — Hobby cron fires once a day, which is useless for a sale alert,
// and a second entry there would only risk the plan's cron limit on every
// deploy.
//
// Setup check: GET ?test=1 posts a sample alert so the webhook and the role
// ping can be verified without waiting for a real sale. It touches no mail and
// moves no watermark.
// ─────────────────────────────────────────────────────────────

const STATE_KEY = "INBOX@seatix-alert";
// Parsing costs a fraction of what the sale poller does per message (no DB
// round-trips, no seat matching), but the mail fetch itself is the slow part —
// keep it inside the 60s function budget with room to spare.
const MAX_PER_RUN = 25;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const webhook = process.env.SEATIX_WEBHOOK_URL;
  const roleId = process.env.SEATIX_ROLE_ID;
  // Fail loudly rather than quietly consuming mail into a webhook that isn't
  // there: without this, a missing env var would advance the watermark past
  // real sales and nobody would ever be told about them.
  if (!webhook) {
    return NextResponse.json(
      { error: "SEATIX_WEBHOOK_URL is not set — nothing was read or notified." },
      { status: 503 }
    );
  }

  // ── setup check ──
  if (new URL(req.url).searchParams.get("test")) {
    const sample = {
      source: "seatix" as const,
      externalId: "seatix:test",
      orderRef: null,
      eventName: "Test alert — no real sale",
      eventDate: new Date().toISOString().slice(0, 10),
      location: "Hard Rock Stadium",
      section: "122",
      seatRow: "30",
      seats: "10",
      qty: 1,
      sellPrice: 675,
      currency: "EUR",
      faceValue: 1500,
    };
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(seatixAlertPayload(sample, roleId)),
    });
    return NextResponse.json({
      test: true,
      webhook: `HTTP ${res.status}`,
      role: roleId ? `<@&${roleId}>` : "no SEATIX_ROLE_ID set — sent without a ping",
    });
  }

  const { emails, commit, info } = await fetchNewEmails({ stateKey: STATE_KEY, maxPerRun: MAX_PER_RUN });

  const stats = { read: emails.length, seatix: 0, notified: 0, info };
  let failed = false;

  for (const email of emails) {
    const sale = parseSeatix(email);
    if (!sale) continue; // anything that isn't a Seatix sale is not this module's business
    stats.seatix++;
    if (await notifySeatixSale(sale)) stats.notified++;
    else failed = true; // hold the watermark so the alert is retried next run
  }

  // Same rule as the sale poller: the watermark only advances on a clean run,
  // so a Discord outage delays alerts instead of losing them.
  if (!failed) await commit();

  return NextResponse.json({ ...stats, committed: !failed });
}
