import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser } from "mailparser";
import { parseLa28Order, type La28Order } from "./parsers/la28";
import { htmlToText, pickExtractSource } from "./htmlText";

// ─────────────────────────────────────────────────────────────
// Generic mailbox scanner — the in-app port of the standalone SS Scraper.
//
// You give it a filter (subject contains + body phrases + folders + since) and
// it walks the matching mail READ-ONLY (BODY.PEEK, never marks \Seen) and
// returns the messages that match. It reuses the same Zoho account + env vars as
// the sale poller (IMAP_HOST/PORT/USER/PASSWORD).
//
// The catch: a Vercel function is capped at 60s, and a full-mailbox walk takes
// minutes. So a scan runs in CHUNKS: each call does a bounded slice of work and
// hands back a cursor; the browser calls again until `done`. That turns one long
// job into many short serverless calls.
//
// Speed trick, same as the Python tool: fetch cheap HEADERS in batches, keep only
// the subject-matches, and pull the (expensive) full body ONLY for those. A
// Subject filter therefore makes a scan dramatically faster.
// ─────────────────────────────────────────────────────────────

export type ScanFilter = {
  subjectContains?: string;
  bodyPhrases?: string[];
  matchAll?: boolean; // true = every phrase must be present; false = any one
  since?: string; // yyyy-mm-dd
  folders?: string[]; // raw folder paths to scan; empty = every selectable folder
  // Pull structured fields out of each matching mail into extra result columns.
  // A named format, not a boolean, so a second one can be added without changing
  // the wire shape. Turning this on forces the (slower) body fetch even when no
  // body phrases are set — there's nothing to parse from a header.
  extract?: "la28";
};

export type ScanHit = {
  recipient: string;
  deliveredTo: string;
  sender: string;
  senderName: string;
  subject: string;
  date: string; // yyyy-mm-dd HH:mm (UTC)
  folder: string;
  matched: string; // phrases actually found, joined by " || "
  messageId: string;
  uid: number;
  // Present only when `extract` is set AND the mail parsed. Left undefined
  // otherwise, so an unparsed row is visibly blank instead of a made-up zero.
  event?: string;
  eventDate?: string;
  venue?: string;
  qty?: number;
  total?: number;
  currency?: string;
  orderRef?: string;
};

export type ScanCursor = { folderIdx: number; belowUid: number } | null;

export type ScanChunk = {
  hits: ScanHit[];
  scanned: number; // headers examined this chunk
  folder: string; // folder being scanned (for the progress line)
  foldersTotal: number;
  cursor: ScanCursor; // null when the whole scan is finished
  done: boolean;
};

export type FolderInfo = { path: string; name: string; skip: boolean; reason: string };

// Never scan these — deleting/junk noise, and matching there is meaningless.
const SKIP_NAMES = new Set(["trash", "kos", "koš", "deleted", "deleted items", "deleted messages", "junk", "spam", "junk e-mail"]);

// Per-chunk budget. 45s of work leaves headroom under the 60s function ceiling;
// the window is the unit we check the clock between, so it never overruns by much.
const CHUNK_MS = 45_000;
// Speed comes from BATCHING commands: pull headers for a whole window in one
// FETCH, then pull the (few) matching bodies grouped into one FETCH per batch —
// instead of a round-trip per message, which is what made it crawl.
const HEADER_WINDOW = 300; // UIDs whose headers we pull in ONE fetch command
const BODY_BATCH = 50; // matched UIDs whose full source we pull in ONE fetch command
const MAX_BODIES_PER_CHUNK = 900; // defensive cap (fetches are batched, so generous)

function client(): ImapFlow {
  return new ImapFlow({
    host: process.env.IMAP_HOST || "imappro.zoho.eu",
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASSWORD! },
    logger: false,
  });
}

// ── text normalisation (mirror of the Python tool's loose()) ──────────
function loose(s: string): string {
  if (!s) return "";
  s = s.normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, "-")
    // drop anything that isn't a letter/number or a small kept set → space.
    // This is what strips emoji so a MIME/emoji subject still matches.
    .replace(/[^\p{L}\p{N} .,:;!?@/|\-'"()+&%_#*=]/gu, " ");
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}


function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  try {
    return d.toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return "";
  }
}

function headerValue(raw: Buffer | undefined, name: string): string {
  if (!raw) return "";
  const m = raw.toString("utf-8").match(new RegExp(`^${name}:\\s*(.+)$`, "im"));
  return m ? m[1].trim() : "";
}

