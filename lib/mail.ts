import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { RawEmail } from "./parsers";
import { supabaseAdmin } from "./supabase";
import { shouldOpen, senderDomain } from "./mailFilter";

// ─────────────────────────────────────────────────────────────
// Reads new mail WITHOUT changing anything about the mailbox.
//
// Two rules, both learned the hard way against a 29k-message working inbox:
//
//  1. INBOX is opened readOnly, so the server is not permitted to set \Seen.
//     The owner's read/unread state is theirs, not our queue.
//  2. "Where did we get to" lives in the poll_state table, keyed on IMAP UIDs,
//     which increase monotonically per mailbox.
//
// The previous version read every UNSEEN message and marked each one \Seen —
// which on this account meant silently marking 2,558 real emails as read on the
// first run, and blowing the 60s function budget doing it.
//
// First run adopts the current high-water mark and processes nothing: we start
// from now rather than backfilling years of history.
// ─────────────────────────────────────────────────────────────

const MAILBOX = "INBOX";

// Each consumer of the mailbox keeps its OWN watermark row, because a watermark
// records "where THIS reader got to". The sale poller and the Seatix alerter
// read the same INBOX for different reasons and must not consume each other's
// mail — one advancing past a message would silently hide it from the other.
//
// The default is the bare mailbox name, unchanged, so the existing poller keeps
// using the row it has been writing since day one.
const DEFAULT_STATE_KEY = MAILBOX;

// ── Two-phase read ────────────────────────────────────────────────────
// Bodies are expensive: pulling a full source off Zoho and running it through
// mailparser clocks ~2s, so only 15 fit in the 60s function budget. Envelopes
// are not: 1,732 of them came back in 3.6 seconds on this same account.
//
// The old single-phase read downloaded every body in UID order and so managed
// ~180 messages an hour. This mailbox receives about a THOUSAND an hour, almost
// all of it relayed bot noise, so the poller fell further behind every hour and
// simply never reached a sale. Scanning envelopes first and paying for bodies
// only where a sale could plausibly be turns that around completely.
const ENVELOPE_WINDOW = 4000; // UIDs whose envelopes one run may scan
const ENVELOPE_BATCH = 1000;  // per FETCH command
// Measured on this account rather than guessed: a run opening 15 bodies and
// scanning ~2,800 envelopes finished in 12s, so a body costs ~0.4s, not the ~2s
// the original estimate assumed. 40 bodies ≈ 16s on top of an ~8s envelope
// sweep — comfortably inside the 60s function budget, and with the allow-list
// keeping candidates to a few hundred a day, enough to stay at the front.
const MAX_BODIES = 40;

// ── The deadline that actually matters is the CALLER'S ────────────────
// Vercel allows 60s, but the thing invoking this is an external pinger, and
// cron-job.org gives up at 30 and disables a job that keeps failing. That is not
// hypothetical: both jobs died on 10 August and sat Inactive for two weeks while
// the mailbox filled, because the old poller opened 15 bodies at ~2s each and
// overran 30s. The function was never the constraint — the client was.
//
// So the run is bounded end to end, not just per phase. Whatever isn't reached
// stays for the next run; the watermark only ever advances over what was
// actually examined, which is what makes stopping early safe.
const RUN_MS = 18_000;
const ENVELOPE_MS = 9_000;

type Watermark = { uid_validity: number; last_uid: number };

/**
 * Where the watermark lands after a run examined UIDs up to `rangeTop`.
 *
 * Pure, and exported, because getting it wrong is invisible: the poller keeps
 * answering 200 and quietly stops seeing mail. See the call site for the
 * ten-day outage this caused.
 */
export function advanceWatermark(rangeTop: number, highestUidSeen: number): number {
  return Math.max(rangeTop, highestUidSeen);
}

async function readWatermark(key: string): Promise<Watermark | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("poll_state")
    .select("uid_validity,last_uid")
    .eq("mailbox", key)
    .maybeSingle();
  return data ?? null;
}

async function writeWatermark(key: string, uidValidity: number, lastUid: number): Promise<void> {
  const db = supabaseAdmin();
  await db.from("poll_state").upsert(
    { mailbox: key, uid_validity: uidValidity, last_uid: lastUid, updated_at: new Date().toISOString() },
    { onConflict: "mailbox" }
  );
}

export type FetchResult = {
  emails: RawEmail[];
  /** Call after the emails are safely stored — not before. */
  commit: () => Promise<void>;
  info: string;
};

export type FetchOptions = {
  /** Which watermark row to use. Omit for the sale poller's original one. */
  stateKey?: string;
  /** Override the per-run body cap — a reader that only parses can afford more. */
  maxPerRun?: number;
};

