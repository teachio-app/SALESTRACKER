// Run: npx tsx lib/market/summary.test.ts
//
// The numbers are the real ones off the NBA Manchester capture: 584 sales,
// 1,261 tickets, €211.45 average, €85.66 floor, 17 in 24h, first sale 15 Sep,
// 836 listings, 2,150 available. Every expected value below can be checked by
// hand from those eight tiles, which is the point — a summary nobody can verify
// is just a second opinion with no reasons.

import { summarise, ticketPrices, percentile, daysBetween, type SummarySnapshot } from "./summary";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const EVENT = {
  name: "NBA Manchester: New Orleans Pelicans vs San Antonio Spurs",
  event_date: "2027-01-17",
  venue: "Co-op Live",
  city: "Manchester",
  country: "United Kingdom",
  url: null,
};

const NBA: SummarySnapshot = {
  captured_at: "2026-09-30T12:00:00.000Z",
  total_sales: 584,
  total_tickets: 1261,
  average_price: 211.45,
  floor_price: 85.66,
  sales_24h: 17,
  first_sale: "2026-09-15",
  listings: 836,
  tickets_available: 2150,
  currency: "EUR",
};

const THREE_HOURS_LATER = new Date("2026-09-30T15:00:00.000Z");
const tones = (s: ReturnType<typeof summarise>) => s.signals.map((g) => g.tone);
const has = (s: ReturnType<typeof summarise>, re: RegExp) => s.signals.some((g) => re.test(g.text));

console.log("\nthe eight tiles, read");
{
  const s = summarise(EVENT, [NBA], [], THREE_HOURS_LATER);
  check("days to event (30 Sep → 17 Jan)", s.daysToEvent, 109);
  check("days selling (15 Sep → 30 Sep)", s.derived.daysSelling, 15);
  check("average sales a day: 584 / 15", s.derived.avgSalesPerDay, 38.9);
  check("momentum: 17 / 38.93", s.derived.momentum, 0.44);
  check("tickets per sale: 1261 / 584", s.derived.ticketsPerSale, 2.16);
  check("sell-through: 1261 / (1261 + 2150)", s.derived.sellThrough, 0.37);
  check("spread: 211.45 / 85.66", s.derived.spread, 2.47);
  check("tickets in 24h, estimated: 17 × 2.16", s.derived.tickets24hEst, 36.7);
  check("runway: 2150 / 36.7", s.derived.runwayDays, 58.6);
  check("age of the data", s.ageHours, 3);
  check("not stale", s.stale, false);
}