function firstEmail(s: string): string {
  const m = (s || "").match(/[^\s<>@]+@[^\s<>@,;]+/);
  return m ? m[0].toLowerCase() : "";
}

// ── folders ───────────────────────────────────────────────────────────
export async function listFolders(): Promise<FolderInfo[]> {
  const c = client();
  await c.connect();
  try {
    const out: FolderInfo[] = [];
    for (const f of await c.list()) {
      const flags = f.flags ? new Set([...f.flags].map((x) => String(x).toLowerCase())) : new Set<string>();
      const special = (f.specialUse || "").toLowerCase();
      const leaf = (f.name || f.path).toLowerCase();
      let skip = false;
      let reason = "";
      if (flags.has("\\noselect") || flags.has("\\nonexistent")) (skip = true), (reason = "not selectable");
      else if (special === "\\trash" || special === "\\junk") (skip = true), (reason = "trash");
      else if (SKIP_NAMES.has(leaf)) (skip = true), (reason = "trash");
      out.push({ path: f.path, name: f.name || f.path, skip, reason });
    }
    return out;
  } finally {
    await c.logout();
  }
}

// Resolve which folders this scan should walk, in a stable order.
async function targetFolders(c: ImapFlow, want: string[] | undefined): Promise<FolderInfo[]> {
  const all: FolderInfo[] = [];
  for (const f of await c.list()) {
    const flags = f.flags ? new Set([...f.flags].map((x) => String(x).toLowerCase())) : new Set<string>();
    const special = (f.specialUse || "").toLowerCase();
    const leaf = (f.name || f.path).toLowerCase();
    let skip = false;
    let reason = "";
    if (flags.has("\\noselect") || flags.has("\\nonexistent")) (skip = true), (reason = "not selectable");
    else if (special === "\\trash" || special === "\\junk") (skip = true), (reason = "trash");
    else if (SKIP_NAMES.has(leaf)) (skip = true), (reason = "trash");
    all.push({ path: f.path, name: f.name || f.path, skip, reason });
  }
  const wanted = (want || []).filter(Boolean);
  const pool = all.filter((f) => !f.skip);
  const picked = wanted.length ? pool.filter((f) => wanted.includes(f.path)) : pool;
  return picked.sort((a, b) => a.path.localeCompare(b.path));
}

