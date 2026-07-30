// Run: npx tsx lib/money.test.ts
// The money model: realized profit (pro-rata on the sold portion) and open
// investment (what's still out). Both are read straight off the dashboard, so
// their edge cases — a half-sold batch, a payout that landed, a row with no
// known cost — get pinned down here rather than discovered on a real balance.

import {
  realizedCost, realizedProfit, tiedUpCost, openInvestment, awaitingPayout, type Ticket,
} from "./supabase";

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
  // stock, nothing sold → 400 out
  row({ id: "a", buy_price: 400, qty_total: 4, qty_sold: 0 }),
  // sold, payout hasn't landed → 300 out AND 380 owed
  row({ id: "b", buy_price: 300, qty_total: 2, qty_sold: 2, sell_price: 380 }),
  // sold and paid → settled, in neither figure
  row({ id: "c", buy_price: 200, qty_total: 2, qty_sold: 2, sell_price: 250, paid_out: true }),
  // 1 of 3 sold and paid → the 2 unsold still cost 400
  row({ id: "d", buy_price: 600, qty_total: 3, qty_sold: 1, sell_price: 260, paid_out: true }),
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

console.log("\nawaitingPayout() — cash owed, the mirror of the invested figure");
check("only the sold row that isn't ticked Paid", awaitingPayout(book), { total: 380, count: 1 });
check("an unsold row owes nothing",
  awaitingPayout([row({ buy_price: 400, qty_total: 4, qty_sold: 0, sell_price: 0 })]), { total: 0, count: 0 });
check("a paid row owes nothing",
  awaitingPayout([row({ buy_price: 400, qty_total: 4, qty_sold: 4, sell_price: 500, paid_out: true })]),
  { total: 0, count: 0 });
check("a part-sold unpaid row owes what it has actually sold for",
  awaitingPayout([row({ buy_price: 400, qty_total: 4, qty_sold: 2, sell_price: 260 })]),
  { total: 260, count: 1 });
// The pair must describe the same rows: the sell side owed and the cost side out.
const owedRow = row({ buy_price: 300, qty_total: 2, qty_sold: 2, sell_price: 380 });
check("same row appears in both figures while unpaid",
  [awaitingPayout([owedRow]).total, openInvestment([owedRow]).total], [380, 300]);
check("and leaves both the moment it's ticked Paid",
  [awaitingPayout([{ ...owedRow, paid_out: true }]).total,
   openInvestment([{ ...owedRow, paid_out: true }]).total], [0, 0]);

console.log("\nTicking Paid is what moves the number");
const before = row({ buy_price: 480, qty_total: 2, qty_sold: 2, paid_out: false });
const after = { ...before, paid_out: true };
check("before the payout lands", openInvestment([before]).total, 480);
check("after ticking Paid", openInvestment([after]).total, 0);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} check(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
