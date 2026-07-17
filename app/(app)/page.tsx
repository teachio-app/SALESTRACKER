"use client";

import { useMemo } from "react";
import { type Ticket, realizedProfit, realizedRoi, filterByPeriod } from "@/lib/supabase";
import { useDash } from "./DashContext";
import PeriodTabs from "./PeriodTabs";

const STATUS_LABEL: Record<Ticket["status"], string> = {
  sold: "Sold",
  listed: "Listed",
  not_listed: "Not listed",
};

/** Section / Row / Seats are stored apart; join them for display only. */
function seatLine(t: Ticket): string {
  return [t.section && `Sec ${t.section}`, t.seat_row && `Row ${t.seat_row}`, t.seats && `Seat ${t.seats}`]
    .filter(Boolean)
    .join(" · ");
}

export default function EventsPage() {
  const { tickets, loading, error, period, remove, setStatus, togglePaid, openEdit, openSell, copyRow } = useDash();

  // The period filter drives the whole page — table rows AND the summary — so a
  // "last month" view never shows a table for one window and totals for another.
  const shown = useMemo(() => filterByPeriod(tickets, period), [tickets, period]);

  const priced = shown.filter((t) => t.qty_sold > 0 && t.buy_price > 0);
  const totalProfit = priced.reduce((s, t) => s + realizedProfit(t), 0);
  const soldRows = shown.filter((t) => t.qty_sold > 0).length;
  const totalListed = shown.filter((t) => t.status === "listed").length;
  // Sold rows whose payout hasn't landed yet — the number still owed to you.
  const awaitingPayout = shown
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
        <div className="empty">No events in this period. Try a longer range.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th><th>Date</th><th>Location / Seat</th><th>Sold</th>
                <th>Status</th><th>Buy</th><th>Sell</th><th>Profit</th><th>%</th>
                <th title="Payout received in your bank account">Paid</th><th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const profit = realizedProfit(t);
                const pct = realizedRoi(t);
                const cls = profit >= 0 ? "profit-pos" : "profit-neg";
                const unsold = t.qty_sold === 0;
                const noCost = t.qty_sold > 0 && !t.buy_price;
                const noProfit = unsold || noCost;
                const seat = seatLine(t);
                return (
                  <tr key={t.id}>
                    <td>
                      <div className="event-name">
                        {t.needs_review && <span className="review-badge" title="Poller wasn't sure — check this">review</span>}
                        {t.event_name}
                      </div>
                      {t.order_ref && <div className="order-ref">#{t.order_ref}</div>}
                    </td>
                    <td className="nums">{t.event_date ?? "—"}</td>
                    <td className="venue-cell">
                      {t.location}
                      {seat && <><br /><span className="seat">{seat}</span></>}
                    </td>
                    <td>
                      <span className="nums">{t.qty_sold}/{t.qty_total}</span>
                      <div className="progress">
                        <div style={{ width: `${t.qty_total ? (t.qty_sold / t.qty_total) * 100 : 0}%` }} />
                      </div>
                    </td>
                    <td>
                      <select className="status-select" value={t.status}
                              onChange={(e) => setStatus(t, e.target.value as Ticket["status"])}>
                        {Object.entries(STATUS_LABEL).map(([k, v]) => (
                          <option key={k} value={k}>{v}</option>
                        ))}
                      </select>
                    </td>
                    <td className="nums">
                      {noCost ? (
                        <button className="cost-missing" onClick={() => openEdit(t)}
                                title="The poller never sets a buy price — add yours">
                          + buy price
                        </button>
                      ) : (
                        `${t.buy_price.toFixed(2)}`
                      )}
                    </td>
                    <td className="nums">{t.sell_price ? t.sell_price.toFixed(2) : "—"}</td>
                    <td className={"nums " + (noProfit ? "" : cls)}>
                      {noProfit ? <span className="unknown">—</span> : profit.toFixed(2)}
                    </td>
                    <td className={"nums " + (noProfit ? "" : cls)}>
                      {noProfit ? <span className="unknown">—</span> : `${pct.toFixed(1)}%`}
                    </td>
                    <td className="paid-cell">
                      {t.qty_sold > 0 ? (
                        <input type="checkbox" className="paid-check" checked={!!t.paid_out}
                               onChange={() => togglePaid(t)}
                               title={t.paid_out ? "Paid — money in the bank" : "Not paid yet"} />
                      ) : (
                        <span className="unknown">—</span>
                      )}
                    </td>
                    <td>
                      <div className="actions">
                        <button className="btn btn-sm btn-primary" onClick={() => openSell(t)}>Sell</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => openEdit(t)}>Edit</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => copyRow(t)}>Copy</button>
                        <button className="btn btn-sm btn-danger" onClick={() => remove(t.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
