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
  flagged: boolean;          // user-set "problem with this transaction" flag
  flag_note: string | null;  // what's wrong (bad refund, payment mismatch…), optional
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

// ── Cash entries ──────────────────────────────────────────────────────
// Money in or out that isn't a ticket batch: "prodej kódů LA28", a Viagogo fee,
// a train ticket to a collection. May point at a ticket row, may not — see the
// `entries` table in schema.sql.
export type CashEntry = {
  id: string;
  kind: "income" | "expense";
  description: string;
  amount: number;            // ALWAYS positive — `kind` carries the sign
  currency: string;
  category: string | null;
  occurred_at: string;       // yyyy-mm-dd — when the money moved
  ticket_id: string | null;  // optional link to the event it relates to
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** Suggestions only — the category box is free text (datalist, not a select). */
export const ENTRY_CATEGORIES = [
  "Codes", "Tickets", "Fees", "Shipping", "Travel", "Software", "Refund", "Other",
] as const;

/** +amount for income, −amount for a cost. The only place the sign is applied. */
export function signedAmount(e: Pick<CashEntry, "kind" | "amount">): number {
  return e.kind === "expense" ? -e.amount : e.amount;
}

export function entryTotals(rows: CashEntry[]): { income: number; expense: number; net: number } {
  let income = 0, expense = 0;
  for (const e of rows) {
    if (e.kind === "expense") expense += e.amount;
    else income += e.amount;
  }
  return { income, expense, net: income - expense };
}

// ── To-do ─────────────────────────────────────────────────────────────
// Notes for work that still has to go into the tracker. Free text with an
// optional deadline — see the `todos` table in schema.sql.
export type Todo = {
  id: string;
  text: string;
  due: string | null; // yyyy-mm-dd, optional
  done: boolean;
  done_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TodoState = "done" | "overdue" | "today" | "upcoming" | "someday";

/** Local yyyy-mm-dd. Not toISOString(), which is UTC and can be yesterday. */
export function todayISO(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function todoState(t: Pick<Todo, "due" | "done">, today = todayISO()): TodoState {
  if (t.done) return "done";
  if (!t.due) return "someday";
  // Both sides are yyyy-mm-dd, so a string compare IS a date compare — no Date
  // parsing, and therefore no timezone to get it wrong by a day.
  if (t.due < today) return "overdue";
  if (t.due === today) return "today";
  return "upcoming";
}

const ORDER: Record<TodoState, number> = { overdue: 0, today: 1, upcoming: 2, someday: 3, done: 4 };

/**
 * What needs doing first, first. Open items before finished ones, dated before
 * undated, earliest deadline at the top; within a group, newest note first —
 * an undated note is a thought you just had, not a task from last month.
 */
export function sortTodos(list: Todo[], today = todayISO()): Todo[] {
  return [...list].sort((a, b) => {
    const d = ORDER[todoState(a, today)] - ORDER[todoState(b, today)];
    if (d !== 0) return d;
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.created_at < b.created_at ? 1 : -1;
  });
}

/** Headline counts for the page and the sidebar badge. */
export function todoCounts(list: Todo[], today = todayISO()) {
  let open = 0, overdue = 0, dueToday = 0, done = 0;
  for (const t of list) {
    const s = todoState(t, today);
    if (s === "done") done++;
    else open++;
    if (s === "overdue") overdue++;
    if (s === "today") dueToday++;
  }
  return { open, overdue, dueToday, done, total: list.length };
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

// ── Open investment: money still out ──────────────────────────────────
// How much of your own cash is sitting in tickets right now. Two things are
// still out at any moment:
//
//   * tickets not sold yet — stock you paid for;
//   * tickets that HAVE sold but whose payout hasn't landed. Sold ≠ paid;
//     platforms pay days after the event.
//
// Ticking Paid on a row says the cash arrived, and what arrived covers exactly
// the sold portion's cost — so that part stops being an investment while any
// unsold remainder keeps counting until it too sells and gets paid:
//
//   tied up = buy_price − (paid_out ? realized cost : 0)
//
// Nothing sold → the whole buy_price. Fully sold and paid → 0. Note this is a
// balance (what's out NOW), not a flow over a window — see the caller for why it
// deliberately ignores the period tabs.
export function tiedUpCost(
  t: Pick<Ticket, "buy_price" | "qty_sold" | "qty_total" | "paid_out">
): number {
  const out = t.buy_price - (t.paid_out ? realizedCost(t) : 0);
  // Guard against a row whose qty_sold exceeds qty_total (a linked sale can
  // overshoot), which would otherwise make the balance negative.
  return out > 0 ? out : 0;
}

/**
 * Revenue already earned that hasn't reached the bank: the sell side of every
 * sold row still unticked. The mirror of openInvestment() — that one is cost
 * out, this one is cash owed — and, like it, a BALANCE. Both therefore ignore
 * the period tabs; a payout owed since May is still owed in July, and a 1M
 * window used to report this one ~10k lower than the truth while the invested
 * figure beside it (which never filtered) stayed put. Two numbers about the same
 * money, computed over different sets, is how a header stops being believable.
 */
export function awaitingPayout(rows: Ticket[]): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const t of rows) {
    if (t.qty_sold <= 0 || t.paid_out) continue;
    total += t.sell_price;
    count++;
  }
  return { total, count };
}

/** Total still tied up, plus how many of those rows have no known cost. */
export function openInvestment(rows: Ticket[]): { total: number; unpriced: number } {
  let total = 0;
  let unpriced = 0;
  for (const t of rows) {
    // A row is exposed while anything is unsold, or it sold and isn't paid yet.
    const exposed = t.qty_sold < t.qty_total || !t.paid_out;
    if (!exposed) continue;
    if (t.buy_price > 0) total += tiedUpCost(t);
    else unpriced++; // cost unknown → can't be counted, but must be admitted
  }
  return { total, unpriced };
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

/** Start of the selected window, or null for "All" (no filtering at all). */
export function periodCutoff(periodKey: string): Date | null {
  const p = PERIODS.find((x) => x.key === periodKey);
  if (!p?.months) return null;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - p.months);
  return cutoff;
}

export function filterByPeriod<T extends Pick<Ticket, "sold_at" | "event_date" | "created_at">>(
  rows: T[],
  periodKey: string
): T[] {
  const cutoff = periodCutoff(periodKey);
  if (!cutoff) return rows;
  return rows.filter((t) => periodDate(t) >= cutoff);
}

/** Same window, but a cash entry sits on the timeline by the date it happened. */
export function filterEntriesByPeriod<T extends Pick<CashEntry, "occurred_at">>(
  rows: T[],
  periodKey: string
): T[] {
  const cutoff = periodCutoff(periodKey);
  if (!cutoff) return rows;
  return rows.filter((e) => new Date(e.occurred_at) >= cutoff);
}
