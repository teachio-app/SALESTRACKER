// Run: npx tsx lib/market/features.test.ts
//
// A market built so every number can be checked by hand: one sale a day for 40
// days; the last 7 days sell 3 tickets at €300 each, the 33 before sell 1 at
// €200. Sections alternate B (even days back) and A (odd).

import { computeFeatures, quantile, slope, weekOf } from "./features";
import { dailyFromSales, type DeepSale } from "./deep";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const END = "2026-09-30T12:00:00.000Z";
const endMs = Date.parse(END);
const DAY = 86_400_000;

const sales: DeepSale[] = Array.from({ length: 40 }, (_, d) => ({
  at: new Date(endMs - d * DAY - 3_600_000).toISOString(),
  price: d < 7 ? 300 : 200,
  qty: d < 7 ? 3 : 1,
  section: d % 2 ? "A" : "B",
  row: "1",
  seats: null,
  currency: "EUR",
}));

const stats = {
  total_sales: 40, total_tickets: 54, average_price: 230, floor_price: 150, sales_24h: 1,
  first_sale: "2026-08-22", listings: 10, tickets_available: 100, currency: "EUR",
};
const listings = Array.from({ length: 10 }, (_, i) => ({ price: 280 + i * 10, qty: 10, section: i < 6 ? "B" : "A", row: "5" }));

const f = computeFeatures({
  stats, eventDate: "2026-11-09", capturedAt: END,
  sales, screenSales: [], daily: dailyFromSales(sales), listings,
});

console.log("\ncoverage");
check("full history", f.coverage.salesSource, "full");
check("all 40 rows", f.coverage.salesRows, 40);
check("100 % of the Total Sales tile", f.coverage.coveragePct, 100);
check("rows reach back 39 days", f.coverage.rowsReachDays, 39);
check("daily counted from sales", f.coverage.dailySource, "sales");

console.log("\ntiming");
check("39 days on sale (22 Aug → 30 Sep)", f.timing.daysOnSale, 39);
check("40 days to the event", f.timing.daysToEvent, 40);
check("window 49 % gone", f.timing.windowElapsed, 0.49);

console.log("\nvelocity");
check("last 7 days: 7 sales × 3", f.velocity.tickets7d, 21);
check("the 7 before: 7 × 1", f.velocity.ticketsPrev7d, 7);
check("last 30 days: 21 + 23", f.velocity.tickets30d, 44);
check("last 24h counted: one sale of 3", f.velocity.tickets24h, 3);
check("…and marked as counted", f.velocity.tickets24hCounted, true);
check("week over week +200 %", f.velocity.weekOverWeekPct, 200);
check("per day, 7d", f.velocity.perDay7d, 3);
check("per day, all time: 54 / 39", f.velocity.perDayAllTime, 1.4);
check("7d against 30d: 3 / 1.47", f.velocity.ratio7dVs30d, 2.05);

console.log("\ntrend");
check("peak day is a 3-ticket day", f.trend.peakTickets, 3);
check("7d share of all tickets: 21 / 54", f.trend.last7dShareOfAllPct, 38.9);
check("14-day slope rises (1s then 3s)", (f.trend.slope14d ?? 0) > 0, true);
check("no zero days", f.trend.zeroDaysLast14, 0);

console.log("\nprice");
check("median of the last 7 days", f.price.median7d, 300);
check("median of days 8–30", f.price.medianPrev, 200);
check("up 50 % week against the rest of the month", f.price.change7dVsPrevPct, 50);
// Last 30 days: 21 tickets at 300, 23 at 200 → the median ticket is a 200.
check("30-day median, weighted by ticket", f.price.median, 200);
check("p75", f.price.p75, 300);
check("floor against median", f.price.floorOverMedian, 0.75);
check("weekly medians present", f.price.weekly.length > 0, true);
check("weekly trend rises", (f.price.weeklyTrendPerWeek ?? 0) > 0, true);

console.log("\nsupply");
check("sell-through 54 / 154", f.supply.sellThroughPct, 35.1);
check("10 tickets per listing", f.supply.ticketsPerListing, 10);
check("days of supply at 3/day", f.supply.daysOfSupply, 33.3);
check("…against 40 days left", f.supply.daysOfSupplyOverDaysLeft, 0.83);
check("cheapest ask", f.supply.listingPriceMin, 280);
// 100 tickets on offer, 10 per listing at 280…370: the 50th and 51st are 320
// and 330, so the median ask is 325 — against a recent sold median of 300.
check("asks sit 8.3 % above recent sales", f.supply.askOverSoldPct, 8.3);

console.log("\nsections");
const B = f.sections.find((s) => s.section === "B")!;
const A = f.sections.find((s) => s.section === "A")!;
check("B: 28 tickets", B.tickets, 28);
check("A: 26 tickets", A.tickets, 26);
check("busiest first", f.sections[0].section, "B");
check("B gaining lately (57 % of the week vs 52 % overall)", B.momentum, 1.1);
check("A losing ground", A.momentum, 0.89);
check("tickets on offer in B", B.listingsNow, 60);

console.log("\norder sizes");
check("33 of 40 orders are singles", f.orderSizes.onePct, 82.5);
check("7 of 40 are threes", f.orderSizes.threePct, 17.5);

console.log("\nwith only the rows on screen");
{
  const screen = sales.slice(0, 5).map((s) => ({ at: s.at, price: s.price, qty: s.qty, section: s.section }));
  const g = computeFeatures({ stats, eventDate: "2026-11-09", capturedAt: END, sales: null, screenSales: screen, daily: null, listings: null });
  check("says so", g.coverage.salesSource, "screen");
  check("5 of 40 = 12.5 %", g.coverage.coveragePct, 12.5);
  // Five rows reach back four days: a week's numbers would be invented.
  check("no 7-day figure from 4 days of rows", g.velocity.tickets7d, null);
  check("no price trend", g.price.change7dVsPrevPct, null);
  check("24h still counted — the rows do cover a day", g.velocity.tickets24h, 3);
  check("pace falls back to all-time for supply", g.supply.daysOfSupply, 72.2);
  check("price basis labelled", g.price.basis, "rows on screen only");
}

console.log("\nhelpers");
check("quantile of one", quantile([7], 0.5), 7);
check("quantile of none", quantile([], 0.5), null);
check("slope of a rising line", slope([1, 2, 3, 4]), 1);
check("slope needs three points", slope([1, 2]), null);
check("week starts Monday", weekOf("2026-09-30T10:00:00Z"), "2026-09-28");
check("a Monday is its own week", weekOf("2026-09-28"), "2026-09-28");

console.log(failed === 0 ? "\nAll feature tests passed.\n" : `\n${failed} test(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
