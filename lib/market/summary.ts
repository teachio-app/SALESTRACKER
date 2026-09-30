// ─────────────────────────────────────────────────────────────
// MARKET SUMMARY — what the numbers on a Sales Tracker page actually say.
//
// A page shows eight tiles and leaves the reading to you. This does the reading:
// how fast it is selling now against how fast it has sold on average, how long
// the supply on offer would last at today's pace against how long is left until
// the event, and what changed since you last looked.
//
// What it deliberately does NOT do is say "buy" or "sell". Every output here is
// a measurement with its working shown, and every signal is phrased as what the
// data says rather than what to do about it. The decision stays with the person
// who knows what they paid, what the venue is like, and what the act draws.
//
// ESTIMATES ARE LABELLED AS ESTIMATES. Several figures below are derived —
// tickets in the last 24h from sales in the last 24h, runway from a single
// day's pace — and a pace measured over one day can swing by half the next.
// They are useful for comparing events with each other and misleading as
// forecasts, and the wording says so.
// ─────────────────────────────────────────────────────────────

export type SummaryEvent = {
  name: string;
  event_date: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  url: string | null;
};

export type SummarySnapshot = {
  captured_at: string;
  total_sales: number | null;
  total_tickets: number | null;
  average_price: number | null;
  floor_price: number | null;
  sales_24h: number | null;
  first_sale: string | null;
  listings: number | null;
  tickets_available: number | null;
  currency: string;
};

export type SummarySale = {
  price: number | null;
  qty: number | null;
  section: string | null;
  sold_at_approx: string | null;
};

export type Tone = "up" | "down" | "neutral" | "warn";
export type Signal = { tone: Tone; text: string };

export type Summary = {
  event: SummaryEvent;
  daysToEvent: number | null;
  capturedAt: string | null;
  ageHours: number | null;
  stale: boolean;
  currency: string;
  latest: SummarySnapshot | null;
  derived: {
    ticketsPerSale: number | null;
    daysSelling: number | null;
    avgSalesPerDay: number | null;
    /** sales_24h ÷ average daily sales. 1 = selling at its usual pace. */
    momentum: number | null;
    /** Share of all tickets ever offered that have sold. */
    sellThrough: number | null;
    /** Average price ÷ floor. How far the cheapest seat sits below the typical one. */
    spread: number | null;
    tickets24hEst: number | null;
    /** Days the current supply would last at the last day's pace. An estimate. */
    runwayDays: number | null;
  };
  /** What moved between the two most recent captures. */
  change: {
    hours: number;
    sales: number | null;
    tickets: number | null;
    available: number | null;
    floor: number | null;
    average: number | null;
  } | null;
  prices: { n: number; p25: number; median: number; p75: number } | null;
  topSections: { section: string; tickets: number; median: number | null }[];
  signals: Signal[];
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Data older than this is shown with a warning, because markets move daily. */
export const STALE_HOURS = 48;

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
const ratio = (a: number | null, b: number | null) =>
  a != null && b != null && b > 0 ? a / b : null;

/** Whole days from `today` (a YYYY-MM-DD) to `date`. Negative once it's passed. */
export function daysBetween(today: string, date: string | null): number | null {
  if (!date) return null;
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY);
}

/** Linear-interpolated percentile of an already sorted list. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Per-ticket prices from the captured sales, one entry per ticket sold.
 *
 * The page's PRICE column is read as a price PER TICKET, not per sale. The
 * evidence is in the capture itself: rows of 1, 2 and 3 tickets all sit in the
 * same €150–€340 band, and the Average Price tile (€211) falls inside that band
 * rather than at a third of it — neither would hold if a 3-ticket row showed the
 * total. If that ever turns out wrong, this is the one function to change.
 *
 * Weighting by quantity is what makes the median a price buyers paid: a sale of
 * three seats is three purchases at that price, not one.
 */
export function ticketPrices(sales: SummarySale[]): number[] {
  const out: number[] = [];
  for (const s of sales) {
    if (s.price == null || s.price <= 0) continue;
    const q = s.qty && s.qty > 0 ? Math.min(s.qty, 50) : 1; // 50: a typo guard, not a real cap
    for (let i = 0; i < q; i++) out.push(s.price);
  }
  return out.sort((a, b) => a - b);
}

