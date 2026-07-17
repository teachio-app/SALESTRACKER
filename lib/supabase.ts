import { createClient } from "@supabase/supabase-js";

// There was an eagerly-constructed anon/browser client here. Nothing imported it
// — the UI talks to /api/tickets, which uses the service-role client below — but
// because it ran at module load, `next build` crashed with "supabaseUrl is
// required" before any env vars existed. Dead code that broke every deploy.
//
// Server-only client (service role, bypasses RLS). NEVER import in a client
// component. Built per-call so a missing key surfaces as a request-time error
// instead of taking the whole build down.
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(.env.local locally, Project Settings → Environment Variables on Vercel)."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false },
    // Next patches the global fetch and caches GETs. supabase-js calls that
    // patched fetch, so reads get served from Next's Data Cache instead of
    // Postgres. That silently broke the poller: it wrote the watermark to
    // 39004, then re-read a cached 38989 on the next run and re-processed the
    // same 15 messages forever — on Vercel it would have ground over the same
    // batch every 5 minutes and never reached a sale. A database read must hit
    // the database.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
  });
}

export type Ticket = {
  id: string;
  event_name: string;
  event_date: string | null;
  location: string | null;
  section: string | null;
  seat_row: string | null;   // `row` is reserved in Postgres — see schema.sql
  seats: string | null;
  qty_total: number;
  qty_sold: number;
  status: "sold" | "listed" | "not_listed";
  buy_price: number;         // TOTAL for the batch; per-ticket is derived, never stored
  sell_price: number;
  currency: string;
  order_ref: string | null;
  source: string | null;
  external_id: string | null;
  needs_review: boolean;
  purchase_date: string | null;
  ticket_type: string | null;
  email_used: string | null;
  payment_method: string | null;
  vgg_event_id: string | null;
  comment: string | null;
  paid_out: boolean;         // has the payout reached the bank account?
  sales: SaleFill[];         // itemised sales; sell_price/qty_sold are their sums
  profit: number;
  sold_at: string | null;
  created_at: string;
  updated_at: string;
};

// One partial sale of a batch. `amount` is the TOTAL for the fill, not per-ticket.
export type SaleFill = {
  qty: number;
  amount: number;
  at?: string | null;   // sale date (ISO)
  ext?: string;         // poller dedup key
  source?: string;
};

/** Roll a fills list up into the row aggregates. */
export function saleTotals(fills: SaleFill[] | null | undefined): { qty: number; amount: number } {
  return (fills ?? []).reduce(
    (a, f) => ({ qty: a.qty + (Number(f.qty) || 0), amount: a.amount + (Number(f.amount) || 0) }),
    { qty: 0, amount: 0 }
  );
}

export const TICKET_TYPES = ["Mobile", "PDF", "Hard ticket", "Season card"] as const;

export const CURRENCIES = [
  { code: "EUR", label: "EUR - Euro" },
  { code: "GBP", label: "GBP - British Pound" },
  { code: "USD", label: "USD - US Dollar" },
  { code: "CZK", label: "CZK - Czech Koruna" },
] as const;

/** Per-ticket price is always derived from the batch total — never stored. */
export function pricePerTicket(t: Pick<Ticket, "buy_price" | "qty_total">): number {
  return t.qty_total > 0 ? t.buy_price / t.qty_total : 0;
}

// ── Profit model ──────────────────────────────────────────────────────
// Profit counts ONLY the tickets actually sold. The cost of what's still in
// inventory is tracked (it's the full buy_price) but never subtracted from
// profit until those tickets sell. So a 4/6 batch sold below total cost can
// still show a profit — the 2 unsold tickets aren't a loss, they're stock.
//
//   realized cost   = buy_price × (qty_sold / qty_total)
//   realized profit = sell_price − realized cost
//   ROI             = realized profit / realized cost
//
// Fully sold → sell − buy (qty_sold/qty_total = 1). Nothing sold → 0, not −buy.
// This is also the Postgres `profit` generated column; keep the two in step.
type ProfitInput = Pick<Ticket, "buy_price" | "sell_price" | "qty_sold" | "qty_total">;

export function realizedCost(t: Pick<Ticket, "buy_price" | "qty_sold" | "qty_total">): number {
  return t.qty_total > 0 ? (t.buy_price * t.qty_sold) / t.qty_total : 0;
}

export function realizedProfit(t: ProfitInput): number {
  return t.sell_price - realizedCost(t);
}

export function realizedRoi(t: ProfitInput): number {
  const cost = realizedCost(t);
  return cost > 0 ? (realizedProfit(t) / cost) * 100 : 0;
}

// ── Period filter (shared by the Events table and the Charts page) ────
export const PERIODS = [
  { key: "1m", label: "1M", months: 1 },
  { key: "3m", label: "3M", months: 3 },
  { key: "6m", label: "6M", months: 6 },
  { key: "1y", label: "1Y", months: 12 },
  { key: "all", label: "All", months: null as number | null },
] as const;

/** The date a row is placed on the timeline: when it sold, else the event, else creation. */
function periodDate(t: Pick<Ticket, "sold_at" | "event_date" | "created_at">): Date {
  return new Date(t.sold_at ?? t.event_date ?? t.created_at);
}

export function filterByPeriod<T extends Pick<Ticket, "sold_at" | "event_date" | "created_at">>(
  rows: T[],
  periodKey: string
): T[] {
  const p = PERIODS.find((x) => x.key === periodKey);
  if (!p?.months) return rows;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - p.months);
  return rows.filter((t) => periodDate(t) >= cutoff);
}
