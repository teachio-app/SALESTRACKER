import { Parser, ParsedSale, RawEmail } from "./types";

// ─────────────────────────────────────────────────────────────
// SEATIX / GIGSBERG SALE PARSER
//
// Detected by BODY CONTENT, not by sender. (This once said the mail arrives
// "forwarded via catch-all", and lib/mailFilter.ts was designed around that
// claim; sampling the mailbox showed it actually arrives straight from
// sales@seatiks.com. Body detection is kept anyway — it costs nothing and still
// works if a forwarded copy ever does turn up.) Markers:
//   - "Sale Confirmation" header
//   - "Financial Summary" section
//   - labelled table: Event / Date / Venue / Quantity / Section / Row / Seats
//   - euro formatted as "675.00€" (symbol last)
//
// Note: body says "Platform: Gigsberg"; kept as source "seatix" per your naming.
// This layout uniquely exposes face value + payout, so we fill buy_price too.
// ─────────────────────────────────────────────────────────────

function first(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m) return null;
  const g = m.slice(1).find((x) => x != null);
  return g ? g.trim().replace(/\s+/g, " ") : null;
}

function isSeatix(body: string): boolean {
  const hits =
    (/Sale\s+Confirmation/i.test(body) ? 1 : 0) +
    (/Financial\s+Summary/i.test(body) ? 1 : 0) +
    (/Total\s+face\s+value/i.test(body) ? 1 : 0);
  return hits >= 2;
}

// "18/07/2026 17:00" → "2026-07-18"
function parseSeatixDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// "675.00€" or "1500.00€" → 675.0 / 1500.0
function parseEuro(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^\d.,]/g, "").replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

export const parseSeatix: Parser = (email: RawEmail): ParsedSale | null => {
  const body = email.text || email.html || "";
  if (!isSeatix(body)) return null;

  // Every label is anchored to the START of a line and closed with a word
  // boundary. Both halves earned their place:
  //
  //   * unanchored, `Seats?` matched inside the sender "sales@seatiks.com" —
  //     "Seat" + "iks…" — and the alert went out reading
  //     "Seats iks sales@seatiks.com" instead of the seat number. `\b` after
  //     `Seats?` kills that: "Seat" followed by "i" is not a word boundary.
  //   * `^` stops any label word appearing mid-sentence in the body from
  //     winning, since first() takes the earliest match in the whole mail.
  //
  // [ \t]* rather than \s* for the gap, so a label can never swallow the next
  // line's content when its own value is empty.
  const eventName = first(body, /^[ \t]*Event\b[ \t]*\n?[ \t]*([^\n]+)/im);
  const rawDate = first(body, /^[ \t]*Date\b[ \t]*\n?[ \t]*(\d{1,2}\/\d{1,2}\/\d{4}[^\n]*)/im);
  const venue = first(body, /^[ \t]*Venue\b[ \t]*\n?[ \t]*([^\n]+)/im);
  const qtyStr = first(body, /^[ \t]*Quantity\b[ \t]*\n?[ \t]*(\d+)/im);
  const clean = (s: string | null, label: RegExp) =>
    s ? s.replace(label, "").trim() : null;
  const section = clean(first(body, /^[ \t]*Section\b[ \t]*\n?[ \t]*([^\n]+)/im), /^Section\s*/i);
  const row = clean(first(body, /^[ \t]*Row\b[ \t]*\n?[ \t]*([^\n]+)/im), /^Row\s*/i);
  const seats = clean(first(body, /^[ \t]*Seats?\b[ \t]*\n?[ \t]*([^\n]+)/im), /^Seats?\s*/i);

  const payoutStr = first(body, /^[ \t]*Payout\b[ \t]*\n?[ \t]*([\d.,]+\s*€)/im);
  const faceStr = first(body, /^[ \t]*Total\s+face\s+value\b[ \t]*\n?[ \t]*([\d.,]+\s*€)/im);

  const payout = parseEuro(payoutStr);
  const faceValue = parseEuro(faceStr);

  // No stable order # in this layout — build a dedupe key from event+date+seat.
  const dedupeSeed = `${eventName ?? ""}|${rawDate ?? ""}|${section ?? ""}|${row ?? ""}|${seats ?? ""}`;
  const externalId = `seatix:${hash(dedupeSeed)}`;

  if (!eventName || payout == null) return null;

  return {
    source: "seatix",
    externalId,
    orderRef: null,
    eventName,
    eventDate: parseSeatixDate(rawDate),
    location: venue,
    section,
    seatRow: row,
    seats,
    qty: qtyStr ? parseInt(qtyStr, 10) : 1,
    sellPrice: payout,
    currency: "EUR",
    ...(faceValue != null ? { faceValue } : {}),
  };
};

// tiny stable string hash for dedupe keys
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}
