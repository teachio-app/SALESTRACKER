// ─────────────────────────────────────────────────────────────
// One read of a Tikey Sales Tracker page, turned into everything the Market
// page shows. Runs in the browser; nothing is stored — a new Find is a new
// read.
//
// Two layers of data, best first:
//   * DEEP — the page's own JSON (every sale, the listings, the daily series),
//     when the extension's tap caught it. This is what makes the table show all
//     1,321 sales and the windows exact.
//   * SCREEN — the tiles and the 50 rows visible on the page. Always there, and
//     what everything falls back to.
// ─────────────────────────────────────────────────────────────

import { parseAbsoluteDate, parseCapture } from "@/lib/market/parse";
import { extractDeep, type DailyPoint, type Deep, type DeepListing } from "@/lib/market/deep";
import { computeFeatures, type Features } from "@/lib/market/features";
import type { Capture, ParsedStats } from "@/lib/market/types";

export type TableSale = {
  at: string | null;
  price: number | null;
  qty: number | null;
  section: string | null;
  row: string | null;
  seats: string | null;
  currency: string;
  /** How far to trust `at`: exact for the page's data, approximate for "9h ago". */
  approx: boolean;
};

export type MarketView = {
  vggId: string;
  capturedAt: string;
  event: {
    name: string;
    dateText: string;
    date: string | null;
    venue: string | null;
    city: string | null;
    country: string | null;
    tikeyUrl: string;
    imageUrl: string | null;
  };
  stats: ParsedStats;
  sales: TableSale[];
  salesSource: "full" | "screen";
  daily: DailyPoint[] | null;
  dailySource: "sales" | "chart" | null;
  listings: DeepListing[] | null;
  features: Features;
  missing: string[];
  /** What to send when something wasn't found: page text + a description of its data. */
  report: string[];
};

export function buildView(vggId: string, capture: Capture, deep: Deep | undefined, missing: string[], outline: string[] = []): MarketView {
  const parsed = parseCapture(capture);
  const stats = parsed.stats;
  const x = extractDeep(deep, { totalSales: stats.total_sales, listings: stats.listings }, parsed.capturedAt.slice(0, 10));
  const currency = stats.currency;

  const screen: TableSale[] = parsed.sales.map((s) => ({
    at: s.sold_at_approx,
    price: s.price,
    qty: s.qty,
    section: s.section,
    row: s.seat_row,
    seats: s.seats,
    currency: s.currency,
    approx: true,
  }));
  const full: TableSale[] | null = x.sales
    ? x.sales.map((s) => ({ ...s, currency: s.currency ?? currency, approx: false }))
    : null;

  const features = computeFeatures({
    stats,
    eventDate: parsed.eventDate,
    capturedAt: parsed.capturedAt,
    sales: x.sales,
    screenSales: screen.map((s) => ({ at: s.at, price: s.price, qty: s.qty, section: s.section })),
    daily: x.daily,
    listings: x.listings,
  });

  // The full history is only worth saying is missing when the tiles say there
  // is more of it than the screen showed.
  const gaps = [...missing];
  if (!full && stats.total_sales != null && stats.total_sales > screen.length) {
    gaps.push(`full sales history (${deep?.tap === false ? "page data not captured" : "not found in the page's data"})`);
  }

  return {
    vggId,
    capturedAt: parsed.capturedAt,
    event: {
      name: capture.event.name,
      dateText: capture.event.dateText ?? "",
      date: parsed.eventDate ?? parseAbsoluteDate(capture.event.dateText),
      venue: capture.event.venue || null,
      city: capture.event.city || null,
      country: capture.event.country || null,
      tikeyUrl: capture.event.url,
      imageUrl: capture.event.imageUrl || null,
    },
    stats,
    sales: full ?? screen,
    salesSource: full ? "full" : "screen",
    daily: x.daily,
    dailySource: x.dailySource,
    listings: x.listings,
    features,
    missing: gaps,
    report: [
      ...(outline.length ? ["page text, in order:", ...outline, ""] : []),
      ...(x.described.length ? ["page data (JSON the page loaded):", ...x.described] : []),
      ...(x.salesPath ? [`sales found at: ${x.salesPath}`] : []),
      ...(x.listingsPath ? [`listings found at: ${x.listingsPath}`] : []),
    ],
  };
}
