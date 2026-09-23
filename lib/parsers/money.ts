// ─────────────────────────────────────────────────────────────
// Money, written the many ways these platforms write it.
//
// ONE implementation, because the alternative has already cost real sales. Each
// parser used to carry its own regex with the euro sign baked in, and the day a
// Seatix sale settled in dollars every one of them missed: payout came back
// null, the parser bailed, and the mail was filed as an unreadable stub with no
// event and no price. Viagogo's parsers had the same euro baked in and would
// have failed identically the first time something sold in pounds.
//
// Nothing here assumes a currency. The symbol in the mail decides both the
// amount and the code that goes on the row.
// ─────────────────────────────────────────────────────────────

export const SYMBOLS = "€$£";
const SYMBOL_TO_CODE: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };

/**
 * An amount with its symbol on either side: "€221.00", "202,77 €", "£1,234.56".
 *
 * The gap is a SPACE, never `\s`. With `\s?` the pattern reached across a line
 * break, so in
 *
 *     Ticket qty	1
 *     €3,691.80
 *
 * it matched "1" + newline + "€" and read the payout as 1 — swallowing the €
 * so the real amount could never match. Two fixtures caught it; a live sale
 * would have been recorded as costing a euro.
 *
 * And a number starts with a digit: `[\d.,]+` alone matches a bare "." or ",".
 */
export const MONEY_BEFORE = String.raw`[${SYMBOLS}][  ]?\d[\d.,]*`;
export const MONEY_AFTER = String.raw`\d[\d.,]*[  ]?[${SYMBOLS}]`;
export const MONEY = `(?:${MONEY_BEFORE}|${MONEY_AFTER})`;

/**
 * The numeric value, however it is punctuated.
 *
 * The decimal separator is whichever of `.` or `,` comes LAST: "1.234,56" and
 * "1,234.56" are the same amount written by different countries, and picking
 * one convention gets the other wrong by a factor of a thousand. A trailing
 * group of exactly three after a comma is thousands, not a decimal.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d.,]/g, "");
  if (!digits) return null;
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  let normalised: string;
  if (lastDot === -1 && lastComma === -1) normalised = digits;
  else {
    const sep = lastDot > lastComma ? "." : ",";
    const cut = Math.max(lastDot, lastComma);
    const whole = digits.slice(0, cut).replace(/[.,]/g, "");
    const frac = digits.slice(cut + 1).replace(/[.,]/g, "");
    normalised = frac.length === 3 && sep === "," ? whole + frac : `${whole}.${frac}`;
  }
  const n = parseFloat(normalised);
  return isNaN(n) ? null : Math.abs(n);
}

/**
 * The currency the amounts are in, from the first symbol found.
 *
 * Falls back to EUR only when nothing in the mail says otherwise — these
 * accounts are paid in euros by default, but that is a last resort, not an
 * assumption made before looking.
 */
export function currencyOf(...raw: (string | null | undefined)[]): string {
  for (const r of raw) {
    const s = r?.match(new RegExp(`[${SYMBOLS}]`))?.[0];
    if (s) return SYMBOL_TO_CODE[s];
  }
  return "EUR";
}
