// ─────────────────────────────────────────────────────────────
// LA28 ORDER CONFIRMATION EXTRACTOR
//
// Subject: "LA28 - Olympic Tickets Order Confirmation - 391532671"
//
// This is a PURCHASE confirmation, not a sale, so it deliberately does NOT
// implement the `Parser` contract in ./types (that one returns ParsedSale and
// feeds the mail poller). It exists for the Scanner: pull the event, the ticket
// count and what was actually paid out of the confirmation, into extra columns
// next to each scan hit. Nothing here writes to `tickets` — buy prices are typed
// in by hand on purpose (see "The one rule that shapes everything" in README).
//
// The layout is a nest of HTML tables:
//
//   YOUR ORDER
//     Order number:  391532671        Billing address: …
//     Order total:   $396.88
//   ORDER DETAILS
//     CKT27 Cricket Men's Bronze Medal
//       Date:   Fri, 07.28.2028, 09:00 Local Time (24-hour)
//       Venue:  Fairgrounds Cricket Stadium, 1101 W McKinley Ave, POMONA, CA
//       Category D, Standard   8 × $40.00   $320.00
//       Service fee            8 × $9.61    $76.88
//       Subtotal                            $396.88
//   TOTAL
//     Digital delivery fee  $0.00
//     Total                 $396.88
//
// Two traps in there:
//
//   * **The service fee repeats the ticket count.** Summing every "N ×" line
//     turns 8 tickets into 16. Quantities are counted only on lines whose label
//     isn't a fee, which also keeps a multi-category order (8 × D + 4 × C = 12)
//     correct.
//   * **"Subtotal" ends in "total".** Every total regex is anchored so it can't
//     read a per-item subtotal as the order total.
// ─────────────────────────────────────────────────────────────

export type La28Order = {
  orderRef: string | null;
  /** All event titles in the order, joined with " + " when there's more than one. */
  event: string | null;
  eventDate: string | null; // ISO "2028-07-28" — the FIRST item's date
  venue: string | null; // the FIRST item's venue
  qty: number | null; // tickets across the whole order, fees excluded
  total: number | null; // what was actually paid
  currency: string; // "USD" | "EUR" | "GBP"
  items: number; // event blocks found — >1 means the row covers several events
};

// Labels that carry a quantity but not a ticket (see the trap above).
const FEE_LABEL = /fee|service|delivery|shipping|handling|tax|charge|insurance|donation/i;
// Section headers and label cells that must never be mistaken for an event title.
const NOT_A_TITLE = /^(your\s+order|order\s+details|total|totals|subtotal|order|summary|tickets?)$/i;

const CURRENCY_BY_SYMBOL: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP" };

/** "396.88" / "1,396.88" → 396.88. Returns null on anything unparseable. */
function toAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[^\d.,]/g, "").replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * "Fri, 07.28.2028, 09:00 Local Time" → "2028-07-28".
 *
 * LA28 is a US sender, so the parts are MM.DD.YYYY — 07.29.2026 (day 29) proves
 * it can't be day-first. When the string also names a weekday, it's used as a
 * checksum: if month-first doesn't land on that weekday but day-first does, the
 * assumption was wrong for this mail and we swap rather than emit a date that
 * contradicts what the email says.
 */
