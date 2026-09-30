// ─────────────────────────────────────────────────────────────
// The full picture behind a Sales Tracker page, from the data its own scripts
// loaded (see extension/tap.js): every sale rather than the 50 on screen, the
// listings on offer, and the daily series the chart is drawn from.
//
// The site's JSON format is not documented and can change, so nothing here
// assumes it. Arrays are found by SHAPE — objects with a price and a time are
// sales-like; the same without a sale time are listing-like — and the page's
// own tiles arbitrate between candidates: the sales array is the one whose
// length best matches "Total Sales", the listings array the one matching
// "Number of Listings". When nothing fits, callers fall back to what was read
// off the screen, and describePayloads() says what WAS there so the mapping
// can be taught.
// ─────────────────────────────────────────────────────────────

import { parseAmount, currencyOf } from "../parsers/money";

export type RawPayload = { url: string; at: number; json: unknown };

export type ApexChart = {
  id: string;
  type: string;
  title: string;
  yTitle: string;
  xType: string;
  categories: unknown[];
  labels: unknown[];
  series: { name: string; data: unknown[] }[];
};

export type Deep = { payloads: RawPayload[]; apex: ApexChart[]; embedded: RawPayload[]; tap: boolean };

export type DeepSale = {
  at: string | null; // ISO instant of the sale
  price: number | null; // per ticket
  qty: number | null;
  section: string | null;
  row: string | null;
  seats: string | null;
  currency: string | null;
};

export type DeepListing = {
  price: number | null;
  qty: number | null;
  section: string | null;
  row: string | null;
};

export type DailyPoint = { day: string; tickets: number };

// ── walking ───────────────────────────────────────────────────────────

type Found = { path: string; items: Record<string, unknown>[] };

/** Every array of plain objects in a JSON value, with the path that led to it. */
export function objectArrays(root: unknown, maxDepth = 7): Found[] {
  const out: Found[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > maxDepth || v == null) return;
    if (Array.isArray(v)) {
      const objs = v.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
      if (objs.length >= 3 && objs.length >= v.length * 0.8) out.push({ path, items: objs });
      // Look inside the first few elements too: a list of groups can hold the list.
      for (const x of v.slice(0, 5)) walk(x, `${path}[]`, depth + 1);
      return;
    }
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(root, "", 0);
  return out;
}

// ── field roles ───────────────────────────────────────────────────────

const ROLE = {
  price: /^(price|amount|sale_?price|sold_?price|price_?per_?ticket|ticket_?price|unit_?price|value|cost)$|price/i,
  qty: /^(qty|quantity|count|tickets|num_?tickets|number_?of_?tickets|ticket_?count|amount_?of_?tickets|splits?)$/i,
  section: /^(section|section_?name|sector|block|zone|area|stand|category|tribune)$/i,
  row: /^(row|row_?name|seat_?row|rij|reihe)$/i,
  seats: /^(seats?|seat_?numbers?|seat_?range|seat_?info|seat_?from)$/i,
  seatTo: /^(seat_?to|to_?seat)$/i,
  time: /(sold|sale|update|created|date|time|timestamp)(_?at|_?on|_?date|_?time)?$|^(at|ts|when)$/i,
  currency: /^(currency|currency_?code|curr)$/i,
};

/** A key's value as a number, looking one level into {amount|value, currency} objects. */
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") return parseAmount(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["amount", "value", "price", "total"]) if (k in o) return num(o[k]);
  }
  return null;
}

function currencyIn(o: Record<string, unknown>, priceKey: string | null): string | null {
  for (const [k, v] of Object.entries(o)) if (ROLE.currency.test(k) && typeof v === "string" && /^[A-Z]{3}$/.test(v)) return v;
  const p = priceKey ? o[priceKey] : null;
  if (p && typeof p === "object") {
    const c = (p as Record<string, unknown>).currency;
    if (typeof c === "string" && /^[A-Z]{3}$/.test(c)) return c;
  }
  if (typeof p === "string" && /[€$£]/.test(p)) return currencyOf(p);
  return null;
}