export function summarise(
  event: SummaryEvent,
  snapshots: SummarySnapshot[],
  sales: SummarySale[],
  now: Date
): Summary {
  const today = now.toISOString().slice(0, 10);
  const ordered = [...snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const latest = ordered.at(-1) ?? null;
  const previous = ordered.length >= 2 ? ordered[ordered.length - 2] : null;

  const ageHours = latest ? round((now.getTime() - Date.parse(latest.captured_at)) / HOUR, 1) : null;
  const daysToEvent = daysBetween(today, event.event_date);
  const currency = latest?.currency ?? "EUR";

  // ── derived ──
  const ticketsPerSale = ratio(latest?.total_tickets ?? null, latest?.total_sales ?? null);
  // Days selling is counted to the CAPTURE, not to now: an old capture measured
  // pace up to when it was taken, and dividing by today would understate it.
  const captureDay = latest ? latest.captured_at.slice(0, 10) : today;
  const sellingDays = latest?.first_sale ? daysBetween(latest.first_sale, captureDay) : null;
  // At least one day, or a first sale this morning divides by zero.
  const daysSelling = sellingDays == null ? null : Math.max(1, sellingDays);
  const avgSalesPerDay = ratio(latest?.total_sales ?? null, daysSelling);
  const momentum = ratio(latest?.sales_24h ?? null, avgSalesPerDay);
  const sellThrough =
    latest?.total_tickets != null && latest?.tickets_available != null &&
    latest.total_tickets + latest.tickets_available > 0
      ? latest.total_tickets / (latest.total_tickets + latest.tickets_available)
      : null;
  const spread = ratio(latest?.average_price ?? null, latest?.floor_price ?? null);
  const tickets24hEst =
    latest?.sales_24h != null && ticketsPerSale != null ? latest.sales_24h * ticketsPerSale : null;
  const runwayDays =
    latest?.tickets_available != null && tickets24hEst != null && tickets24hEst > 0
      ? latest.tickets_available / tickets24hEst
      : null;

  // ── change since the previous capture ──
  const diff = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null ? round(a - b) : null;
  const change = latest && previous
    ? {
        hours: round((Date.parse(latest.captured_at) - Date.parse(previous.captured_at)) / HOUR, 1),
        sales: diff(latest.total_sales, previous.total_sales),
        tickets: diff(latest.total_tickets, previous.total_tickets),
        available: diff(latest.tickets_available, previous.tickets_available),
        floor: diff(latest.floor_price, previous.floor_price),
        average: diff(latest.average_price, previous.average_price),
      }
    : null;

  // ── prices and sections, from the captured sale rows ──
  const tp = ticketPrices(sales);
  const prices = tp.length >= 3
    ? { n: tp.length, p25: round(percentile(tp, 0.25)), median: round(percentile(tp, 0.5)), p75: round(percentile(tp, 0.75)) }
    : null;

  // A sale with no readable price still counts toward how much a section sold;
  // it just can't contribute to that section's median.
  const bySection = new Map<string, { tickets: number; priced: SummarySale[] }>();
  for (const s of sales) {
    const key = (s.section ?? "").trim();
    if (!key) continue;
    const entry = bySection.get(key) ?? { tickets: 0, priced: [] };
    entry.tickets += s.qty && s.qty > 0 ? Math.min(s.qty, 50) : 1;
    if (s.price != null && s.price > 0) entry.priced.push(s);
    bySection.set(key, entry);
  }
  const topSections = [...bySection.entries()]
    .map(([section, { tickets, priced }]) => {
      const tp = ticketPrices(priced);
      return { section, tickets, median: tp.length ? round(percentile(tp, 0.5)) : null };
    })
    .sort((a, b) => b.tickets - a.tickets || a.section.localeCompare(b.section))
    .slice(0, 3);

  // ── signals ──
  const signals: Signal[] = [];
  const x = (n: number) => `${round(n, 1)}×`;
  const pct = (n: number) => `${Math.round(n * 100)} %`;
  // Same thousands separator as every figure on the page — "2150" in a
  // sentence beside a "2,150" tile reads like two different numbers.
  const num = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));

  if (!latest) {
    signals.push({ tone: "warn", text: "No capture yet — open the event on the tracker site once." });
  } else {
    if (ageHours != null && ageHours > STALE_HOURS) {
      signals.push({ tone: "warn", text: `Data is ${Math.round(ageHours / 24)} days old — reopen the event to refresh it.` });
    }
    if (daysToEvent != null && daysToEvent < 0) {
      signals.push({ tone: "warn", text: "This event has already happened." });
    }

    if (momentum != null && avgSalesPerDay != null) {
      const base = `${num(latest.sales_24h)} sales in 24h vs ${round(avgSalesPerDay, 1)}/day on average (${x(momentum)})`;
      if (momentum >= 1.3) signals.push({ tone: "up", text: `Accelerating: ${base}.` });
      else if (momentum <= 0.6) signals.push({ tone: "down", text: `Slowing: ${base}.` });
      else signals.push({ tone: "neutral", text: `Steady: ${base}.` });
    }

    if (runwayDays != null && daysToEvent != null && daysToEvent > 0) {
      const base = `${num(latest.tickets_available)} available ≈ ${Math.round(runwayDays)} days at the last day's pace; event in ${daysToEvent} days`;
      if (runwayDays < daysToEvent * 0.5) signals.push({ tone: "up", text: `Supply is tight: ${base}. (Estimate from one day.)` });
      else if (runwayDays > daysToEvent) signals.push({ tone: "down", text: `More supply than time: ${base}. (Estimate from one day.)` });
      else signals.push({ tone: "neutral", text: `Supply roughly matches the time left: ${base}. (Estimate from one day.)` });
    }

    if (sellThrough != null) {
      const base = `${pct(sellThrough)} of all tickets offered have sold`;
      if (sellThrough >= 0.5) signals.push({ tone: "up", text: `${base}.` });
      else if (sellThrough < 0.2) signals.push({ tone: "down", text: `Only ${base}.` });
      else signals.push({ tone: "neutral", text: `${base}.` });
    }

    if (spread != null && spread >= 2.5) {
      signals.push({
        tone: "warn",
        text: `Wide spread: average is ${x(spread)} the floor — the cheapest seats are pulling far below the typical sale.`,
      });
    }

    if (change && change.hours > 0) {
      if (change.available != null && change.available !== 0) {
        const dir = change.available < 0 ? "down" : "up";
        signals.push({
          tone: change.available < 0 ? "up" : "down",
          text: `Availability ${dir} ${num(Math.abs(change.available))} since your last capture ${Math.round(change.hours)}h ago.`,
        });
      }
      if (change.floor != null && Math.abs(change.floor) >= 0.01 && latest.floor_price) {
        const rel = change.floor / (latest.floor_price - change.floor || 1);
        if (Math.abs(rel) >= 0.05) {
          signals.push({
            tone: change.floor > 0 ? "up" : "down",
            text: `Floor ${change.floor > 0 ? "up" : "down"} ${pct(Math.abs(rel))} since your last capture.`,
          });
        }
      }
    }
  }

  return {
    event,
    daysToEvent,
    capturedAt: latest?.captured_at ?? null,
    ageHours,
    stale: ageHours != null && ageHours > STALE_HOURS,
    currency,
    latest,
    derived: {
      ticketsPerSale: ticketsPerSale == null ? null : round(ticketsPerSale),
      daysSelling,
      avgSalesPerDay: avgSalesPerDay == null ? null : round(avgSalesPerDay, 1),
      momentum: momentum == null ? null : round(momentum),
      sellThrough: sellThrough == null ? null : round(sellThrough, 3),
      spread: spread == null ? null : round(spread),
      tickets24hEst: tickets24hEst == null ? null : round(tickets24hEst, 1),
      runwayDays: runwayDays == null ? null : round(runwayDays, 1),
    },
    change,
    prices,
    topSections,
    signals,
  };
}
