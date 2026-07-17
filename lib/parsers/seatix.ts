import { Parser, ParsedSale, RawEmail } from "./types";

// ─────────────────────────────────────────────────────────────
// SEATIX / GIGSBERG SALE PARSER
//
// Forwarded via catch-all → detect by BODY CONTENT. Markers:
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

  const eventName = first(body, /Event\s*\n?\s*([^\n]+)/i);
  const rawDate = first(body, /Date\s*\n?\s*(\d{1,2}\/\d{1,2}\/\d{4}[^\n]*)/i);
  const venue = first(body, /Venue\s*\n?\s*([^\n]+)/i);
  const qtyStr = first(body, /Quantity\s*\n?\s*(\d+)/i);
  const clean = (s: string | null, label: RegExp) =>
    s ? s.replace(label, "").trim() : null;
  const section = clean(first(body, /Section\s*\n?\s*([^\n]+)/i), /^Section\s*/i);
  const row = clean(first(body, /Row\s*\n?\s*([^\n]+)/i), /^Row\s*/i);
  const seats = clean(first(body, /Seats?\s*\n?\s*([^\n]+)/i), /^Seats?\s*/i);

  const payoutStr = first(body, /Payout\s*\n?\s*([\d.,]+\s*€)/i);
  const faceStr = first(body, /Total\s+face\s+value\s*\n?\s*([\d.,]+\s*€)/i);

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