console.log("\nwhat it says about them");
{
  const s = summarise(EVENT, [NBA], [], THREE_HOURS_LATER);
  // 0.44× is well under the 0.6 line.
  check("slowing", has(s, /^Slowing: 17 sales in 24h vs 38\.9\/day on average \(0\.4×\)/), true);
  // 58.6 days of supply, 109 days left: more than half, less than all.
  check("supply roughly matches time left", has(s, /^Supply roughly matches the time left/), true);
  check("…and says it is an estimate", has(s, /Estimate from one day/), true);
  // Written the way every tile on the page writes it, and as a whole sentence.
  check("thousands separator in the sentence", has(s, /2,150 available/), true);
  check("the days are named", has(s, /event in 109 days\./), true);
  check("37 % sell-through is neutral", s.signals.some((g) => g.tone === "neutral" && /37 %/.test(g.text)), true);
  // 2.47× sits just under the 2.5 line, so no spread warning.
  check("no spread warning at 2.47×", has(s, /Wide spread/), false);
  check("no staleness warning at 3h", has(s, /days old/), false);
  // It measures. It does not advise.
  check("never says buy or sell", s.signals.some((g) => /\b(buy|sell now|don't buy)\b/i.test(g.text)), false);
}

console.log("\nchange since the last capture");
{
  const yesterday: SummarySnapshot = {
    ...NBA,
    captured_at: "2026-09-29T12:00:00.000Z",
    total_sales: 567,
    total_tickets: 1224,
    tickets_available: 2270,
    floor_price: 89.0,
  };
  // Passed out of order on purpose — the summary must sort, not trust.
  const s = summarise(EVENT, [NBA, yesterday], [], THREE_HOURS_LATER);
  check("24 hours between captures", s.change?.hours, 24);
  check("120 fewer available", s.change?.available, -120);
  check("17 more sales", s.change?.sales, 17);
  check("floor down 3.34", s.change?.floor, -3.34);
  check("availability falling reads as positive", s.signals.some((g) => g.tone === "up" && /Availability down 120/.test(g.text)), true);
  // −3.34 on 89.00 is 3.75 %, under the 5 % line: noise, not news.
  check("a 3.75 % floor move is not reported", has(s, /^Floor (up|down)/), false);

  const bigDrop = summarise(EVENT, [NBA, { ...yesterday, floor_price: 110 }], [], THREE_HOURS_LATER);
  check("a 22 % floor drop is", bigDrop.signals.some((g) => g.tone === "down" && /Floor down 22 %/.test(g.text)), true);

  check("one capture has no change", summarise(EVENT, [NBA], [], THREE_HOURS_LATER).change, null);
}

console.log("\nthe edges");
{
  const empty = summarise(EVENT, [], [], THREE_HOURS_LATER);
  check("no capture at all", empty.latest, null);
  check("…says so", tones(empty), ["warn"]);

  const stale = summarise(EVENT, [NBA], [], new Date("2026-10-03T12:00:00.000Z"));
  check("three days later it is stale", stale.stale, true);
  check("…and warns first", stale.signals[0].tone, "warn");
  check("…in days", stale.signals[0].text, "Data is 3 days old — reopen the event to refresh it.");

  // "N/A" arrives as null. Nothing derived from it may become 0.
  const loading = summarise(EVENT, [{ ...NBA, tickets_available: null, listings: null }], [], THREE_HOURS_LATER);
  check("unloaded availability: no sell-through", loading.derived.sellThrough, null);
  check("unloaded availability: no runway", loading.derived.runwayDays, null);
  check("…and no supply signal invented", has(loading, /[Ss]upply/), false);
  check("momentum still works without it", loading.derived.momentum, 0.44);

  // First sale this morning must not divide by zero.
  const fresh = summarise(EVENT, [{ ...NBA, first_sale: "2026-09-30" }], [], THREE_HOURS_LATER);
  check("first sale today counts as one day", fresh.derived.daysSelling, 1);
  check("…so the average is finite", fresh.derived.avgSalesPerDay, 584);

  check("a zero floor gives no spread", summarise(EVENT, [{ ...NBA, floor_price: 0 }], [], THREE_HOURS_LATER).derived.spread, null);

  const past = summarise({ ...EVENT, event_date: "2026-09-01" }, [NBA], [], THREE_HOURS_LATER);
  check("a past event is flagged", has(past, /already happened/), true);
  check("…and gets no runway comparison", has(past, /[Ss]upply/), false);

  const hot = summarise(EVENT, [{ ...NBA, sales_24h: 80 }], [], THREE_HOURS_LATER);
  check("80 in 24h is accelerating", has(hot, /^Accelerating/), true);
  check("…and the supply is tight", has(hot, /^Supply is tight/), true);

  const wide = summarise(EVENT, [{ ...NBA, floor_price: 60 }], [], THREE_HOURS_LATER);
  check("3.5× spread is warned about", has(wide, /Wide spread: average is 3\.5×/), true);
}

console.log("\nprices from captured sales");
{
  // A sale of 3 is three purchases at that price, not one.
  check("weighted by quantity",
    ticketPrices([{ price: 340.21, qty: 3, section: "107", sold_at_approx: null },
                  { price: 151.82, qty: 1, section: "309", sold_at_approx: null }]),
    [151.82, 340.21, 340.21, 340.21]);
  check("unpriced rows are skipped",
    ticketPrices([{ price: null, qty: 2, section: null, sold_at_approx: null }]), []);
  check("a missing quantity counts once",
    ticketPrices([{ price: 100, qty: null, section: null, sold_at_approx: null }]), [100]);

  check("median of four", percentile([1, 2, 3, 4], 0.5), 2.5);
  check("p25 of five", percentile([10, 20, 30, 40, 50], 0.25), 20);
  check("one value", percentile([7], 0.9), 7);

  const sales = [
    { price: 340.21, qty: 3, section: "107", sold_at_approx: null },
    { price: 339.86, qty: 2, section: "107", sold_at_approx: null },
    { price: 151.82, qty: 1, section: "309", sold_at_approx: null },
    { price: 152.84, qty: 2, section: "308", sold_at_approx: null },
    { price: null, qty: 4, section: "308", sold_at_approx: null },
  ];
  const s = summarise(EVENT, [NBA], sales, THREE_HOURS_LATER);
  check("price spread over 8 priced tickets", s.prices?.n, 8);
  check("median", s.prices?.median, 339.86);
  check("busiest section first — the unpriced 4 still count",
    s.topSections.map((t) => [t.section, t.tickets]), [["308", 6], ["107", 5], ["309", 1]]);
  check("…but only priced tickets set its median", s.topSections[0].median, 152.84);
  check("fewer than three tickets gives no price band",
    summarise(EVENT, [NBA], [sales[2]], THREE_HOURS_LATER).prices, null);
}

console.log("\ndates");
{
  check("same day", daysBetween("2026-09-30", "2026-09-30"), 0);
  check("across a year end", daysBetween("2026-12-31", "2027-01-01"), 1);
  check("in the past", daysBetween("2026-09-30", "2026-09-20"), -10);
  check("no date", daysBetween("2026-09-30", null), null);
}

console.log(failed === 0 ? "\nAll market-summary tests passed.\n" : `\n${failed} test(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
