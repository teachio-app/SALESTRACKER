// ─────────────────────────────────────────────────────────────
// MARKET FEATURES — every measurement the Market page and the AI analysis use.
//
// One function turns one read of a Sales Tracker page into numbers: pace over
// several windows and how the windows compare, the shape of the daily curve,
// how prices have moved week by week, how much is on offer against the time
// left, which sections carry the market, and what order sizes look like.
//
// The AI is given THESE, not raw rows, and is told to ground every claim in
// them — so its verdict can be checked against the same table the page shows.
// Everything is computed here, deterministically, and tested; the model's job
// is judgement, not arithmetic.
//
// COVERAGE IS PART OF THE RESULT. With the page's full data (every sale) the
// windows and price trends are exact. With only the 50 rows on screen they are
// not, and the result says so rather than presenting a guess as a measurement.
// ─────────────────────────────────────────────────────────────

import type { ParsedStats } from "./types";
import type { DailyPoint, DeepListing, DeepSale } from "./deep";

const DAY = 86_400_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? a / b : null);
const pctChange = (now: number | null, before: number | null) =>
  now != null && before != null && before > 0 ? r1(((now - before) / before) * 100) : null;

export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Least-squares slope of y over x = 0..n-1. */
export function slope(ys: number[]): number | null {
  const n = ys.length;
  if (n < 3) return null;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  ys.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  return den ? num / den : null;
}

/** One entry per ticket, so a sale of three at €300 weighs as three purchases. */
function ticketPrices(rows: { price: number | null; qty: number | null }[]): number[] {
  const out: number[] = [];
  for (const s of rows) {
    if (s.price == null || s.price <= 0) continue;
    const q = s.qty && s.qty > 0 ? Math.min(s.qty, 50) : 1;
    for (let i = 0; i < q; i++) out.push(s.price);
  }
  return out.sort((a, b) => a - b);
}
const qtyOf = (s: { qty: number | null }) => (s.qty && s.qty > 0 ? s.qty : 1);
const median = (rows: { price: number | null; qty: number | null }[]) => {
  const v = quantile(ticketPrices(rows), 0.5);
  return v == null ? null : r2(v);
};

/** Monday of the ISO week containing `iso`, as YYYY-MM-DD. */
export function weekOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * DAY).toISOString().slice(0, 10);
}

export type Row = { at: string | null; price: number | null; qty: number | null; section: string | null };

export type FeatureInput = {
  stats: ParsedStats;
  eventDate: string | null;
  /** When the page was read — the end of every window. */
  capturedAt: string;
  /** The page's full sales history, when its data carried one. */
  sales: DeepSale[] | null;
  /** The rows visible on screen, used only when the full history isn't there. */
  screenSales: Row[];
  daily: DailyPoint[] | null;
  listings: DeepListing[] | null;
};

