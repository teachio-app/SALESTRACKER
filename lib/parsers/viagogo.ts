import { Parser, ParsedSale, RawEmail } from "./types";

// ─────────────────────────────────────────────────────────────
// VIAGOGO SALE PARSER
//
// Emails arrive FORWARDED via catch-all, so we detect the platform by
// BODY CONTENT, not the From address. Distinctive Viagogo markers:
//   - "you sold" headline
//   - "Payout details" / "Payout option"
//   - "Sale #<digits>"
//   - euro formatted as "€3,691.80" (symbol first, comma thousands)
//
// Event name & venue are found by POSITION, not keywords. The layout is:
//
//     …blurb…
//                                     ← blank
//     England vs Argentina - …        ← event name  (line before the date)
//     Wednesday, July 15, 2026 - …    ← THE ANCHOR
//                                     ← blank
//     Mercedes-Benz Stadium, Atlanta  ← venue       (line after the date)
//                                     ← blank
//     Sale #648690186
//
// An earlier version keyed off /World Cup|vs/ and /Stadium/, which silently
// produced `eventName: "Congrats, you sold 2 tickets!"` and `venue: null` for
// any non-football sale — a plausible-looking bad row, not a skip. Anchoring on
// the date line is layout-driven and survives concerts, arenas, any sport.
// ─────────────────────────────────────────────────────────────

function first(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m) return null;
  const g = m.slice(1).find((x) => x != null);
  return g ? g.trim().replace(/\s+/g, " ") : null;
}

function isViagogo(body: string): boolean {
  const hits =
    (/you sold\b/i.test(body) ? 1 : 0) +
    (/Payout\s+details|Payout\s+option/i.test(body) ? 1 : 0) +
    (/Sale\s*#\s*\d{6,}/i.test(body) ? 1 : 0);
  return hits >= 2;
}

function parseViagogoDate(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw.replace(/\s*-\s*/, " "));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// "Wednesday, July 15, 2026 - 03:00 pm" — the one line we can trust to sit
// between the event name and the venue.
const DATE_LINE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,\s+\w+\s+\d{1,2},\s+\d{4}\b/i;

// Lines that are chrome, never an event name or a venue.
const NOT_CONTENT = /you sold|^congrats\b|^sale\s*#|^payout\b|^qty\b|^section\b|^row\b|^seats?\b/i;

type Block = { eventName: string | null; rawDate: string | null; venue: string | null };

// Walk out from the date line: event name is the nearest non-empty line above,
// venue the nearest non-empty line below.
function locateEventBlock(body: string): Block {
  const lines = body.split("\n").map((l) => l.trim());
  const i = lines.findIndex((l) => DATE_LINE.test(l));
  if (i === -1) return { eventName: null, rawDate: null, venue: null };

  let before: string | null = null;
  for (let j = i - 1; j >= 0; j--) {
    if (!lines[j]) continue;
    if (NOT_CONTENT.test(lines[j])) break; // hit the headline — no event name here
    before = lines[j];
    break;
  }

  let after: string | null = null;
  for (let j = i + 1; j < lines.length; j++) {
    if (!lines[j]) continue;
    if (NOT_CONTENT.test(lines[j])) break; // ran into "Sale #…" — no venue line
    after = lines[j];
    break;
  }

  return { eventName: before, rawDate: lines[i], venue: after };
}

// The payout is the € amount inside the "Payout details" block, not merely the
// last € in the mail — a footer or promo € would otherwise win.
function findPayout(body: string): number | null {
  const idx = body.search(/Payout\s+details/i);
  const scope = idx === -1 ? body : body.slice(idx);
  const euros = scope.match(/€\s?[\d.,]+/g) ?? body.match(/€\s?[\d.,]+/g);
  return euros ? parseEuro(euros[euros.length - 1]) : null;
}

function parseEuro(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^\d.,]/g, "").replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

export const parseViagogo: Parser = (email: RawEmail): ParsedSale | null => {
  const body = email.text || email.html || "";
  if (!isViagogo(body)) return null;

  const orderRef = first(body, /Sale\s*#\s*(\d{6,})/i);
  const { eventName, rawDate, venue } = locateEventBlock(body);
  const section = first(body, /Section\s*\n?\s*([A-Za-z0-9]+)/i);
  const row = first(body, /Row\s*\n?\s*([A-Za-z0-9]+)/i);
  const seats = first(body, /Seats?\s*\n?\s*(\d+\s*-\s*\d+|\d+)/i);
  const qtyStr = first(body, /Qty\s*\n?\s*(\d+)|Ticket\s*qty\s*\n?\s*(\d+)/i);
  const payout = findPayout(body);

  // Essentials missing → skip the mail entirely. The caller flags it for review
  // rather than inserting a row we had to guess at.
  if (!orderRef || !eventName || payout == null) return null;

  return {
    source: "viagogo",
    externalId: `viagogo:${orderRef}`,
    orderRef,
    eventName,
    eventDate: parseViagogoDate(rawDate),
    location: venue,
    section,
    seatRow: row,
    seats,
    qty: qtyStr ? parseInt(qtyStr, 10) : 1,
    sellPrice: payout,
    currency: "EUR",
  };
};
