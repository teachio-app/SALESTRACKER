import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { RawEmail } from "./parsers";
import { supabaseAdmin } from "./supabase";
import { shouldOpen, senderDomain, type Envelope } from "./mailFilter";

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
// How far ahead one run may look. Generous now that the SERVER does the
// filtering: the cost is the number of hits, not the size of the range, so a
// backlog of thousands drains in a run or two instead of never.
const ENVELOPE_WINDOW = 100_000;
// Measured on this account rather than guessed: a run opening 15 bodies and
// scanning ~2,800 envelopes finished in 12s, so a body costs ~0.4s, not the ~2s
// the original estimate assumed. 40 bodies ≈ 16s on top of an ~8s envelope
// sweep — comfortably inside the 60s function budget, and with the allow-list
// keeping candidates to a few hundred a day, enough to stay at the front.
const MAX_BODIES = 40;
// Bodies are fetched in groups: one FETCH per group rather than per message,
// which is both quicker and less likely to have a single command refused.
const BODY_BATCH = 10;

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

// What the server is asked for, as one OR'd SEARCH. Deliberately broader than
// mailFilter's rules — SEARCH is a coarse sieve and the real decision still
// happens here — but narrow enough that a 160,000-message mailbox returns a
// handful of UIDs instead of a hundred thousand envelopes.
const SEARCH_TERMS = [
  { from: "viagogo" },
  { from: "seatiks" },
  { from: "seatix" },
  { from: "gigsberg" },
  { from: "stubhub" },
  { from: "ticombo" },
  { from: "vividseats" },
  { from: "stockx" },
  { from: "hypeboost" },
  // Forwarded or relayed sales, which carry no platform sender.
  { subject: "sale confirmation" },
  { subject: "you sold" },
  { subject: "sold your" },
  { subject: "has been sold" },
  { subject: "total proceeds" },
  { subject: "send your tickets" },
  { subject: "you have just been paid" },
];

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

/**
 * Move the watermark forward — never backward.
 *
 * Two runs can overlap: a cron firing while another is still going, or a manual
 * run alongside the scheduler. Each reads the mark at the start and writes its
 * own result at the end, so the slower one used to overwrite the faster one's
 * progress with a LOWER number. Observed live: a run finished at 164246 and a
 * cron that had started earlier put it back to 141599, sending the poller over
 * 20,000 messages it had already read.
 *
 * Nothing was lost — external_id dedupes the repeats — but the work was, so the
 * write is now conditional on the stored value still being lower. A reset to an
 * EARLIER position (adopting a mailbox, or a deliberate rewind) goes through
 * `force`, which is the only way the number is allowed to fall.
 */
async function writeWatermark(
  key: string,
  uidValidity: number,
  lastUid: number,
  force = false
): Promise<void> {
  const db = supabaseAdmin();
  const row = {
    mailbox: key,
    uid_validity: uidValidity,
    last_uid: lastUid,
    updated_at: new Date().toISOString(),
  };
  if (force) {
    await db.from("poll_state").upsert(row, { onConflict: "mailbox" });
    return;
  }
  // Conditional update first; only insert if this reader has no row yet.
  const { data } = await db
    .from("poll_state")
    .update(row)
    .eq("mailbox", key)
    .lt("last_uid", lastUid)
    .select("mailbox");
  if (!data?.length) {
    const { data: existing } = await db
      .from("poll_state").select("last_uid").eq("mailbox", key).maybeSingle();
    if (!existing) await db.from("poll_state").insert(row);
    // Otherwise the stored mark is already at or past this one: leave it.
  }
}

export type FetchResult = {
  emails: RawEmail[];
  /** Call after the emails are safely stored — not before. */
  commit: () => Promise<void>;
  info: string;
};

export type MailAccount = { host: string; port?: number; user: string; pass: string };

export type FetchOptions = {
  /** Which watermark row to use. Omit for the sale poller's original one. */
  stateKey?: string;
  /** Override the per-run body cap — a reader that only parses can afford more. */
  maxPerRun?: number;
  /**
   * A different mailbox. The sneaker sales arrive at a Gmail account, not the
   * Zoho catch-all, so the connection can't be read from one fixed set of env
   * vars any more. Omit it and the ticket side behaves exactly as before.
   */
  account?: MailAccount;
  /**
   * A stricter test than the shared allow-list, for a mailbox where it isn't
   * selective enough. The sneaker senders write thousands of price alerts for
   * every sale, so that module narrows it by subject.
   */
  filter?: (env: Envelope) => boolean;
};

