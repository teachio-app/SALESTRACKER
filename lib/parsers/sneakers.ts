// ─────────────────────────────────────────────────────────────
// SNEAKER SALE PARSERS — Hypeboost and StockX
//
// A different trade from the ticket side, so a different shape: there is no
// event, no date to play, no seat. What matters is the item, the size, and what
// actually lands after the platform takes its cut.
//
// Deliberately NOT ParsedSale: forcing a shoe into eventName/eventDate/section
// would put a shipping deadline where an event date goes, and the ticket
// reports would quietly start counting trainers.
// ─────────────────────────────────────────────────────────────

import { parseAmount, currencyOf } from "./money";

export type SneakerSale = {
  platform: "hypeboost" | "stockx";
  externalId: string;      // platform:order — the dedupe key
  orderRef: string;
  product: string;
  size: string | null;
  sku: string | null;
  condition: string | null;
  /** Gross, when the mail states it. StockX does; Hypeboost shows payout only. */
  salePrice: number | null;
  /** What actually lands after fees — the number that matters. */
  payout: number;
  currency: string;
  /** salePrice − payout, when both are known. */
  fees: number | null;
  shipBy: string | null;   // ISO, the deadline to post the item
};

export type RawMail = { from?: string; subject?: string; text?: string; html?: string };

const MONTHS = ["january","february","march","april","may","june","july",
  "august","september","october","november","december"];

/** "16-06-2026" (day-first, as Hypeboost writes it) → "2026-06-16". */
export function parseDashDate(raw: string | null | undefined): string | null {
  const m = raw?.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** "September 15, 2026" → "2026-09-15". */
export function parseLongDate(raw: string | null | undefined): string | null {
  const m = raw?.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase());
  if (mo === -1) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

const body = (e: RawMail) => `${e.subject ?? ""}\n${e.text || e.html || ""}`;
const grab = (s: string, re: RegExp): string | null => {
  const m = s.match(re);
  return m ? (m[1] ?? "").trim().replace(/\s+/g, " ") || null : null;
};

// ── Hypeboost ─────────────────────────────────────────────────────────
// "Congratulations! Your item has been sold: <product>", from noreply@hypeboost.com.
// Payout only — the gross and the fee are never stated, so salePrice stays null
// rather than being invented from the payout.
export function parseHypeboost(email: RawMail): SneakerSale | null {
  const b = body(email);
  if (!/hypeboost/i.test(`${email.from ?? ""}${b}`)) return null;
  if (!/your item (has been|is) sold/i.test(b)) return null;

  const payoutStr = grab(b, /^[ \t]*Payout[ \t]*:?[ \t]*\n?[ \t]*([^\n]+)/im);
  const payout = parseAmount(payoutStr);
  const orderRef = grab(b, /Advertisement\s+number[ \t]*:?[ \t]*\n?[ \t]*(\d+)/i);
  if (payout == null || !orderRef) return null;

  // The subject carries the product cleanly; the body repeats it above Size.
  const product =
    grab(b, /item has been sold[ \t]*:[ \t]*([^\n]+)/i) ??
    grab(b, /^[ \t]*([^\n]+)\n[ \t]*Size[ \t]*:/im) ??
    "(unnamed item)";

  return {
    platform: "hypeboost",
    externalId: `hypeboost:${orderRef}`,
    orderRef,
    product,
    size: grab(b, /^[ \t]*Size[ \t]*:[ \t]*([^\n]+)/im),
    sku: grab(b, /^[ \t]*SKU[ \t]*:[ \t]*([^\n]+)/im),
    condition: null,
    salePrice: null,
    payout,
    currency: currencyOf(payoutStr),
    fees: null,
    shipBy: parseDashDate(grab(b, /Ship\s+by[ \t]*:?[ \t]*([^\n]+)/i)),
  };
}

// ── StockX ────────────────────────────────────────────────────────────
// "✅ You Sold Your <product>", from noreply@stockx.com. States the gross, each
// fee, and the payout, so the fee total is derived rather than re-added up from
// lines whose wording changes ("Transaction Fee (8.0%)", "Payment Proc. (3%)").
export function parseStockx(email: RawMail): SneakerSale | null {
  const b = body(email);
  if (!/stockx/i.test(`${email.from ?? ""}${b}`)) return null;
  if (!/you sold your|time to ship your item/i.test(b)) return null;

  const orderRef = grab(b, /Order\s+number[ \t]*:?[ \t]*\n?[ \t]*([A-Z0-9-]{6,})/i);
  const payoutStr = grab(b, /Total\s+Payout[ \t]*:?[ \t]*\n?[ \t]*([^\n]+)/i);
  const payout = parseAmount(payoutStr);
  if (payout == null || !orderRef) return null;

  const priceStr = grab(b, /Sale\s+Price[ \t]*:?[ \t]*\n?[ \t]*([^\n]+)/i);
  const salePrice = parseAmount(priceStr);
  const product =
    grab(b, /You\s+Sold\s+Your[ \t]*([^\n]+)/i) ??
    grab(b, /^[ \t]*([^\n]+)\n[ \t]*[A-Z0-9-]+\s+Size[ \t]*:/im) ??
    "(unnamed item)";

  // "CT8012-047 Size: US M 8.5 New" — one line carrying three facts.
  const spec = grab(b, /^[ \t]*([A-Z0-9][A-Z0-9-]{4,}\s+Size[ \t]*:[^\n]+)/im);
  const size = grab(spec ?? b, /Size[ \t]*:[ \t]*(.+?)(?:\s+(?:New|Used|Worn)\b|$)/i);

  return {
    platform: "stockx",
    externalId: `stockx:${orderRef}`,
    orderRef,
    product,
    size,
    sku: spec ? grab(spec, /^([A-Z0-9][A-Z0-9-]{4,})\s+Size/i) : null,
    condition: grab(b, /\b(New|Used|Worn)\b(?=\s*$|\s*\n)/im) ?? (/\bNew\b/.test(spec ?? "") ? "New" : null),
    salePrice,
    payout,
    currency: currencyOf(payoutStr, priceStr),
    fees: salePrice != null ? Math.round((salePrice - payout) * 100) / 100 : null,
    shipBy: parseLongDate(grab(b, /Ship\s+by\s*\n?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i)),
  };
}

/** Whichever platform recognises the mail, or null. */
export function parseSneakerSale(email: RawMail): SneakerSale | null {
  return parseHypeboost(email) ?? parseStockx(email);
}
