"use client";

import { useMemo, useState } from "react";
import { type Ticket, realizedProfit, filterByPeriod } from "@/lib/supabase";
import { useDash } from "./DashContext";
import PeriodTabs from "./PeriodTabs";
import TicketsTable from "./TicketsTable";

function matchesSearch(t: Ticket, q: string): boolean {
  if (!q) return true;
  return [t.event_name, t.location, t.section, t.seat_row, t.seats, t.order_ref]
    .some((f) => (f ?? "").toLowerCase().includes(q));
}

export default function EventsPage() {
  const { tickets, loading, error, period } = useDash();
  const [search, setSearch] = useState("");

  // Period drives the summary; search narrows the table on top of it.
  const inPeriod = useMemo(() => filterByPeriod(tickets, period), [tickets, period]);
  const shown = useMemo(
    () => inPeriod.filter((t) => matchesSearch(t, search.trim().toLowerCase())),
    [inPeriod, search]
  );

  const priced = inPeriod.filter((t) => t.qty_sold > 0 && t.buy_price > 0);
  const totalProfit = priced.reduce((s, t) => s + realizedProfit(t), 0);
  const soldRows = inPeriod.filter((t) => t.qty_sold > 0).length;
  const totalListed = inPeriod.filter((t) => t.status === "listed").length;
  const awaitingPayout = inPeriod
    .filter((t) => t.qty_sold > 0 && !t.paid_out)
    .reduce((s, t) => s + t.sell_price, 0);

  return (
    <>
      <div className="toolbar">
        <h1>All Events</h1>
        <PeriodTabs />
        <div className="summary">
          <div className="stat"><div className="label">Sold</div><div className="value">{soldRows}</div></div>
          <div className="stat"><div className="label">Listed</div><div className="value">{totalListed}</div></div>
          <div className="stat">
            <div className="label">Awaiting payout</div>
            <div className="value">{awaitingPayout > 0 ? `${awaitingPayout.toFixed(0)} EUR` : "—"}</div>
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
        <input className="search" placeholder="Search event, location, seat, order…"
               value={search} onChange={(e) => setSearch(e.target.value)} />
        {search && <span className="search-count">{shown.length} of {inPeriod.length}</span>}
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
        <div className="empty">Nothing matches. Widen the period or clear the search.</div>
      ) : (
        <TicketsTable rows={shown} />
      )}
    </>
  );
}