/** Epoch seconds or milliseconds, or a date string, as an ISO instant. */
export function toInstant(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  if (typeof v === "string" && /\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4}|[A-Za-z]{3,} \d{1,2},? \d{4}/.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

/** Which key plays which role, decided by name AND by the values seen under it. */
function roles(sample: Record<string, unknown>[]) {
  const keys = new Set<string>();
  for (const o of sample) for (const k of Object.keys(o)) keys.add(k);
  const pick = (re: RegExp, ok: (v: unknown) => boolean) => {
    let best: string | null = null;
    let bestHits = 0;
    for (const k of keys) {
      if (!re.test(k)) continue;
      const hits = sample.filter((o) => ok(o[k])).length;
      if (hits > bestHits) { best = k; bestHits = hits; }
    }
    return bestHits >= Math.max(2, sample.length * 0.5) ? best : null;
  };
  const isStr = (v: unknown) => (typeof v === "string" && v.trim() !== "") || typeof v === "number";
  const price = pick(ROLE.price, (v) => { const n = num(v); return n != null && n > 0 && n < 100_000; });
  const qty = pick(ROLE.qty, (v) => { const n = num(v); return n != null && Number.isInteger(n) && n >= 1 && n <= 100; });

  // The SALE time, not any date. An event date sits on every item unchanged, so
  // a key whose values barely vary is not a time of sale; and among real
  // candidates, a name that says sold/sale beats created/updated beats a bare
  // "date".
  let time: string | null = null;
  let timeRank = -1;
  for (const k of keys) {
    if (!ROLE.time.test(k)) continue;
    const vals = sample.map((o) => toInstant(o[k])).filter((v): v is string => v != null);
    if (vals.length < Math.max(2, sample.length * 0.5)) continue;
    if (new Set(vals).size < Math.max(2, vals.length * 0.3)) continue;
    const rank = /sold|sale/i.test(k) ? 3 : /creat|updat|time|at$/i.test(k) ? 2 : 1;
    if (rank > timeRank) { time = k; timeRank = rank; }
  }
  return {
    price,
    qty: qty === price ? null : qty,
    time,
    section: pick(ROLE.section, isStr),
    row: pick(ROLE.row, isStr),
    seats: pick(ROLE.seats, isStr),
    seatTo: pick(ROLE.seatTo, isStr),
  };
}

const str = (v: unknown) => (v == null || v === "" ? null : String(v).trim() || null);

// ── candidates ────────────────────────────────────────────────────────

type Candidate = { path: string; items: Record<string, unknown>[]; r: ReturnType<typeof roles>; score: number };

function candidates(all: RawPayload[]): Candidate[] {
  const out: Candidate[] = [];
  for (const p of all) {
    for (const f of objectArrays(p.json)) {
      const r = roles(f.items.slice(0, 40));
      if (!r.price) continue;
      let score = 1;
      if (r.qty) score += 1;
      if (r.section) score += 1;
      if (r.row || r.seats) score += 0.5;
      out.push({ path: `${p.url} ${f.path}`, items: f.items, r, score });
    }
  }
  return out;
}

/** Closeness of a length to what the page's tile says, 1 = exact. */
function lengthFit(n: number, expected: number | null): number {
  if (!expected || expected <= 0) return 0.5;
  const ratio = Math.min(n, expected) / Math.max(n, expected);
  return ratio;
}

/**
 * The page's full sales history, if its data contains it.
 *
 * A sales array has a price and a sale time on nearly every item. Among those,
 * the one whose length is closest to the "Total Sales" tile wins — a listings
 * array can carry a created-at time too, and length is what tells them apart.
 * A path naming sales ("sales", "history", "sold") breaks ties; one naming
 * listings counts against.
 */
export function findSales(all: RawPayload[], expectedSales: number | null): { sales: DeepSale[]; path: string } | null {
  // A time and a price alone also describe a daily series ({date, value}); a
  // sale has a section or a quantity as well.
  const pool = candidates(all).filter((c) => c.r.time && (c.r.section || c.r.qty));
  if (!pool.length) return null;
  const rank = (c: Candidate) =>
    c.score + lengthFit(c.items.length, expectedSales) * 3 +
    (/sale|sold|histor|transaction/i.test(c.path) ? 1 : 0) - (/listing|offer|inventory/i.test(c.path) ? 1.5 : 0);
  const best = pool.sort((a, b) => rank(b) - rank(a))[0];
  // A sales array of 5 against a tile of 1,321 is not the history.
  if (expectedSales && best.items.length < Math.min(20, expectedSales * 0.2)) return null;

  const { r } = best;
  const sales: DeepSale[] = best.items.map((o) => {
    const seatFrom = r.seats ? str(o[r.seats]) : null;
    const seatTo = r.seatTo ? str(o[r.seatTo]) : null;
    return {
      at: r.time ? toInstant(o[r.time]) : null,
      price: r.price ? num(o[r.price]) : null,
      qty: r.qty ? num(o[r.qty]) : null,
      section: r.section ? str(o[r.section]) : null,
      row: r.row ? str(o[r.row]) : null,
      seats: seatFrom && seatTo && seatTo !== seatFrom ? `${seatFrom} - ${seatTo}` : seatFrom,
      currency: currencyIn(o, r.price),
    };
  });
  sales.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return { sales, path: best.path };
}

/** What's on offer now, if the data carries the listings: priced items whose count matches "Number of Listings". */
export function findListings(all: RawPayload[], expectedListings: number | null, salesPath: string | null): { listings: DeepListing[]; path: string } | null {
  const pool = candidates(all).filter((c) => c.path !== salesPath);
  if (!pool.length || !expectedListings) return null;
  const rank = (c: Candidate) =>
    c.score + lengthFit(c.items.length, expectedListings) * 3 +
    (/listing|offer|inventory|ticket/i.test(c.path) ? 1 : 0) - (/sale|sold|histor/i.test(c.path) ? 1.5 : 0);
  const best = pool.sort((a, b) => rank(b) - rank(a))[0];
  if (lengthFit(best.items.length, expectedListings) < 0.6) return null;
  const { r } = best;
  return {
    path: best.path,
    listings: best.items.map((o) => ({
      price: r.price ? num(o[r.price]) : null,
      qty: r.qty ? num(o[r.qty]) : null,
      section: r.section ? str(o[r.section]) : null,
      row: r.row ? str(o[r.row]) : null,
    })),
  };
}

// ── the daily series ──────────────────────────────────────────────────

const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * Tickets per calendar day from individual sales, every day present (zeros
 * included) — and on to `untilDay`, the day of the read. Stopping at the last
 * sale would hide exactly the thing worth seeing: a run of days with none.
 */
export function dailyFromSales(sales: DeepSale[], untilDay?: string): DailyPoint[] {
  const by = new Map<string, number>();
  for (const s of sales) {
    if (!s.at) continue;
    const d = dayOf(s.at);
    by.set(d, (by.get(d) ?? 0) + (s.qty && s.qty > 0 ? s.qty : 1));
  }
  if (!by.size) return [];
  const days = [...by.keys()].sort();
  const out: DailyPoint[] = [];
  const last = untilDay && untilDay > days.at(-1)! ? untilDay : days.at(-1)!;
  for (let t = Date.parse(`${days[0]}T00:00:00Z`), end = Date.parse(`${last}T00:00:00Z`); t <= end; t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push({ day: d, tickets: by.get(d) ?? 0 });
  }
  return out;
}

/** A chart's series as daily points, when its x values are dates. */
function apexDaily(c: ApexChart): DailyPoint[] {
  const s = c.series[0];
  if (!s) return [];
  const pts: DailyPoint[] = [];
  s.data.forEach((p, i) => {
    let x: unknown;
    let y: unknown;
    if (Array.isArray(p)) { x = p[0]; y = p[1]; }
    else if (p && typeof p === "object") { x = (p as Record<string, unknown>).x; y = (p as Record<string, unknown>).y; }
    else { x = c.categories[i] ?? c.labels[i]; y = p; }
    const at = toInstant(x);
    const n = num(y);
    if (at && n != null) pts.push({ day: dayOf(at), tickets: n });
  });
  return pts.sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Tickets sold per day, best source first: counted from the full sales history
 * (exact); else the page's own chart series; else nothing.
 */
export function findDaily(sales: DeepSale[] | null, apex: ApexChart[], untilDay?: string): { points: DailyPoint[]; source: "sales" | "chart" } | null {
  if (sales && sales.length) {
    const d = dailyFromSales(sales, untilDay);
    if (d.length) return { points: d, source: "sales" };
  }
  const chart = apex
    .filter((c) => /ticket|sold|quantity/i.test(`${c.title} ${c.yTitle} ${c.series[0]?.name ?? ""}`) || c.xType === "datetime")
    .map(apexDaily)
    .find((pts) => pts.length >= 3);
  return chart ? { points: chart, source: "chart" } : null;
}

/** A short account of what the page's data contained — for the fix report when extraction finds nothing. */
export function describePayloads(all: RawPayload[]): string[] {
  const lines: string[] = [];
  for (const p of all.slice(0, 25)) {
    const arrays = objectArrays(p.json).slice(0, 4)
      .map((f) => `${f.path || "(root)"}[${f.items.length}] keys: ${Object.keys(f.items[0] ?? {}).slice(0, 12).join(",")}`);
    lines.push(`${p.url.replace(/\?.*$/, "")} → ${arrays.length ? arrays.join(" | ") : "no object arrays"}`);
  }
  return lines;
}

/** The whole extraction in one call. */
export function extractDeep(
  deep: Deep | null | undefined,
  tiles: { totalSales: number | null; listings: number | null },
  /** The day of the read, so the daily series runs up to it. */
  untilDay?: string,
) {
  const all = [...(deep?.payloads ?? []), ...(deep?.embedded ?? [])];
  const s = findSales(all, tiles.totalSales);
  const l = findListings(all, tiles.listings, s?.path ?? null);
  const daily = findDaily(s?.sales ?? null, deep?.apex ?? [], untilDay);
  return {
    sales: s?.sales ?? null,
    salesPath: s?.path ?? null,
    listings: l?.listings ?? null,
    listingsPath: l?.path ?? null,
    daily: daily?.points ?? null,
    dailySource: daily?.source ?? null,
    tap: deep?.tap ?? false,
    described: s ? [] : describePayloads(all),
  };
}