export async function fetchNewEmails(opts: FetchOptions = {}): Promise<FetchResult> {
  const stateKey = opts.stateKey || DEFAULT_STATE_KEY;
  const maxBodies = opts.maxPerRun ?? MAX_BODIES;
  const started = Date.now();
  const account: MailAccount = opts.account ?? {
    host: process.env.IMAP_HOST || "imappro.zoho.eu",
    port: Number(process.env.IMAP_PORT || 993),
    user: process.env.IMAP_USER!,
    pass: process.env.IMAP_PASSWORD!, // Zoho app-specific password
  };
  const client = new ImapFlow({
    host: account.host,
    port: account.port ?? 993,
    secure: true,
    auth: { user: account.user, pass: account.pass },
    logger: false,
  });

  const emails: RawEmail[] = [];
  let highestSeen = 0;
  let uidValidity = 0;
  let info = "";
  let skipped = 0;
  let topSkipped = "";
  // Candidates the server offered but whose body never arrived. They are NOT
  // stepped over — the watermark stops before them — and they are reported,
  // because a silent skip here is a lost sale.
  let unread = 0;

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
      await writeWatermark(stateKey, uidValidity, start, true);
      return { emails: [], commit: async () => {}, info };
    }

    const from = mark.last_uid + 1;
    if (from >= uidNext) {
      return { emails: [], commit: async () => {}, info: "no new mail" };
    }

    const windowTop = Math.min(uidNext - 1, mark.last_uid + ENVELOPE_WINDOW);
    highestSeen = mark.last_uid;

    // ── Phase 1: ask the SERVER which messages could matter ──────────
    //
    // This used to pull envelopes a thousand at a time and filter them here.
    // That worked at 30k messages and collapsed at 160k: a single batch of
    // 1,000 envelopes came to cost most of a 9-second budget, so a run examined
    // ~1,000 UIDs, took 43 seconds end to end, and often died at Vercel's 60s
    // ceiling before committing anything. The mailbox was growing by thousands
    // a day and the poller was 7,198 behind and losing.
    //
    // IMAP can do the filtering itself. One SEARCH over the whole range returns
    // just the UIDs worth opening, and the work no longer scales with how much
    // junk arrived — only with how much of it is actually from a platform.
    //
    // The envelopes of the hits are still checked against the same filter
    // afterwards, so the rules in mailFilter.ts stay the single definition of
    // "worth opening" and a server with looser matching can't widen them.
    const candidates: number[] = [];
    const skippedBy = new Map<string, number>();
    let scannedTo = mark.last_uid;

    const range = `${from}:${windowTop}`;
    let hits: number[] = [];
    try {
      hits = ((await client.search(
        { uid: range, or: SEARCH_TERMS } as Parameters<typeof client.search>[0],
        { uid: true }
      )) ?? []) as number[];
    } catch (e) {
      // A server that dislikes the query must not stall the poller forever;
      // fall back to opening nothing this run and say so.
      console.error("IMAP search failed:", e);
      hits = [];
    }

    // Confirm each hit against our own rules — and record what it rejects, so
    // an unfamiliar sender shows up in the cron response rather than nowhere.
    if (hits.length) {
      for await (const msg of client.fetch(
        hits.join(","), { uid: true, envelope: true }, { uid: true }
      )) {
        const uid = Number(msg.uid);
        if (uid < from || uid > windowTop) continue;
        const env = { from: msg.envelope?.from?.[0]?.address, subject: msg.envelope?.subject };
        if ((opts.filter ?? shouldOpen)(env)) candidates.push(uid);
        else {
          const d = senderDomain(env.from) || "(no sender)";
          skippedBy.set(d, (skippedBy.get(d) ?? 0) + 1);
        }
      }
    }
    // The whole range was examined by the server, not just the part we opened.
    scannedTo = windowTop;
    candidates.sort((a, b) => a - b);
    topSkipped = [...skippedBy.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([d, n]) => `${d}×${n}`).join(", ");

    // ── Phase 2: bodies, for candidates only ──
    //
    // The watermark may pass a candidate ONLY if its body was actually read.
    //
    // It used to advance over the whole searched range whenever the candidate
    // list fitted under the cap, regardless of how many bodies came back. A
    // FETCH that returns nothing — the server declining, a message moved
    // mid-run — therefore skipped that sale permanently and silently. Caught by
    // putting a real sale mail in the mailbox and watching it vanish: the run
    // logged "17 candidate(s), 13 opened", and four sales were gone. The same
    // mail, alone in the window, processed perfectly. That is why this looked
    // like a parser fault for weeks and never was one.
    const wanted = candidates.length > maxBodies ? candidates.slice(0, maxBodies) : candidates;
    const opened = new Set<number>();

    // Batched: one FETCH per group rather than per message. Fewer commands is
    // faster and gives the server less opportunity to refuse one.
    for (let i = 0; i < wanted.length; i += BODY_BATCH) {
      if (Date.now() - started > RUN_MS) break;
      const group = wanted.slice(i, i + BODY_BATCH);
      for await (const msg of client.fetch(group.join(","), { source: true, uid: true }, { uid: true })) {
        const uid = Number(msg.uid);
        if (!group.includes(uid) || !msg.source) continue;
        const parsed = await simpleParser(msg.source as Buffer);
        emails.push({
          from: parsed.from?.text || "",
          subject: parsed.subject || "",
          text: parsed.text || "",
          html: typeof parsed.html === "string" ? parsed.html : "",
          date: parsed.date || new Date(),
        });
        opened.add(uid);
      }
    }

    // Advance across the run of candidates that were read, and stop dead at the
    // first one that wasn't — that message stays unread and is retried, rather
    // than being stepped over. Only when every candidate the server offered was
    // read does the mark jump to the top of the searched range.
    const missed = wanted.filter((u) => !opened.has(u));
    let examinedTo: number;
    if (missed.length === 0 && wanted.length === candidates.length) {
      examinedTo = scannedTo;
    } else {
      examinedTo = mark.last_uid;
      for (const uid of wanted) {
        if (!opened.has(uid)) break;
        examinedTo = uid;
      }
    }
    unread = missed.length;
    const to = examinedTo;
    // Hits the server returned that our own rules turned down.
    skipped = Math.max(0, hits.length - candidates.length);

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
      `uid ${from}..${to}, searched ${windowTop - from + 1}, ` +
      `${candidates.length} candidate(s), ${emails.length} opened` +
      (skipped > 0 ? `, ${skipped} rejected` : "") +
      (unread > 0 ? `, ${unread} unread — HELD for retry` : "") +
      (topSkipped ? ` [${topSkipped}]` : "") +
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
