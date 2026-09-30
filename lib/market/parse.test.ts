// Run: npx tsx lib/market/parse.test.ts
//
// The fixtures below are transcribed from two captures of the SAME page, taken
// seconds apart — one while the tiles were still loading, one after. That pair
// is the whole reason this file is careful: the only difference between them is
// two tiles reading "N/A" instead of "836" and "2150", and a parser that turns
// N/A into 0 records an event that sold out and then un-sold out.

import {
  parseCount, parseMoney, parseAbsoluteDate, parseRelativeTime, parseCapture,
  saleFingerprint, snapshotIsUseful, isNotKnown, usableSeats,
} from "./parse";
import type { Capture } from "./types";

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`);
}

const CAPTURED_AT = "2026-09-30T12:00:00.000Z";

/** The page as captured once everything had loaded. */
const LOADED: Capture = {
  source: "tikey",
  capturedAt: CAPTURED_AT,
  currency: "EUR",
  event: {
    sourceEventId: "nba-manchester-pelicans-spurs-2027-01-17",
    url: "https://app.tikeymanager.com/sales-tracker/nba-manchester-pelicans-spurs-2027-01-17",
    name: "NBA Manchester: New Orleans Pelicans vs San Antonio Spurs",
    dateText: "Sunday, January 17, 2027",
    venue: "Co-op Live",
    city: "Manchester",
    country: "United Kingdom",
  },
  stats: {
    totalSales: "584",
    totalTickets: "1261",
    averagePrice: "€211,45",
    floorPrice: "€85,66",
    sales24h: "17",
    firstSale: "Sep 15, 2026",
    listings: "836",
    ticketsAvailable: "2150",
  },
  sales: [
    { price: "€340,21", quantity: "3", section: "107", row: "22", seats: "158 - 160", updateText: "9h ago" },
    { price: "€151,82", quantity: "1", section: "309", row: "15", seats: "238 - 238", updateText: "11h ago" },
    { price: "€152,84", quantity: "2", section: "308", row: "11", seats: "9 - 10", updateText: "11h ago" },
    { price: "€339,86", quantity: "2", section: "107", row: "22", seats: "193 - 194", updateText: "11h ago" },
    { price: "€172,23", quantity: "2", section: "324", row: "10", seats: "662 - 663", updateText: "11h ago" },
    { price: "€154,05", quantity: "1", section: "311", row: "11", seats: "4 - 4", updateText: "13h ago" },
    // Their own scrape leaking through. Real row, real junk.
    { price: "€197,03", quantity: "3", section: "315", row: "16", seats: "from - froo", updateText: "13h ago" },
    { price: "€331,98", quantity: "2", section: "107", row: "11", seats: "50 - 51", updateText: "13h ago" },
    { price: "€284,07", quantity: "2", section: "217", row: "3", seats: "23 - 24", updateText: "14h ago" },
  ],
};

/** The same page a second earlier, with two panels still loading. */
const LOADING: Capture = {
  ...LOADED,
  stats: { ...LOADED.stats, listings: "N/A", ticketsAvailable: "N/A" },
};

console.log("\nnot-a-number is not zero");
{
  check("N/A", parseCount("N/A"), null);
  check("N/A money", parseMoney("N/A"), null);
  check("empty", parseCount(""), null);
  check("a dash", parseCount("—"), null);
  check("still loading", parseCount("Loading..."), null);
  check("a real zero survives", parseCount("0"), 0);
  check("isNotKnown on a number", isNotKnown("836"), false);

  const loading = parseCapture(LOADING);
  const loaded = parseCapture(LOADED);
  check("loading capture: listings unknown", loading.stats.listings, null);
  check("loading capture: availability unknown", loading.stats.tickets_available, null);
  check("loaded capture: 836 listings", loaded.stats.listings, 836);
  check("loaded capture: 2150 available", loaded.stats.tickets_available, 2150);
  // Both are worth storing — the half-loaded one still carries 584 sales.
  check("half-loaded is still a useful snapshot", loading.useful, true);
  check("a capture with nothing at all is not",
    snapshotIsUseful({
      total_sales: null, total_tickets: null, average_price: null, floor_price: null,
      sales_24h: null, first_sale: null, listings: null, tickets_available: null, currency: "EUR",
    }), false);
}

console.log("\nnumbers as the page writes them");
{
  check("comma decimal", parseMoney("€211,45"), 211.45);
  check("floor price", parseMoney("€85,66"), 85.66);
  check("dot decimal", parseMoney("$1,234.56"), 1234.56);
  // A count is not money: "1,261" must not come back as 1.261.
  check("thousands separator in a count", parseCount("1,261"), 1261);
  check("thin space in a count", parseCount("1 261"), 1261);
  check("plain count", parseCount("2150"), 2150);
}

console.log("\ndates");
{
  check("short form", parseAbsoluteDate("Sep 15, 2026"), "2026-09-15");
  // The weekday must not be mistaken for the month.
  check("long form with a weekday", parseAbsoluteDate("Sunday, January 17, 2027"), "2027-01-17");
  check("no comma", parseAbsoluteDate("Jan 3 2027"), "2027-01-03");
  check("nonsense", parseAbsoluteDate("soon"), null);
}

console.log("\nrelative time, against the capture instant");
{
  const at = new Date(CAPTURED_AT);
  check("9h ago", parseRelativeTime("9h ago", at).at, "2026-09-30T03:00:00.000Z");
  check("14h ago", parseRelativeTime("14h ago", at).at, "2026-09-29T22:00:00.000Z");
  check("precision is recorded", parseRelativeTime("9h ago", at).precision, "hour");
  check("45 minutes", parseRelativeTime("45 min ago", at).at, "2026-09-30T11:15:00.000Z");
  check("2 days", parseRelativeTime("2 days ago", at).at, "2026-09-28T12:00:00.000Z");
  check("just now", parseRelativeTime("just now", at).at, CAPTURED_AT);

  // The trap: "1mo" must not parse as one minute. Four weeks becoming four
  // minutes would drop a month-old sale straight into the 24h rate.
  check("1mo is a month, not a minute", parseRelativeTime("1mo ago", at).at, "2026-08-31T12:00:00.000Z");
  check("1 month spelled out", parseRelativeTime("1 month ago", at).precision, "month");
  check("1m is a minute", parseRelativeTime("1m ago", at).at, "2026-09-30T11:59:00.000Z");

  // Unreadable text must NOT default to "now".
  check("unreadable → null", parseRelativeTime("¯\\_(ツ)_/¯", at).at, null);
  check("unreadable → precision unknown", parseRelativeTime("gibberish", at).precision, "unknown");
  check("empty → null", parseRelativeTime("", at).at, null);
  // An absolute date in that column is still readable.
  check("absolute date in the column", parseRelativeTime("Sep 15, 2026", at).at, "2026-09-15T12:00:00.000Z");
}

console.log("\nsale identity survives a second visit");
{
  const first = parseCapture(LOADED);
  check("9 rows in, 9 out", first.sales.length, 9);

  // Six hours later the same sales read "15h ago" instead of "9h ago". The
  // fingerprints must not change, or every revisit would double the history.
  const later: Capture = {
    ...LOADED,
    capturedAt: "2026-09-30T18:00:00.000Z",
    sales: LOADED.sales.map((s) => ({
      ...s,
      updateText: `${parseInt(s.updateText, 10) + 6}h ago`,
    })),
  };
  const second = parseCapture(later);
  const a = first.sales.map((s) => s.fingerprint).sort();
  const b = second.sales.map((s) => s.fingerprint).sort();
  check("same fingerprints six hours later", a, b);
  // ...and the timestamps still agree, because the drift cancels out.
  check("and the same sale instant", second.sales[0].sold_at_approx, first.sales[0].sold_at_approx);

  // Seats are the natural key; price is part of it so a relist at a new price
  // is a new sale rather than a silently swallowed one.
  check("seat-based key", first.sales[0].fingerprint, "s|107|22|158-160|340.21");

  // The junk row has no usable seats, so it falls back to the time-bucketed key.
  const junk = first.sales.find((s) => s.seats === "from - froo")!;
  check("junk seats are not usable", usableSeats("from - froo"), false);
  check("junk row falls back to a time key", junk.fingerprint.startsWith("t|"), true);
  check("junk row keeps its raw text", junk.seats, "from - froo");

  // Two different seats in the same section and row must never collide.
  check("107/22/158-160 ≠ 107/22/193-194",
    first.sales[0].fingerprint !== first.sales[3].fingerprint, true);
}

console.log("\nthe whole capture");
{
  const p = parseCapture(LOADED);
  check("event date", p.eventDate, "2027-01-17");
  check("first sale", p.stats.first_sale, "2026-09-15");
  check("currency from the selector", p.stats.currency, "EUR");
  check("24h sales", p.stats.sales_24h, 17);
  check("average price", p.stats.average_price, 211.45);
  check("sale currency read off the row", p.sales[0].currency, "EUR");

  // A duplicated row in one page load is collapsed before it reaches the DB.
  const dupe = parseCapture({ ...LOADED, sales: [...LOADED.sales, LOADED.sales[0]] });
  check("a repeated row is collapsed", dupe.sales.length, 9);

  // A capture with a broken timestamp still parses, using now as the base.
  const broken = parseCapture({ ...LOADED, capturedAt: "not a date" });
  check("a broken capture time does not throw", broken.sales.length, 9);
  check("and is replaced with something valid", isNaN(Date.parse(broken.capturedAt)), false);
}

console.log(failed === 0 ? "\nAll market-parse tests passed.\n" : `\n${failed} test(s) FAILED.\n`);
process.exit(failed === 0 ? 0 : 1);
