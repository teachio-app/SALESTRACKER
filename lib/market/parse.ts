// ─────────────────────────────────────────────────────────────
// Turning a captured Sales Tracker page into rows.
//
// Two things here are worth more than they look.
//
// NOT-A-NUMBER IS NOT ZERO. The tiles render "N/A" until their panel loads, and
// a capture taken a second too early carries it. Read as 0, an event shows
// "2,150 tickets available" one hour and "0 available, 584 sold" the next, which
// reads as a sell-out and is the single most expensive thing this file could get
// wrong. null means "not known", and null is what gets stored.
//
// TIME IS APPROXIMATE AND SAYS SO. The table gives "9h ago", not a timestamp.
// Nine hours before the capture is the best that can be done, and it is worth
// ±30 minutes — so the precision travels with the value instead of being
// forgotten the moment it lands in a timestamptz column.
// ─────────────────────────────────────────────────────────────

import { parseAmount, currencyOf } from "../parsers/money";
import type { Capture, ParsedSale, ParsedStats, RawSale } from "./types";

/** Values a tile shows when it has nothing to show. */
const NOT_KNOWN = /^\s*(n\/?a|-|—|–|null|undefined|loading\.?\.?\.?)?\s*$/i;

export function isNotKnown(raw: string | null | undefined): boolean {
  return raw == null || NOT_KNOWN.test(raw);
}

/**
 * A plain count: "584", "1 261", "1,261", "2150".
 *
 * Thousands separators are stripped rather than fed to parseAmount, because a
 * count has no decimal part and "1,261" must never come back as 1.261.
 */
export function parseCount(raw: string | null | undefined): number | null {
  if (isNotKnown(raw)) return null;
  const digits = (raw as string).replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/** Money, or null when the tile hasn't loaded. Punctuation handled upstream. */
export function parseMoney(raw: string | null | undefined): number | null {
  if (isNotKnown(raw)) return null;
  return parseAmount(raw as string);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * "Sep 15, 2026" and "Sunday, January 17, 2027" → "2026-09-15" / "2027-01-17".
 *
 * Matched on the first three letters, so the long and short forms are one case.
 * The weekday is skipped by requiring a day number and a year after the month
 * name — "Sunday" has neither following it.
 */
export function parseAbsoluteDate(raw: string | null | undefined): string | null {
  if (isNotKnown(raw)) return null;
  const re = /([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw as string)) !== null) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mo === -1) continue; // "Sunday, January 17" — skip the weekday, keep looking
    return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  return null;
}

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  // 30 days. A month is not a fixed length, and this is a relative label on a
  // resale page, not an accounting date.
  mo: 2_592_000_000,
  y: 31_536_000_000,
};

const UNIT_PRECISION: Record<string, ParsedSale["precision"]> = {
  s: "exact", m: "minute", h: "hour", d: "day", w: "week", mo: "month", y: "month",
};

/**
 * "9h ago" to an ISO instant, given when the page was captured.
 *
 * Handles the short forms the table uses and the long ones a redesign might
 * ("2 days ago", "just now"). Unrecognised text returns null WITH precision
 * "unknown" rather than defaulting to the capture time — a sale wrongly stamped
 * "now" would poison the 24h rate, which is the number the buy decision leans
 * on hardest.
 */
export function parseRelativeTime(
  raw: string | null | undefined,
  capturedAt: Date
): { at: string | null; precision: ParsedSale["precision"] } {
  const text = (raw ?? "").trim().toLowerCase();
  if (!text) return { at: null, precision: "unknown" };

  if (/^(just now|now|moments? ago|<\s*1\s*m)/.test(text)) {
    return { at: capturedAt.toISOString(), precision: "minute" };
  }

  // "9h", "45 min", "2 days", "1mo", "3 w" — number, optional space, unit word.
  const m = text.match(
    /(\d+)\s*(mo\b|months?|min(?:ute)?s?|sec(?:ond)?s?|hours?|days?|weeks?|years?|[smhdwy])\b/
  );
  if (!m) {
    // An absolute date in the column instead of a relative one.
    const abs = parseAbsoluteDate(raw);
    return abs ? { at: `${abs}T12:00:00.000Z`, precision: "day" } : { at: null, precision: "unknown" };
  }

  const n = parseInt(m[1], 10);
  const word = m[2];
  // Order matters: "mo" and "month" must be tested before "m" and "min", or a
  // month becomes a minute — a sale from four weeks ago landing four minutes
  // ago, straight into the 24h count.
  const unit =
    /^mo/.test(word) ? "mo" :
    /^min|^m$/.test(word) ? "m" :
    /^sec|^s$/.test(word) ? "s" :
    /^h/.test(word) ? "h" :
    /^d/.test(word) ? "d" :
    /^w/.test(word) ? "w" :
    /^y/.test(word) ? "y" : null;
  if (!unit) return { at: null, precision: "unknown" };

  return {
    at: new Date(capturedAt.getTime() - n * UNIT_MS[unit]).toISOString(),
    precision: UNIT_PRECISION[unit],
  };
}

