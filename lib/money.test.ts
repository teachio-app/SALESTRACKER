// Run: npx tsx lib/money.test.ts
// The money model: realized profit (pro-rata on the sold portion) and open
// investment (what's still out). Both are read straight off the dashboard, so
// their edge cases — a half-sold batch, a payout that landed, a row with no
// known cost — get pinned down here rather than discovered on a real balance.

import { realizedCost, realizedProfit, tiedUpCost, openInvestment, type Ticket } from "./supabase";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${e}\n        actual   ${a}`);
}

/** A ticket row with only the money fields that matter here. */
function row(t: Partial<Ticket>): Ticket {
  return {
    id: "x", event_name: "E", event_date: null, location: null, section: null,
    seat_row: null, seats: null, qty_total: 1, qty_sold: 0, status: "not_listed",
    buy_price: 0, sell_price: 0, currency: "EUR", order_ref: null, source: null,
    external_id: null, needs_review: false, purchase_date: null, ticket_type: null,
    email_used: null, payment_method: null, vgg_event_id: null, comment: null,
    paid_out: false, flagged: false, flag_note: null, sales: [], profit: 0,
    sold_at: null, created_at: "", updated_at: "",
    ...t,
  };
}

console.log("\ntiedUpCost() — one row's money still out");
check("nothing sold → the whole buy price is out",
  tiedUpCost(row({ buy_price: 400, qty_total: 4, qty_sold: 0 })), 400);
check("sold but not paid → still the whole buy price",
  tiedUpCost(row({ buy_price: 400, qty_total: 4, qty_sold: 4, paid_out: false })), 400);
check("sold AND paid → nothing left out",
  tiedUpCost(row({ buy_price: 400, qty_total: 4, qty_sold: 4, paid_out: true })), 0);
check("half sold, paid → only the unsold half is still out",
  tiedUpCost(row({ buy_price: 400, qty_total: 4, qty_sold: 2, paid_out: true })), 200);
check("half sold, NOT paid → all of it is still out",
  tiedUpCost(row({ buy_price: 400, qty_total: 4, qty_sold: 2, paid_out: false })), 400);
check("no buy price → nothing to be out",
  tiedUpCost(row({ buy_price: 0, qty_total: 2, qty_sold: 1 })), 0);
check("qty_sold overshooting qty_total can't go negative",
  tiedUpCost(row({ buy_price: 300, qty_total: 2, qty_sold: 3, paid_out: true })), 0);
check("qty_total 0 doesn't divide by zero",
  tiedUpCost(row({ buy_price: 150, qty_total: 0, qty_sold: 0 })), 150);

console.log("\ntiedUpCost() agrees with the profit model");
// The two halves of a fully-sold-and-paid batch: cost recovered + profit = payout.
const done = row({ buy_price: 400, qty_total: 4, qty_sold: 4, sell_price: 520, paid_out: true });
check("recovered cost + profit = sell price",
  realizedCost(done) + realizedProfit(done), done.sell_price);
check("and nothing stays tied up", tiedUpCost(done), 0);

console.log("\nopenInvestment() — the dashboard figure");
const book: Ticket[] = [
  row({ id: "a", buy_price: 400, qty_total: 4, qty_sold: 0 }),                   // stock: 400
  row({ id: "b", buy_price: 300, qty_total: 2, qty_sold: 2, paid_out: false }),  // sold, unpaid: 300
  row({ id: "c", buy_price: 200, qty_total: 2, qty_sold: 2, paid_out: true }),   // settled: 0
  row({ id: "d", buy_price: 600, qty_total: 3, qty_sold: 1, paid_out: true }),   // 2/3 unsold: 400
];
check("total still out", openInvestment(book).total, 1100);
check("settled rows contribute nothing", openInvestment([book[2]]).total, 0);
check("nothing unpriced here", openInvestment(book).unpriced, 0);

// A poller-added sale has no buy price. It must be counted as unknown, never as
// a zero that quietly flatters the figure.
const withPollerRow = [...book, row({ id: "e", buy_price: 0, qty_total: 1, qty_sold: 1, sell_price: 240 })];
check("an unpriced exposed row is admitted, not silently zeroed",
  openInvestment(withPollerRow), { total: 1100, unpriced: 1 });
check("an unpriced row that's settled isn't flagged",
  openInvestment([row({ buy_price: 0, qty_total: 1, qty_sold: 1, paid_out: true })]),
  { total: 0, unpriced: 0 });

console.log("\nTicking Paid is what moves the number");
const before = row({ buy_price: 480, qty_total: 2, qty_sold: 2, paid_out: false });
const after = { ...before, paid_out: true };
check("before the payout lands", openInvestment([before]).total, 480);
check("after ticking Paid", openInvestment([after]).total, 0);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