export async function fetchNewEmails(opts: FetchOptions = {}): Promise<FetchResult> {
  const stateKey = opts.stateKey || DEFAULT_STATE_KEY;
  const maxBodies = opts.maxPerRun ?? MAX_BODIES;
  const started = Date.now();
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || "imappro.zoho.eu",
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: {
      user: process.env.IMAP_USER!,
      pass: process.env.IMAP_PASSWORD!, // Zoho app-specific password
    },
    logger: false,
  });

  const emails: RawEmail[] = [];
  let highestSeen = 0;
  let uidValidity = 0;
  let info = "";
  let skipped = 0;
  let topSkipped = "";

  await client.connect();

  // readOnly: the server may not set \Seen on anything we touch.
  const lock = await client.getMailboxLock(MAILBOX, { readOnly: true });
  try {
    const box = client.mailbox as { uidValidity: bigint | number; uidNext: bigint | number };
    uidValidity = Number(box.uidValidity);
    const uidNext = Number(box.uidNext);

    const mark = await readWatermark(stateKey);

    // No watermark, or the server renumbered the mailbox → adopt the current
    // position and process nothing this run.
    if (!mark || mark.uid_validity !== uidValidity) {
      const start = Math.max(0, uidNext - 1);
      highestSeen = start;
      info = mark
        ? `uidvalidity changed (${mark.uid_validity} → ${uidValidity}); watermark reset to ${start}`
        : `first run; watermark set to ${start}, nothing backfilled`;
      await writeWatermark(stateKey, uidValidity, start);
      return { emails: [], commit: async () => {}, info };
    }

    const from = mark.last_uid + 1;
    if (from >= uidNext) {
      return { emails: [], commit: async () => {}, info: "no new mail" };
    }

    const windowTop = Math.min(uidNext - 1, mark.last_uid + ENVELOPE_WINDOW);
    highestSeen = mark.last_uid;

    // ── Phase 1: envelopes ── cheap, batched, and the only thing that decides
    // what's worth opening. `scannedTo` tracks how far we actually got, so a
    // run cut short by the clock resumes rather than skipping.
    const candidates: number[] = [];
    // Who is being passed over, and how often. Skipping is invisible by nature,
    // so the counts go back in the response: a ticket platform appearing here
    // means the filter is wrong, and that should be readable rather than
    // waiting to be noticed by an alert that never came.
    const skippedBy = new Map<string, number>();
    let scannedTo = mark.last_uid;
    for (let lo = from; lo <= windowTop; lo += ENVELOPE_BATCH) {
      if (Date.now() - started > ENVELOPE_MS) break;
      const hi = Math.min(lo + ENVELOPE_BATCH - 1, windowTop);
      for await (const msg of client.fetch(`${lo}:${hi}`, { uid: true, envelope: true }, { uid: true })) {
        // `X:Y` ranges can return messages outside the range on some servers.
        // Trust the UID, not the range.
        const uid = Number(msg.uid);
        if (uid < lo || uid > hi) continue;
        const env = { from: msg.envelope?.from?.[0]?.address, subject: msg.envelope?.subject };
        if (shouldOpen(env)) {
          candidates.push(uid);
        } else {
          const d = senderDomain(env.from) || "(no sender)";
          skippedBy.set(d, (skippedBy.get(d) ?? 0) + 1);
        }
      }
      scannedTo = hi;
    }
    candidates.sort((a, b) => a - b);
    topSkipped = [...skippedBy.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([d, n]) => `${d}×${n}`).join(", ");

    // ── Phase 2: bodies, for candidates only ──
    // More candidates than the cap? Take the oldest, and hold the watermark at
    // the last one opened so the remainder is picked up next run instead of
    // being skipped.
    let examinedTo = scannedTo;
    let wanted = candidates;
    if (candidates.length > maxBodies) {
      wanted = candidates.slice(0, maxBodies);
      examinedTo = wanted[wanted.length - 1];
    }
    let lastOpened = mark.last_uid;

    for (const uid of wanted) {
      // Out of time: stop here and let the watermark sit at the last message
      // actually opened. The rest is picked up next run, not skipped.
      if (Date.now() - started > RUN_MS) {
        examinedTo = emails.length ? lastOpened : mark.last_uid;
        break;
      }
      for await (const msg of client.fetch(String(uid), { source: true, uid: true }, { uid: true })) {
        if (Number(msg.uid) !== uid || !msg.source) continue;
        const parsed = await simpleParser(msg.source as Buffer);
        emails.push({
          from: parsed.from?.text || "",
          subject: parsed.subject || "",
          text: parsed.text || "",
          html: typeof parsed.html === "string" ? parsed.html : "",
          date: parsed.date || new Date(),
        });
        lastOpened = uid;
      }
    }
    const to = examinedTo;
    skipped = Math.max(0, scannedTo - mark.last_uid) - candidates.length;

    // The whole range from..to has now been examined, so that is where the
    // watermark belongs — NOT merely at the highest UID that came back.
    //
    // UIDs are not contiguous: deleting or moving a message leaves a permanent
    // hole. A range that lands entirely in a hole returns nothing, and the old
    // code then wrote back the unchanged watermark — so the next run requested
    // the same dead range, got nothing again, and so on forever. That is exactly
    // what happened here: the poller sat on uid 55583..55597 for ten days,
    // 4,186 messages behind, silently never reaching another sale.
    //
    // Empty range examined = range dealt with. max() because some servers hand
    // back messages past the end of a `X:Y` range, and those were processed too.
    highestSeen = advanceWatermark(to, highestSeen);

    const behind = uidNext - 1 - to;
    info =
      `uid ${from}..${to}, ${emails.length} opened of ${candidates.length} candidate(s), ` +
      `${skipped} not opened` + (topSkipped ? ` [${topSkipped}]` : "") +
      (behind > 0 ? `, ${behind} still behind` : "");
  } finally {
    lock.release();
    await client.logout();
  }

  // The watermark advances only once the caller says the rows are stored. Moving
  // it here would drop mail on the floor if the insert failed afterwards.
  return {
    emails,
    commit: () => writeWatermark(stateKey, uidValidity, highestSeen),
    info,
  };
}