export function parseLa28Date(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
  if (!m) return null;
  const [, a, b, y] = m;
  const iso = (mo: string, d: string) => `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;

  const valid = (mo: number, d: number) => mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
  const monthFirst = valid(+a, +b);
  const dayFirst = valid(+b, +a);
  if (!monthFirst && !dayFirst) return null;
  if (!monthFirst) return iso(b, a);
  if (!dayFirst) return iso(a, b);

  // Both readings are calendar-possible → let the weekday decide, if given.
  const named = raw.match(/\b(sun|mon|tue|wed|thu|fri|sat)/i)?.[1].toLowerCase();
  if (named) {
    const weekdayOf = (mo: string, d: string) =>
      WEEKDAYS[new Date(`${iso(mo, d)}T00:00:00Z`).getUTCDay()];
    if (weekdayOf(a, b) !== named && weekdayOf(b, a) === named) return iso(b, a);
  }
  return iso(a, b);
}

/** Flatten to trimmed, non-empty lines — every lookup below is line-relative. */
function lines(body: string): string[] {
  return body
    .replace(/ /g, " ")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// A line that starts a new label cell ("Venue:", "Payment method:") or holds
// nothing but a price/quantity. Either one ends the value being collected.
const LABEL_LINE = /^[A-Za-z][\w ]{0,24}\s*:/;
const PRICE_LINE = /^[\d\s.,$€£×x*]+$/i;

/**
 * Value of a `Label:` cell. The HTML puts the label and its value in separate
 * table cells, so after flattening the value is usually on the NEXT line — but a
 * plain-text part keeps them on one. Handle both.
 *
 * A value can also be WRAPPED: the venue cell carries a `<br>` mid-address, so
 * "…1101 W McKinley Ave," and "POMONA, CA 91768" land on separate lines and a
 * naive read returns half an address. The break in these mails always falls
 * right after a comma, which is what separates a continuation from the next
 * label or price row — "Category D, Standard" never follows a dangling comma.
 */
function labelled(ls: string[], label: RegExp): string | null {
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(label);
    if (!m) continue;
    const sameLine = ls[i].slice(m.index! + m[0].length).trim();
    let value = sameLine || ls[i + 1] || "";
    if (!value) continue;
    let j = (sameLine ? i : i + 1) + 1;
    for (let guard = 0; value.endsWith(",") && j < ls.length && guard < 3; guard++, j++) {
      if (LABEL_LINE.test(ls[j]) || PRICE_LINE.test(ls[j])) break;
      value += " " + ls[j];
    }
    return value.trim();
  }
  return null;
}

/** Is this the LA28 order confirmation we know how to read? */
export function isLa28Order(subject: string, body: string): boolean {
  const hay = `${subject}\n${body}`;
  if (!/\bLA-?28\b/i.test(hay)) return false;
  const marks =
    (/order\s*(number|confirmation)/i.test(hay) ? 1 : 0) +
    (/order\s*details/i.test(hay) ? 1 : 0) +
    (/order\s*total/i.test(hay) ? 1 : 0) +
    (/\bvenue\b/i.test(hay) ? 1 : 0);
  return marks >= 2;
}

export function parseLa28Order(input: { subject?: string; body: string }): La28Order | null {
  const subject = input.subject ?? "";
  const body = input.body ?? "";
  if (!isLa28Order(subject, body)) return null;

  const ls = lines(body);

  // ── order number ── body first, then the subject's trailing digits, which
  // carry it even when the body is an image-only rendering.
  const orderRef =
    labelled(ls, /order\s*number\s*:?/i)?.match(/\d{4,}/)?.[0] ??
    subject.match(/(\d{6,})\s*$/)?.[1] ??
    null;

  // ── event blocks ── an item title is the line right before its "Date:" cell.
  const events: string[] = [];
  const dateIdx: number[] = [];
  for (let i = 0; i < ls.length; i++) {
    // `^Date` (not "Order date") — anchored so the order's own date can't start a block.
    if (!/^date\s*:/i.test(ls[i])) continue;
    // Walk back past label-ish cells to the real title.
    let j = i - 1;
    while (j >= 0 && (NOT_A_TITLE.test(ls[j]) || /:$/.test(ls[j]) || /^[\d\s.,$€£×x-]+$/i.test(ls[j]))) j--;
    if (j < 0) continue;
    events.push(ls[j]);
    dateIdx.push(i);
  }

  // ── quantity ── every "N × price" that isn't a fee line.
  let qty = 0;
  let symbol = "";
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(/(\d{1,4})\s*[×xX*]\s*([$€£])?\s*[\d.,]+/);
    if (!m) continue;
    // The label is whatever precedes the match on this line; when the cell got
    // split onto its own line, it's the previous line instead.
    const inline = ls[i].slice(0, m.index!).trim();
    const label = inline || ls[i - 1] || "";
    if (FEE_LABEL.test(label)) continue;
    qty += parseInt(m[1], 10);
    if (!symbol && m[2]) symbol = m[2];
  }

  // ── total ── "Order total" is the authoritative one; the closing "Total" row
  // is the fallback. `^total` keeps "Subtotal" out of both.
  const totalRaw =
    labelled(ls, /order\s*total\s*:?/i) ??
    (() => {
      for (let i = ls.length - 1; i >= 0; i--) {
        const m = ls[i].match(/^total\s*:?\s*(.*)$/i);
        if (!m) continue;
        return m[1].trim() || ls[i + 1] || null;
      }
      return null;
    })();
  const total = toAmount(totalRaw);
  if (!symbol) symbol = (totalRaw ?? "").match(/[$€£]/)?.[0] ?? "";

  const firstDate = dateIdx.length ? ls[dateIdx[0]] : null;
  const eventDate = parseLa28Date(
    firstDate?.replace(/^date\s*:?/i, "").trim() || (dateIdx.length ? ls[dateIdx[0] + 1] : null)
  );

  return {
    orderRef,
    event: events.length ? events.join(" + ") : null,
    eventDate,
    venue: labelled(ls, /^venue\s*:?/i),
    qty: qty || null,
    total,
    currency: CURRENCY_BY_SYMBOL[symbol] ?? "USD",
    items: events.length,
  };
}