export function computeFeatures(input: FeatureInput) {
  const { stats } = input;
  const end = Date.parse(input.capturedAt);
  const endDay = input.capturedAt.slice(0, 10);
  const full = !!(input.sales && input.sales.length);
  const rows: Row[] = full ? input.sales!.map((s) => ({ at: s.at, price: s.price, qty: s.qty, section: s.section })) : input.screenSales;
  const within = (s: Row, fromMs: number, toMs: number) => {
    if (!s.at) return false;
    const t = Date.parse(s.at);
    return t > fromMs && t <= toMs + 5 * 60_000;
  };
  const rowsIn = (days: number, offsetDays = 0) =>
    rows.filter((s) => within(s, end - (days + offsetDays) * DAY, end - offsetDays * DAY));
  const tix = (rs: Row[]) => rs.reduce((a, s) => a + qtyOf(s), 0);

  // ── coverage ──
  const oldestRow = rows.reduce<number | null>((m, s) => (s.at ? Math.min(m ?? Infinity, Date.parse(s.at)) : m), null);
  const coverage = {
    salesSource: full ? "full" : rows.length ? "screen" : "none",
    salesRows: rows.length,
    totalSalesTile: stats.total_sales,
    coveragePct: stats.total_sales ? r1((rows.length / stats.total_sales) * 100) : null,
    /** How far back the rows reach, in days before the read. */
    rowsReachDays: oldestRow != null ? r1((end - oldestRow) / DAY) : null,
    dailySource: input.daily?.length ? (full ? "sales" : "chart") : "none",
    listingsRows: input.listings?.length ?? 0,
  } as const;
  // Windows are exact only when the rows reach back past them.
  const reaches = (days: number) => coverage.rowsReachDays != null && coverage.rowsReachDays >= days;

  // ── volume and timing ──
  const ticketsPerSale = ratio(stats.total_tickets, stats.total_sales);
  const daysToEvent = input.eventDate ? Math.round((Date.parse(`${input.eventDate}T00:00:00Z`) - Date.parse(`${endDay}T00:00:00Z`)) / DAY) : null;
  const daysOnSale = stats.first_sale ? Math.max(1, Math.round((Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${stats.first_sale}T00:00:00Z`)) / DAY)) : null;

  // ── daily series (exact from full sales, else the page's chart) ──
  const daily = input.daily ?? [];
  const lastDays = (n: number, offset = 0) => daily.slice(Math.max(0, daily.length - n - offset), daily.length - offset);
  const sumPts = (pts: DailyPoint[]) => pts.reduce((a, p) => a + p.tickets, 0);

  const fromDaily = daily.length >= 7;
  const tickets7d = full && reaches(7) ? tix(rowsIn(7)) : fromDaily ? sumPts(lastDays(7)) : null;
  const ticketsPrev7d = full && reaches(14) ? tix(rowsIn(7, 7)) : daily.length >= 14 ? sumPts(lastDays(7, 7)) : null;
  const tickets30d = full && reaches(30) ? tix(rowsIn(30)) : daily.length >= 30 ? sumPts(lastDays(30)) : null;
  const tickets24hCounted = reaches(1) ? tix(rowsIn(1)) : null;
  const tickets24h = tickets24hCounted ?? (stats.sales_24h != null && ticketsPerSale != null ? r1(stats.sales_24h * ticketsPerSale) : null);

  const perDayAll = ratio(stats.total_tickets, daysOnSale);
  const perDay7d = tickets7d != null ? tickets7d / 7 : null;
  const perDay30d = tickets30d != null ? tickets30d / 30 : null;

  let peakDay: string | null = null;
  let peakTickets = 0;
  for (const p of daily) if (p.tickets > peakTickets) { peakTickets = p.tickets; peakDay = p.day; }
  const last14 = lastDays(14).map((p) => p.tickets);
  const last30 = lastDays(30).map((p) => p.tickets);

  // ── prices ──
  const recent = full && reaches(7) ? rowsIn(7) : null;
  const prior = full && reaches(30) ? rowsIn(23, 7) : null; // days 8–30
  const window30 = full ? rowsIn(30) : rows;
  const tp30 = ticketPrices(window30.length ? window30 : rows);
  const q = (x: number) => { const v = quantile(tp30, x); return v == null ? null : r2(v); };
  const p25 = q(0.25);
  const p50 = q(0.5);
  const p75 = q(0.75);

  const weekly: { week: string; median: number | null; tickets: number }[] = [];
  if (full) {
    const byWeek = new Map<string, Row[]>();
    for (const s of rows) if (s.at) { const w = weekOf(s.at); byWeek.set(w, [...(byWeek.get(w) ?? []), s]); }
    for (const w of [...byWeek.keys()].sort().slice(-8)) weekly.push({ week: w, median: median(byWeek.get(w)!), tickets: tix(byWeek.get(w)!) });
  }
  const weeklyMedians = weekly.map((w) => w.median).filter((v): v is number => v != null);

  // ── supply ──
  const listingPrices = input.listings ? ticketPrices(input.listings) : [];
  const listingMedian = quantile(listingPrices, 0.5);
  const soldRecentMedian = recent && recent.length ? median(recent) : p50;
  const sellThrough = stats.total_tickets != null && stats.tickets_available != null && stats.total_tickets + stats.tickets_available > 0
    ? stats.total_tickets / (stats.total_tickets + stats.tickets_available) : null;
  const pace = perDay7d ?? perDayAll;
  const daysOfSupply = stats.tickets_available != null && pace ? stats.tickets_available / pace : null;

  // ── sections ──
  const bySection = new Map<string, { all: Row[]; recent: Row[] }>();
  const recentCut = end - 7 * DAY;
  for (const s of rows) {
    const k = (s.section ?? "").trim();
    if (!k) continue;
    const e = bySection.get(k) ?? { all: [], recent: [] };
    e.all.push(s);
    if (s.at && Date.parse(s.at) > recentCut) e.recent.push(s);
    bySection.set(k, e);
  }
  const allTix = tix(rows) || 1;
  const recentTixAll = tix(rows.filter((s) => s.at && Date.parse(s.at) > recentCut)) || 0;
  const sections = [...bySection.entries()]
    .map(([section, e]) => {
      const t = tix(e.all);
      const t7 = tix(e.recent);
      const share = t / allTix;
      return {
        section,
        tickets: t,
        share: r1(share * 100),
        median: median(e.all),
        tickets7d: full ? t7 : null,
        // Its share of the last week against its share overall: >1 = gaining.
        momentum: full && recentTixAll > 0 && share > 0 ? r2(t7 / recentTixAll / share) : null,
        listingsNow: input.listings ? input.listings.filter((l) => (l.section ?? "").trim() === section).reduce((a, l) => a + qtyOf(l), 0) : null,
      };
    })
    .sort((a, b) => b.tickets - a.tickets)
    .slice(0, 12);

  // ── order sizes ──
  const orders = rows.length || 1;
  const mix = { one: 0, two: 0, three: 0, fourPlus: 0 };
  for (const s of rows) { const n = qtyOf(s); if (n === 1) mix.one++; else if (n === 2) mix.two++; else if (n === 3) mix.three++; else mix.fourPlus++; }

  return {
    coverage,
    volume: {
      totalSales: stats.total_sales,
      totalTickets: stats.total_tickets,
      ticketsPerSale: ticketsPerSale == null ? null : r2(ticketsPerSale),
    },
    timing: {
      firstSale: stats.first_sale,
      daysOnSale,
      daysToEvent,
      /** Share of the selling window already gone: 0 = just on sale, 1 = event day. */
      windowElapsed: daysOnSale != null && daysToEvent != null && daysToEvent >= 0 ? r2(daysOnSale / (daysOnSale + daysToEvent)) : null,
    },
    velocity: {
      sales24hTile: stats.sales_24h,
      tickets24h: tickets24h == null ? null : r1(tickets24h),
      tickets24hCounted: tickets24hCounted != null,
      tickets7d,
      ticketsPrev7d,
      tickets30d,
      perDayAllTime: perDayAll == null ? null : r1(perDayAll),
      perDay7d: perDay7d == null ? null : r1(perDay7d),
      perDay30d: perDay30d == null ? null : r1(perDay30d),
      weekOverWeekPct: pctChange(tickets7d, ticketsPrev7d),
      ratio7dVs30d: perDay7d != null && perDay30d ? r2(perDay7d / perDay30d) : null,
      ratio7dVsAllTime: perDay7d != null && perDayAll ? r2(perDay7d / perDayAll) : null,
      ratio24hVs7d: tickets24h != null && perDay7d ? r2(tickets24h / perDay7d) : null,
    },
    trend: {
      slope14d: last14.length >= 7 ? r2(slope(last14)!) : null,
      slope30d: last30.length >= 14 ? r2(slope(last30)!) : null,
      peakDay,
      peakTickets: peakDay ? peakTickets : null,
      daysSincePeak: peakDay ? Math.round((Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${peakDay}T00:00:00Z`)) / DAY) : null,
      last7dShareOfAllPct: tickets7d != null && stats.total_tickets ? r1((tickets7d / stats.total_tickets) * 100) : null,
      zeroDaysLast14: last14.length ? last14.filter((t) => t === 0).length : null,
    },
    price: {
      floor: stats.floor_price,
      average: stats.average_price,
      p25, median: p50, p75,
      p10: q(0.1),
      p90: q(0.9),
      /** Spread of the middle half against the median: how dispersed prices are. */
      iqrOverMedian: p25 != null && p75 != null && p50 ? r2((p75 - p25) / p50) : null,
      // Three places: a €2 junk floor against a €530 median is 0.005, and two
      // places would round the one number that gives it away down to zero.
      floorOverMedian: stats.floor_price != null && p50 ? Math.round((stats.floor_price / p50) * 1000) / 1000 : null,
      median7d: recent && recent.length ? median(recent) : null,
      medianPrev: prior && prior.length ? median(prior) : null,
      change7dVsPrevPct: pctChange(recent && recent.length ? median(recent) : null, prior && prior.length ? median(prior) : null),
      weekly,
      weeklyTrendPerWeek: weeklyMedians.length >= 3 ? r2(slope(weeklyMedians)!) : null,
      basis: full ? "all sales, last 30 days" : "rows on screen only",
    },
    supply: {
      available: stats.tickets_available,
      listings: stats.listings,
      ticketsPerListing: ratio(stats.tickets_available, stats.listings) == null ? null : r2(ratio(stats.tickets_available, stats.listings)!),
      sellThroughPct: sellThrough == null ? null : r1(sellThrough * 100),
      /** Days the tickets on offer would last at the last week's pace (or all-time pace). */
      daysOfSupply: daysOfSupply == null ? null : r1(daysOfSupply),
      daysOfSupplyOverDaysLeft: daysOfSupply != null && daysToEvent != null && daysToEvent > 0 ? r2(daysOfSupply / daysToEvent) : null,
      listingPriceMin: listingPrices.length ? r2(listingPrices[0]) : null,
      listingPriceMedian: listingMedian == null ? null : r2(listingMedian),
      /** Asking prices against what sold recently: >0 = sellers ask above the market. */
      askOverSoldPct: pctChange(listingMedian, soldRecentMedian),
    },
    sections,
    orderSizes: {
      onePct: r1((mix.one / orders) * 100),
      twoPct: r1((mix.two / orders) * 100),
      threePct: r1((mix.three / orders) * 100),
      fourPlusPct: r1((mix.fourPlus / orders) * 100),
    },
  };
}

export type Features = ReturnType<typeof computeFeatures>;
