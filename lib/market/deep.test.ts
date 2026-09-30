// Run: npx tsx lib/market/deep.test.ts
//
// Finding the full sales history in a page's JSON without knowing its format.
// Each shape below is one a sales-tracker API could plausibly return; the noise
// around them (a user profile, a listings array, a daily series, an event
// object) is what the extractor has to NOT pick.

import { findSales, findListings, findDaily, dailyFromSales, toInstant, extractDeep, describePayloads, type RawPayload } from "./deep";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const T0 = Date.parse("2026-09-30T12:00:00Z");
const hoursAgo = (h: number) => new Date(T0 - h * 3_600_000).toISOString();

// Shape A: a REST payload, camelCase, ISO times, price as a number.
function shapeA(n: number) {
  return {
    event: { id: "E-160790810", name: "Celine Dion", eventDate: "2026-09-30T19:00:00Z" },
    stats: { totalSales: n },
    salesHistory: Array.from({ length: n }, (_, i) => ({
      id: i, price: 200 + (i % 50) * 7.5, quantity: 1 + (i % 3), section: ["413", "W", "O"][i % 3],
      row: String(40 + (i % 30)), seats: `${i} - ${i + 1}`, soldAt: hoursAgo(i * 3), currency: "EUR",
      eventDate: "2026-09-30T19:00:00Z", // constant on every item: must not be taken as the sale time
    })),
  };
}

// Shape B: snake_case, epoch seconds, price nested as {amount, currency}, seat_from/seat_to.
function shapeB(n: number) {
  return {
    data: {
      items: Array.from({ length: n }, (_, i) => ({
        price: { amount: String(150 + i), currency: "GBP" }, qty: 2, sector: "A2", row_name: "7",
        seat_from: 10 + i, seat_to: 11 + i, created_at: Math.floor((T0 - i * 7_200_000) / 1000),
      })),
    },
  };
}

const LISTINGS = {
  listings: Array.from({ length: 103 }, (_, i) => ({ price: 300 + i, quantity: 2, section: "413", row: "1", createdAt: hoursAgo(i) })),
};
const DAILY = { chart: Array.from({ length: 176 }, (_, i) => ({ date: new Date(T0 - i * 86_400_000).toISOString().slice(0, 10), value: 5 + (i % 9) })) };
const PROFILE = { user: { name: "someone", plan: "Standard" }, notifications: [{ id: 1, text: "hi", createdAt: hoursAgo(1) }, { id: 2, text: "x", createdAt: hoursAgo(2) }, { id: 3, text: "y", createdAt: hoursAgo(3) }] };

const p = (url: string, json: unknown): RawPayload => ({ url, at: T0, json });

console.log("\nshape A — camelCase REST");
{
  const all = [p("/api/me", PROFILE), p("/api/salestracker/E-160790810", shapeA(1321)), p("/api/listings", LISTINGS), p("/api/daily", DAILY)];
  const r = findSales(all, 1321)!;
  check("finds the 1,321-row history", r.sales.length, 1321);
  check("…on the right path", /salesHistory/.test(r.path), true);
  const newest = r.sales[0];
  check("sorted newest first", newest.at, hoursAgo(0));
  check("the SALE time, not the constant event date", r.sales[5].at, hoursAgo(15));
  check("price", newest.price, 200);
  check("qty", newest.qty, 1);
  check("section", newest.section, "413");
  check("row", newest.row, "40");
  check("seats", newest.seats, "0 - 1");
  check("currency", newest.currency, "EUR");
}

console.log("\nshape B — snake_case, epoch seconds, nested money");
{
  const r = findSales([p("/v2/sales?event=1", shapeB(60))], 60)!;
  check("finds 60 rows", r.sales.length, 60);
  check("epoch seconds become an instant", r.sales[0].at, new Date(T0).toISOString());
  check("price read from {amount}", r.sales[0].price, 150);
  check("currency read from {currency}", r.sales[0].currency, "GBP");
  check("sector counts as section", r.sales[0].section, "A2");
  check("seat_from + seat_to joined", r.sales[0].seats, "10 - 11");
}

console.log("\nwhat must not be taken for the sales history");
{
  // Listings have price, qty, section and a created time — only their COUNT
  // (103, the Number of Listings tile) gives them away against 1,321 sales.
  const both = [p("/api/listings", LISTINGS), p("/api/sales", shapeA(1321))];
  check("sales beat listings by length", findSales(both, 1321)!.sales.length, 1321);
  check("a daily {date, value} series is not sales", findSales([p("/api/daily", DAILY)], 1321), null);
  check("notifications are not sales", findSales([p("/api/me", PROFILE)], 1321), null);
  // A handful of rows is not the history of 1,321.
  check("5 rows against a 1,321 tile is rejected", findSales([p("/x", shapeA(5))], 1321), null);
  check("no payloads, nothing", findSales([], 1321), null);
}

