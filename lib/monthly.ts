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

/** Where a ticket sits on the timeline: when it sold, else the event, else creation. */
export function saleMonth(t: Pick<Ticket, "sold_at" | "event_date" | "created_at">): string | null {
  return monthKeyOf(t.sold_at) ?? monthKeyOf(t.event_date) ?? monthKeyOf(t.created_at);
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
    key, label: monthLabel(key), sales: 0, revenue: 0, cost: 0, ticketProfit: 0,
    cashIn: 0, cashOut: 0, cashNet: 0, net: 0, cum: 0, tickets: [], entries: [],
  });
  const at = (key: string) => acc.get(key) ?? acc.set(key, blank(key)).get(key)!;

  for (const t of tickets) {
    if (t.qty_sold <= 0 || t.buy_price <= 0) continue;
    const key = saleMonth(t);
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
      sales: a.sales + m.sales,
      revenue: a.revenue + m.revenue,
      cost: a.cost + m.cost,
      ticketProfit: a.ticketProfit + m.ticketProfit,
      cashIn: a.cashIn + m.cashIn,
      cashOut: a.cashOut + m.cashOut,
      net: a.net + m.net,
    }),
    { sales: 0, revenue: 0, cost: 0, ticketProfit: 0, cashIn: 0, cashOut: 0, net: 0 }
  );
  // ROI on what was actually put in: ticket cost plus any manual costs that the
  // net already carries. Without a cost there is no return to express.
  const invested = t.cost + t.cashOut;
  return { ...t, invested, roi: invested > 0 ? (t.net / invested) * 100 : 0 };
}
