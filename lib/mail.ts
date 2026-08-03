import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { RawEmail } from "./parsers";
import { supabaseAdmin } from "./supabase";
import { isBulkNoise } from "./mailNoise";

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
const MAX_BODIES = 15;        // full sources per run — unchanged, still the cap that matters
// Leave the rest of the 60s budget for parsing and for the caller's own work.
const ENVELOPE_MS = 20_000;

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
    let scannedTo = mark.last_uid;
    for (let lo = from; lo <= windowTop; lo += ENVELOPE_BATCH) {
      if (Date.now() - started > ENVELOPE_MS) break;
      const hi = Math.min(lo + ENVELOPE_BATCH - 1, windowTop);
      for await (const msg of client.fetch(`${lo}:${hi}`, { uid: true, envelope: true }, { uid: true })) {
        // `X:Y` ranges can return messages outside the range on some servers.
        // Trust the UID, not the range.
        const uid = Number(msg.uid);
        if (uid < lo || uid > hi) continue;
        if (!isBulkNoise({ from: msg.envelope?.from?.[0]?.address, subject: msg.envelope?.subject })) {
          candidates.push(uid);
        }
      }
      scannedTo = hi;
    }
    candidates.sort((a, b) => a - b);

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

    for (const uid of wanted) {
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
      `${skipped} skipped as noise` + (behind > 0 ? `, ${behind} still behind` : "");
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