console.log("\nlistings");
{
  const all = [p("/api/sales", shapeA(1321)), p("/api/listings", LISTINGS)];
  const s = findSales(all, 1321)!;
  const l = findListings(all, 103, s.path)!;
  check("finds the 103 listings", l.listings.length, 103);
  check("…not the sales array", /listings/.test(l.path), true);
  check("listing price", l.listings[0].price, 300);
  check("no listings tile, no guess", findListings(all, null, s.path), null);
}

console.log("\ndaily series");
{
  const sales = [
    { at: "2026-09-28T10:00:00.000Z", price: 1, qty: 2, section: null, row: null, seats: null, currency: null },
    { at: "2026-09-28T18:00:00.000Z", price: 1, qty: 1, section: null, row: null, seats: null, currency: null },
    { at: "2026-09-30T09:00:00.000Z", price: 1, qty: null, section: null, row: null, seats: null, currency: null },
  ];
  // The empty day in between is a zero, not a gap: nothing sold is a fact.
  check("tickets per day, zeros filled", dailyFromSales(sales), [
    { day: "2026-09-28", tickets: 3 }, { day: "2026-09-29", tickets: 0 }, { day: "2026-09-30", tickets: 1 },
  ]);
  check("from sales when there are sales", findDaily(sales, [])!.source, "sales");
  // Days after the last sale, up to the day of the read, are zeros — a run of
  // them is the most important thing a chart can show, and stopping at the last
  // sale would hide it.
  check("runs on to the day of the read", dailyFromSales(sales, "2026-10-03").slice(-4), [
    { day: "2026-09-30", tickets: 1 }, { day: "2026-10-01", tickets: 0 }, { day: "2026-10-02", tickets: 0 }, { day: "2026-10-03", tickets: 0 },
  ]);
  check("a read day before the last sale changes nothing", dailyFromSales(sales, "2026-09-01").length, 3);

  const apex = [{
    id: "daily", type: "line", title: "", yTitle: "Tickets Sold", xType: "datetime", categories: [], labels: [],
    series: [{ name: "Tickets", data: [[Date.parse("2026-09-28T00:00:00Z"), 3], [Date.parse("2026-09-29T00:00:00Z"), 0], [Date.parse("2026-09-30T00:00:00Z"), 5]] }],
  }];
  const fromChart = findDaily(null, apex)!;
  check("else from the page's chart", fromChart.source, "chart");
  check("…read as days", fromChart.points.map((x) => x.day), ["2026-09-28", "2026-09-29", "2026-09-30"]);
  check("…with values", fromChart.points.map((x) => x.tickets), [3, 0, 5]);
  check("{x, y} points too", findDaily(null, [{ ...apex[0], series: [{ name: "", data: [{ x: "2026-09-28", y: 4 }, { x: "2026-09-29", y: 2 }, { x: "2026-09-30", y: 1 }] }] }])!.points.map((x) => x.tickets), [4, 2, 1]);
  check("nothing to go on, nothing", findDaily(null, []), null);
}

console.log("\ntimes");
{
  check("epoch ms", toInstant(T0), new Date(T0).toISOString());
  check("epoch s", toInstant(Math.floor(T0 / 1000)), new Date(T0).toISOString());
  check("ISO", toInstant("2026-09-30T12:00:00Z"), "2026-09-30T12:00:00.000Z");
  check("a small number is not a time", toInstant(42), null);
  check("a word is not a time", toInstant("yesterday"), null);
}

console.log("\nthe whole extraction");
{
  const deep = { payloads: [p("/api/sales", shapeA(1321)), p("/api/listings", LISTINGS)], apex: [], embedded: [], tap: true };
  const x = extractDeep(deep, { totalSales: 1321, listings: 103 });
  check("sales", x.sales?.length, 1321);
  check("listings", x.listings?.length, 103);
  check("daily from the sales", x.dailySource, "sales");
  check("nothing to describe when it worked", x.described, []);

  const empty = extractDeep({ payloads: [p("/api/me", PROFILE)], apex: [], embedded: [], tap: true }, { totalSales: 1321, listings: 103 });
  check("nothing found → nulls", [empty.sales, empty.listings, empty.daily], [null, null, null]);
  check("…and a description of what was there", empty.described.length, 1);
  check("…naming the arrays and their keys", /notifications\[3\] keys: id,text,createdAt/.test(empty.described[0]), true);
  check("no deep data at all is fine", extractDeep(null, { totalSales: 1, listings: 1 }).sales, null);
  check("describe caps its length", describePayloads(Array.from({ length: 40 }, (_, i) => p(`/x${i}`, {}))).length, 25);
}

console.log(failed === 0 ? "\nAll deep-extraction tests passed.\n" : `\n${failed} test(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
