"use client";

import { useMemo, useState } from "react";
import { type Ticket, realizedProfit, filterByPeriod, openInvestment, awaitingPayout } from "@/lib/supabase";
import { useDash } from "./DashContext";
import PeriodTabs from "./PeriodTabs";
import TicketsTable from "./TicketsTable";
import ExportButtons from "./ExportButtons";
import { PERIODS } from "@/lib/supabase";

// Fold to a comparable form: lower-case AND strip diacritics, so "cesko" finds
// "česko" and "rosalia" finds "ROSALÍA".
function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}
function haystack(t: Ticket): string {
  return fold(
    [t.event_name, t.location, t.section, t.seat_row, t.seats, t.order_ref, t.comment, t.ticket_type, t.event_date]
      .filter(Boolean)
      .join(" ")
  );
}

export default function EventsPage() {
  const { tickets, loading, error, period } = useDash();
  const [search, setSearch] = useState("");

  const inPeriod = useMemo(() => filterByPeriod(tickets, period), [tickets, period]);

  // One normalized string per row, rebuilt only when the data changes — so each
  // keystroke is a handful of substring checks, not a re-read of every field.
  const index = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tickets) m.set(t.id, haystack(t));
    return m;
  }, [tickets]);

  // Every word must match (AND), in any order, anywhere in the row — so
  // "bad bunny madrid" finds it. Search is global: it looks past the period
  // filter so "find this event" is never hidden by the current window.
  const tokens = useMemo(() => fold(search.trim()).split(/\s+/).filter(Boolean), [search]);
  const searching = tokens.length > 0;
  const shown = useMemo(() => {
    if (!searching) return inPeriod;
    return tickets.filter((t) => {
      const h = index.get(t.id) ?? "";
      return tokens.every((tok) => h.includes(tok));
    });
  }, [searching, tickets, inPeriod, tokens, index]);

  const priced = inPeriod.filter((t) => t.qty_sold > 0 && t.buy_price > 0);
  const totalProfit = priced.reduce((s, t) => s + realizedProfit(t), 0);
  const soldRows = inPeriod.filter((t) => t.qty_sold > 0).length;
  const totalListed = inPeriod.filter((t) => t.status === "listed").length;
  const problems = inPeriod.filter((t) => t.flagged).length;

  // ── The two money-still-out figures ──
  // Both are balances, not flows, so both run over EVERY row and ignore the
  // period tabs: cash sunk into a purchase two years ago is still sunk today,
  // and a payout owed since May is still owed. A window could only ever report
  // them too low. `· all rows` marks them while a period is selected, so the
  // stats that don't follow the tabs say so instead of looking broken.
  const invested = useMemo(() => openInvestment(tickets), [tickets]);
  const awaiting = useMemo(() => awaitingPayout(tickets), [tickets]);
  const allRows = period !== "all" && <span className="stat-caveat"> · all rows</span>;

  // Describe what the export contains, so the file's header line is honest about
  // whether it's everything or just the current search / period slice.
  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "All";
  const exportScope = searching
    ? `Search "${search.trim()}" (${shown.length} rows)`
    : period === "all"
    ? "All events"
    : `Last ${periodLabel}`;

  return (
    <>
      <div className="toolbar">
        <h1>All Events</h1>
        <PeriodTabs />
        <div className="summary">
          <div className="stat"><div className="label">Sold</div><div className="value">{soldRows}</div></div>
          <div className="stat"><div className="label">Listed</div><div className="value">{totalListed}</div></div>
          <div className="stat">
            <div className="label">Problems</div>
            <div className={"value " + (problems > 0 ? "stat-problem" : "")}>{problems || "—"}</div>
          </div>
          <div className="stat"
               title="Your own money still in tickets, at cost: unsold stock, plus the cost of sold rows whose payout hasn't landed. Ticking Paid on a row takes its cost out. Counts every row, not just the selected period.">
            <div className="label">
              Invested now
              {invested.unpriced > 0
                ? <span className="stat-caveat"> · {invested.unpriced} unpriced</span>
                : allRows}
            </div>
            <div className="value">{invested.total > 0 ? `${invested.total.toFixed(0)} EUR` : "—"}</div>
          </div>
          <div className="stat"
               title="Revenue already earned that hasn't reached the bank — the sell price of every sold row not yet ticked Paid. Counts every row, not just the selected period.">
            <div className="label">
              Awaiting payout
              {awaiting.count > 0 && <span className="stat-caveat"> · {awaiting.count} rows</span>}
            </div>
            <div className="value">{awaiting.total > 0 ? `${awaiting.total.toFixed(0)} EUR` : "—"}</div>
          </div>
          <div className="stat">
            <div className="label">
              Total profit
              {priced.length < soldRows && <span className="stat-caveat"> · {priced.length}/{soldRows} priced</span>}
            </div>
            {priced.length === 0 ? (
              <div className="value unknown" title="No sold row has a buy price yet">—</div>
            ) : (
              <div className={"value " + (totalProfit >= 0 ? "profit-pos" : "profit-neg")}>
                {totalProfit.toFixed(2)} EUR
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="table-toolbar">
        <input className="search" placeholder="Search — event, location, seat, order (multiple words ok)…"
               value={search} onChange={(e) => setSearch(e.target.value)} />
        {searching && <span className="search-count">{shown.length} found</span>}
        <ExportButtons rows={shown} scope={exportScope} />
      </div>

      {error && (
        <div className="error-banner">
          <strong>Couldn’t load your rows.</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : error ? null : tickets.length === 0 ? (
        <div className="empty">No events yet. Add a purchase, or wait for a sale email to land.</div>
      ) : shown.length === 0 ? (
        <div className="empty">
          {searching ? "Nothing matches your search." : "No events in this period. Try a longer range."}
        </div>
      ) : (
        <TicketsTable rows={shown} />
      )}
    </>
  );
}