// ── one chunk of a scan ───────────────────────────────────────────────
export async function scanChunk(filter: ScanFilter, cursor: ScanCursor): Promise<ScanChunk> {
  const subjectNeedle = loose(filter.subjectContains || "");
  const phrases = (filter.bodyPhrases || [])
    .map((p) => ({ orig: p.trim(), needle: loose(p) }))
    .filter((p) => p.needle);
  const matchAll = filter.matchAll !== false;
  // Extraction needs the body too, even with zero phrases.
  const needBody = phrases.length > 0 || !!filter.extract;

  const c = client();
  await c.connect();
  const started = Date.now();
  try {
    const folders = await targetFolders(c, filter.folders);
    const foldersTotal = folders.length;
    let folderIdx = cursor?.folderIdx ?? 0;
    let belowUid = cursor?.belowUid ?? Number.MAX_SAFE_INTEGER;

    const hits: ScanHit[] = [];
    let scanned = 0;
    let bodies = 0;

    while (folderIdx < folders.length) {
      const folder = folders[folderIdx];
      const lock = await c.getMailboxLock(folder.path, { readOnly: true });
      try {
        // Server-side candidate search (SINCE + optional SUBJECT), newest first.
        const query: Record<string, unknown> = filter.since ? { since: new Date(filter.since) } : { all: true };
        if (subjectNeedle && (filter.subjectContains || "").trim() && /^[\x00-\x7F]*$/.test(filter.subjectContains || "")) {
          // Only pass an ASCII subject hint to the server; the real (emoji-safe)
          // check still happens locally on every candidate below.
          query.subject = (filter.subjectContains || "").trim();
        }
        // imapflow's SearchObject is a big union; we build it dynamically, so cast.
        let uids = (await c.search(query as Parameters<typeof c.search>[0], { uid: true })) as number[];
        uids = (uids || []).filter((u) => u < belowUid).sort((a, b) => b - a);

        let processed = 0;
        for (let w = 0; w < uids.length; w += HEADER_WINDOW) {
          if (Date.now() - started > CHUNK_MS || bodies >= MAX_BODIES_PER_CHUNK) break;
          const win = uids.slice(w, w + HEADER_WINDOW);

          // 1) Header pass — ONE fetch for the whole window; keep the subject-matches.
          const matches: { uid: number; env: FetchMessageObject["envelope"]; hdr: Buffer | undefined; subject: string }[] = [];
          for await (const msg of c.fetch(
            win.join(","),
            { uid: true, envelope: true, headers: ["delivered-to", "x-original-to", "envelope-to"] },
            { uid: true }
          )) {
            scanned++;
            const subject = msg.envelope?.subject || "";
            if (subjectNeedle && !loose(subject).includes(subjectNeedle)) continue;
            matches.push({ uid: Number(msg.uid), env: msg.envelope, hdr: msg.headers as Buffer | undefined, subject });
          }

          // 2) Body pass — only when phrases are set, BATCHED (one fetch per
          //    BODY_BATCH uids) instead of a round-trip per message.
          const bodyText = new Map<number, string>();
          const extracted = new Map<number, La28Order>();
          if (needBody && matches.length) {
            const ids = matches.map((m) => m.uid);
            for (let j = 0; j < ids.length; j += BODY_BATCH) {
              const grp = ids.slice(j, j + BODY_BATCH);
              for await (const msg of c.fetch(grp.join(","), { uid: true, source: true }, { uid: true })) {
                bodies++;
                if (!msg.source) continue;
                const parsed = await simpleParser(msg.source as Buffer);
                const uid = Number(msg.uid);
                const textPart = parsed.text || "";
                const htmlPart = htmlToText(typeof parsed.html === "string" ? parsed.html : "");
                bodyText.set(uid, textPart + "\n" + htmlPart);
                if (filter.extract === "la28") {
                  const order = parseLa28Order({
                    subject: matches.find((m) => m.uid === uid)?.subject ?? "",
                    body: pickExtractSource(textPart, htmlPart),
                  });
                  if (order) extracted.set(uid, order);
                }
              }
            }
          }

          // 3) Confirm the phrase match (loose, emoji/wrap-safe) and build hits.
          for (const m of matches) {
            const matched = matchPhrases(m.subject, bodyText.get(m.uid) || "", phrases, matchAll);
            if (matched === null) continue;

            const to = m.env?.to?.[0]?.address || "";
            const recipient =
              to ||
              firstEmail(headerValue(m.hdr, "x-original-to")) ||
              firstEmail(headerValue(m.hdr, "envelope-to")) ||
              firstEmail(headerValue(m.hdr, "delivered-to"));
            const order = extracted.get(m.uid);
            hits.push({
              recipient: recipient.toLowerCase(),
              deliveredTo: firstEmail(headerValue(m.hdr, "delivered-to")),
              sender: (m.env?.from?.[0]?.address || "").toLowerCase(),
              senderName: m.env?.from?.[0]?.name || "",
              subject: m.subject,
              date: fmtDate(m.env?.date),
              folder: folder.name,
              matched,
              messageId: m.env?.messageId || "",
              uid: m.uid,
              // Spread only the fields that parsed, so a mail the extractor
              // didn't recognise leaves its cells empty rather than showing 0.
              ...(order?.event ? { event: order.event } : {}),
              ...(order?.eventDate ? { eventDate: order.eventDate } : {}),
              ...(order?.venue ? { venue: order.venue } : {}),
              ...(order?.qty != null ? { qty: order.qty } : {}),
              ...(order?.total != null ? { total: order.total, currency: order.currency } : {}),
              ...(order?.orderRef ? { orderRef: order.orderRef } : {}),
            });
          }

          belowUid = win[win.length - 1]; // window is descending → last is the min
          processed += win.length;
        }

        const exhausted = processed >= uids.length;
        if (Date.now() - started > CHUNK_MS || bodies >= MAX_BODIES_PER_CHUNK) {
          // Ran out of budget mid-folder — resume this same folder next chunk.
          return { hits, scanned, folder: folder.name, foldersTotal, cursor: { folderIdx, belowUid }, done: false };
        }
        if (exhausted) {
          folderIdx++;
          belowUid = Number.MAX_SAFE_INTEGER;
        }
      } finally {
        lock.release();
      }
    }

    return { hits, scanned, folder: "", foldersTotal, cursor: null, done: true };
  } finally {
    await c.logout();
  }
}

function matchPhrases(
  subject: string,
  body: string,
  phrases: { orig: string; needle: string }[],
  all: boolean
): string | null {
  if (!phrases.length) return ""; // subject-only match already passed
  const hay = loose(subject + "\n" + body);
  const found = phrases.filter((p) => hay.includes(p.needle)).map((p) => p.orig);
  if (all && found.length !== phrases.length) return null;
  if (!all && found.length === 0) return null;
  return found.join(" || ");
}
