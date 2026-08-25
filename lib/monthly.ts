// ─────────────────────────────────────────────────────────────
// Monthly aggregation — ONE definition of "which month did this land in",
// shared by the charts and the overview page.
//
// Two things get bucketed and they don't agree on what a date is:
//
//   * a ticket sits on the timeline by when it SOLD — sold_at, falling back to
//     the event date (imported rows carry no sale date) and then to creation;
//   * a cash entry sits on occurred_at, the day the money moved.
//
// Kept here rather than inside the chart, because the moment a second page
// counts the same months a second way, the two disagree and both look broken.
// ─────────────────────────────────────────────────────────────

import {
  realizedCost, realizedProfit, signedAmount, type CashEntry, type Ticket,
} from "./supabase";

export type MonthBucket = {
  key: string;   // "2026-08", sortable
  label: string; // "Aug 26"
  // ── Money going OUT: what was bought this month ──
  // A separate dimension from sales, and deliberately so: a batch bought in
  // June and sold in July is an investment in June and a sale in July. Without
  // this, buying is invisible until the month it happens to sell in.
  purchases: number;
  /** Total paid for those batches. Does NOT touch `net` — see below. */
  invested: number;
  purchaseRows: Ticket[];
  /** Sold ticket rows with a known cost — the ones profit can be read from. */
  sales: number;
  revenue: number;      // ticket sell price
  cost: number;         // realized cost of what sold
  ticketProfit: number; // revenue − cost
  cashIn: number;       // manual income
  cashOut: number;      // manual costs
  cashNet: number;      // cashIn − cashOut
  /** ticketProfit + cashNet — what the month actually made. */
  net: number;
  cum: number;          // running total of `net` across the returned months
  tickets: Ticket[];    // the rows behind the numbers, for a drill-down
  entries: CashEntry[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-03T…" → "2026-08". Sliced, not parsed: no timezone can shift it. */
export function monthKeyOf(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 7) return null;
  const k = iso.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(k) ? k : null;
}

/**
 * Where a RESULT sits on the timeline: the month the event is played.
 *
 * Not the month it sold in, and the difference is the whole point. Selling a
 * ticket in August for a match next June is not August's result — the money is
 * owed, the event hasn't happened, and lumping it into August makes a quiet
 * month look busy and next June look empty. A result belongs to the event it
 * came from.
 *
 * sold_at and created_at are only fallbacks for a row with no event date at
 * all; every sold row in this book has one.
 */
export function eventMonth(t: Pick<Ticket, "sold_at" | "event_date" | "created_at">): string | null {
  return monthKeyOf(t.event_date) ?? monthKeyOf(t.sold_at) ?? monthKeyOf(t.created_at);
}

/**
 * When the money went out — `purchase_date` and nothing else.
 *
 * No fallback, and that was measured rather than assumed. `created_at` looks
 * like an obvious stand-in until you check: 150 of the 168 priced rows in this
 * book were bulk-imported on a single day, with event dates spread from March
 * 2026 to March 2027. Falling back to creation would have piled 121,030 EUR of
 * buying into one month that saw almost none of it — a column that looks
 * informative and is fiction. `event_date` is no better: it's when the match is
 * played, often months after the money left.
 *
 * So a purchase with no date is not placed anywhere. See undatedInvestment().
 */
export function purchaseMonth(t: Pick<Ticket, "purchase_date">): string | null {
  return monthKeyOf(t.purchase_date);
}

/**
 * What was bought but can't be placed on the timeline, because nobody recorded
 * when. Reported as one figure beside the months rather than smeared across
 * them: money spent that we can't date is a gap in the data, and the way to
 * show a gap is to name it.
 */
export function undatedInvestment(tickets: Ticket[]): { total: number; rows: number } {
  let total = 0, rows = 0;
  for (const t of tickets) {
    if (t.buy_price > 0 && !purchaseMonth(t)) { total += t.buy_price; rows++; }
  }
  return { total, rows };
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

/** Every month from first to last, so the x-axis is real time and not a list. */
function fillGaps(keys: string[]): string[] {
  if (keys.length === 0) return [];
  const sorted = [...keys].sort();
  const [fy, fm] = sorted[0].split("-").map(Number);
  const [ly, lm] = sorted[sorted.length - 1].split("-").map(Number);
  const out: string[] = [];
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m === 12 ? ((m = 1), y++) : m++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/**
 * Monthly buckets, oldest first.
 *
 * Only sold rows WITH a known cost contribute ticket profit — a payout whose
 * cost nobody typed in has no profit, and counting it as if the tickets were
 * free would make every chart flatter. That's the same rule the rest of the app
 * uses; unpriced rows are simply absent here.
 *
 * `includeCash` decides whether manual income and costs move `net`. The cash
 * columns are always populated either way, so a page can show them without
 * folding them in.
 */
export function buildMonths(
  tickets: Ticket[],
  entries: CashEntry[] = [],
  { includeCash = true }: { includeCash?: boolean } = {}
): MonthBucket[] {
  const acc = new Map<string, MonthBucket>();
  const blank = (key: string): MonthBucket => ({
    key, label: monthLabel(key), purchases: 0, invested: 0, purchaseRows: [],
    sales: 0, revenue: 0, cost: 0, ticketProfit: 0,
    cashIn: 0, cashOut: 0, cashNet: 0, net: 0, cum: 0, tickets: [], entries: [],
  });
  const at = (key: string) => acc.get(key) ?? acc.set(key, blank(key)).get(key)!;

  // Purchases: every priced row, sold or not. Stock bought and still sitting
  // there is money spent, and the point of the column is to show that.
  for (const t of tickets) {
    if (t.buy_price <= 0) continue;
    const key = purchaseMonth(t);
    if (!key) continue;
    const b = at(key);
    b.purchases++;
    b.invested += t.buy_price;
    b.purchaseRows.push(t);
  }

  for (const t of tickets) {
    if (t.qty_sold <= 0 || t.buy_price <= 0) continue;
    const key = eventMonth(t);
    if (!key) continue;
    const b = at(key);
    b.sales++;
    b.revenue += t.sell_price;
    b.cost += realizedCost(t);
    b.ticketProfit += realizedProfit(t);
    b.tickets.push(t);
  }

  for (const e of entries) {
    const key = monthKeyOf(e.occurred_at);
    if (!key) continue;
    const b = at(key);
    if (e.kind === "expense") b.cashOut += e.amount;
    else b.cashIn += e.amount;
    b.cashNet += signedAmount(e);
    b.entries.push(e);
  }

  const out = fillGaps([...acc.keys()]).map((k) => acc.get(k) ?? blank(k));
  let cum = 0;
  for (const b of out) {
    // `invested` is NOT subtracted here, on purpose. This app's profit model
    // counts a cost only when the tickets it bought actually sell — buying
    // stock is money moved, not money lost — so a month of heavy buying must
    // not read as a loss. It's shown beside the result, never inside it.
    b.net = b.ticketProfit + (includeCash ? b.cashNet : 0);
    cum += b.net;
    b.cum = cum;
  }
  return out;
}

/** Totals across the buckets, so the headline and the bars can't disagree. */
export function monthTotals(months: MonthBucket[]) {
  const t = months.reduce(
    (a, m) => ({
      purchases: a.purchases + m.purchases,
      spent: a.spent + m.invested,
      sales: a.sales + m.sales,
      revenue: a.revenue + m.revenue,
      cost: a.cost + m.cost,
      ticketProfit: a.ticketProfit + m.ticketProfit,
      cashIn: a.cashIn + m.cashIn,
      cashOut: a.cashOut + m.cashOut,
      net: a.net + m.net,
    }),
    { purchases: 0, spent: 0, sales: 0, revenue: 0, cost: 0, ticketProfit: 0, cashIn: 0, cashOut: 0, net: 0 }
  );
  // ROI on what was actually put in: ticket cost plus any manual costs that the
  // net already carries. Without a cost there is no return to express.
  const invested = t.cost + t.cashOut;
  return { ...t, invested, roi: invested > 0 ? (t.net / invested) * 100 : 0 };
}