/** A seat spec is only usable as an identity if it actually has a number in it. */
export function usableSeats(seats: string | null | undefined): boolean {
  return !!seats && /\d/.test(seats);
}

/**
 * The identity of a sale, so revisiting an event doesn't record it again.
 *
 * Seats are the natural key — the same seats cannot sell twice — so when they
 * are present that IS the fingerprint, and it stays stable however the "9h ago"
 * column drifts on later visits.
 *
 * They are not always present. The live page renders junk ("from - froo", their
 * own scrape leaking through), and some listings are general admission. Identity
 * then falls back to the sale's shape plus the HOUR it happened: coarse enough
 * to survive the relative-time drift a later capture brings, fine enough that
 * two genuinely different sales rarely collide.
 */
export function saleFingerprint(sale: {
  section: string | null; seat_row: string | null; seats: string | null;
  price: number | null; qty: number | null; sold_at_approx: string | null;
}): string {
  const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, "");
  const money = sale.price == null ? "?" : sale.price.toFixed(2);
  if (usableSeats(sale.seats)) {
    return `s|${norm(sale.section)}|${norm(sale.seat_row)}|${norm(sale.seats)}|${money}`;
  }
  const hour = sale.sold_at_approx ? sale.sold_at_approx.slice(0, 13) : "?";
  return `t|${norm(sale.section)}|${norm(sale.seat_row)}|${sale.qty ?? "?"}|${money}|${hour}`;
}

export function parseSale(
  raw: RawSale,
  capturedAt: Date,
  fallbackCurrency: string
): ParsedSale & { currency: string } {
  const { at, precision } = parseRelativeTime(raw.updateText, capturedAt);
  const clean = (s: string | undefined) => {
    const t = (s ?? "").trim();
    return t === "" || isNotKnown(t) ? null : t;
  };
  const base = {
    price: parseMoney(raw.price),
    qty: parseCount(raw.quantity),
    section: clean(raw.section),
    seat_row: clean(raw.row),
    seats: clean(raw.seats),
    sold_at_approx: at,
    precision,
    raw_update: (raw.updateText ?? "").trim(),
  };
  return {
    ...base,
    fingerprint: saleFingerprint(base),
    currency: raw.price && /[€$£]/.test(raw.price) ? currencyOf(raw.price) : fallbackCurrency,
  };
}

export function parseStats(c: Capture): ParsedStats {
  const s = c.stats ?? {};
  return {
    total_sales: parseCount(s.totalSales),
    total_tickets: parseCount(s.totalTickets),
    average_price: parseMoney(s.averagePrice),
    floor_price: parseMoney(s.floorPrice),
    sales_24h: parseCount(s.sales24h),
    first_sale: parseAbsoluteDate(s.firstSale),
    listings: parseCount(s.listings),
    tickets_available: parseCount(s.ticketsAvailable),
    // The page has a currency selector; the tiles carry the symbol too. Prefer
    // what was selected, fall back to reading a symbol off a tile.
    currency: c.currency?.trim().toUpperCase() || currencyOf(s.averagePrice, s.floorPrice),
  };
}

/**
 * Is this capture worth storing as a snapshot?
 *
 * A page caught mid-load has a name and nothing else. Storing it would put a
 * row of nulls into the time series, and a chart drawn through it shows a
 * collapse that never happened.
 */
export function snapshotIsUseful(stats: ParsedStats): boolean {
  return stats.total_sales != null || stats.listings != null || stats.tickets_available != null;
}

/** Everything the ingest route needs, in one call, so the route stays thin. */
export function parseCapture(c: Capture) {
  const parsed = new Date(c.capturedAt);
  const at = isNaN(parsed.getTime()) ? new Date() : parsed;
  const stats = parseStats(c);
  const sales = (c.sales ?? []).map((r) => parseSale(r, at, stats.currency));
  // One page can repeat a sale across a re-render; collapse before the DB sees it.
  const unique = new Map<string, (typeof sales)[number]>();
  for (const s of sales) if (!unique.has(s.fingerprint)) unique.set(s.fingerprint, s);
  return {
    capturedAt: at.toISOString(),
    eventDate: parseAbsoluteDate(c.event?.dateText),
    stats,
    sales: [...unique.values()],
    useful: snapshotIsUseful(stats),
  };
}
