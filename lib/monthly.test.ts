// Run: npx tsx lib/monthly.test.ts
// Monthly bucketing. Shared by the charts and the overview, so an error here
// makes two pages tell different stories about the same month — and the
// disagreement is what you'd notice, not the cause.

import { buildMonths, monthTotals, monthKeyOf, saleMonth } from "./monthly";
import type { CashEntry, Ticket } from "./supabase";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

function ticket(t: Partial<Ticket>): Ticket {
  return {
    id: Math.random().toString(36).slice(2), event_name: "E", event_date: null, location: null,
    section: null, seat_row: null, seats: null, qty_total: 1, qty_sold: 1, status: "sold",
    buy_price: 100, sell_price: 150, currency: "EUR", order_ref: null, source: null,
    external_id: null, needs_review: false, purchase_date: null, ticket_type: null,
    email_used: null, payment_method: null, vgg_event_id: null, comment: null, paid_out: false,
    flagged: false, flag_note: null, sales: [], profit: 0, sold_at: null,
    created_at: "2026-01-01T00:00:00Z", updated_at: "", ...t,
  };
}
function entry(e: Partial<CashEntry>): CashEntry {
  return {
    id: Math.random().toString(36).slice(2), kind: "income", description: "x", amount: 100,
    currency: "EUR", category: null, occurred_at: "2026-03-10", ticket_id: null, note: null,
    created_at: "", updated_at: "", ...e,
  };
}

console.log("\nwhich month is this in");
check("sliced, not parsed — no timezone can shift it", monthKeyOf("2026-03-01T00:30:00Z"), "2026-03");
check("a plain date", monthKeyOf("2026-03-01"), "2026-03");
check("nothing", monthKeyOf(null), null);
check("sold_at wins", saleMonth({ sold_at: "2026-05-02T00:00:00Z", event_date: "2026-09-01", created_at: "2026-01-01" }), "2026-05");
check("no sale date → the event (imported rows have no sold_at)",
  saleMonth({ sold_at: null, event_date: "2026-09-01", created_at: "2026-01-01" }), "2026-09");
check("neither → creation", saleMonth({ sold_at: null, event_date: null, created_at: "2026-01-01" }), "2026-01");

console.log("\nbuckets");
const tickets = [
  ticket({ sold_at: "2026-03-05T00:00:00Z", buy_price: 100, sell_price: 150 }),
  ticket({ sold_at: "2026-03-20T00:00:00Z", buy_price: 200, sell_price: 260 }),
  ticket({ sold_at: "2026-05-01T00:00:00Z", buy_price: 100, sell_price: 80 }),
];
const entries = [
  entry({ occurred_at: "2026-03-10", kind: "income", amount: 300 }),
  entry({ occurred_at: "2026-04-02", kind: "expense", amount: 50 }),
];
const m = buildMonths(tickets, entries);
check("gap-filled, so the axis is real time", m.map((x) => x.key), ["2026-03", "2026-04", "2026-05"]);
check("March: two sales", m[0].sales, 2);
check("March revenue", m[0].revenue, 410);
check("March ticket profit", m[0].ticketProfit, 110);
check("March cash in", m[0].cashIn, 300);
check("March net = tickets + cash", m[0].net, 410);
check("April has no sales but still exists, with its cost", [m[1].sales, m[1].net], [0, -50]);
check("May is a loss", m[2].net, -20);
check("running total", m.map((x) => x.cum), [410, 360, 340]);

console.log("\ncash can be excluded");
const noCash = buildMonths(tickets, entries, { includeCash: false });
check("net is tickets only", noCash.map((x) => x.net), [110, 0, -20]);
check("but the cash columns are still filled in", noCash[0].cashIn, 300);
check("so a page can show cash without folding it in", noCash[1].cashOut, 50);

console.log("\nwhat is left out");
// A payout with no buy price has no known profit; counting it as if the tickets
// were free would flatter every chart. Same rule as everywhere else in the app.
check("a sold row with no buy price contributes nothing",
  buildMonths([ticket({ sold_at: "2026-03-01T00:00:00Z", buy_price: 0, sell_price: 240 })]).length, 0);
check("an unsold row contributes nothing",
  buildMonths([ticket({ sold_at: null, event_date: "2026-03-01", qty_sold: 0 })]).length, 0);
check("no data at all → no months", buildMonths([], []), []);

console.log("\ntotals agree with the buckets");
const t = monthTotals(m);
check("net", t.net, m.reduce((s, x) => s + x.net, 0));
check("net equals the last cumulative point", t.net, m[m.length - 1].cum);
// Ticket cost 100 + 200 + 100 = 400, plus the 50 manual cost.
check("invested counts manual costs too", t.invested, 450);
check("cost is the ticket side alone", t.cost, 400);
check("roi = net / invested", Number(t.roi.toFixed(2)), Number(((340 / 450) * 100).toFixed(2)));
check("empty months, no divide by zero", monthTotals([]).roi, 0);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
