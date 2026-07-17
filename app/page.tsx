"use client";

import { useEffect, useState } from "react";
import { type Ticket, realizedProfit, realizedRoi } from "@/lib/supabase";
import ProfitChart from "./ProfitChart";
import PurchaseModal, { EMPTY_PURCHASE } from "./PurchaseModal";
import SellModal from "./SellModal";

// Change this one string to rename the app. It was "RETAIL.CO", which came from
// the tool this dashboard was modelled on — not from here.
const APP_NAME = "TICKETDESK";

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

export default function Dashboard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Ticket> | null>(null);
  const [selling, setSelling] = useState<Ticket | null>(null);

  // The API answers with an array on success and { error } on failure. Feeding
  // that object straight into state used to blank the whole page on the next
  // render (`{}.map is not a function`) — a Supabase hiccup became a white
  // screen with nothing to read. Show what went wrong instead.
  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/tickets");
      const body = await res.json();
      if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setTickets(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function save(t: Partial<Ticket>) {
    const method = t.id ? "PATCH" : "POST";
    await fetch("/api/tickets", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t),
    });
    setEditing(null);
    setSelling(null);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this row?")) return;
    await fetch("/api/tickets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  }

  async function setStatus(t: Ticket, status: Ticket["status"]) {
    await save({ id: t.id, status });
  }

  function copyRow(t: Ticket) {
    const { id, created_at, updated_at, profit, external_id, sold_at, ...rest } = t;
    setEditing({ ...rest, event_name: t.event_name + " (copy)" });
  }

  // A row contributes realized profit once it has sold tickets AND a known cost.
  // Keyed on qty_sold, not status, so partially-sold rows count their sold part.
  // buy_price === 0 means the cost is still unknown (poller rows) — excluded.
  const priced = tickets.filter((t) => t.qty_sold > 0 && t.buy_price > 0);
  const totalProfit = priced.reduce((s, t) => s + realizedProfit(t), 0);
  const soldRows = tickets.filter((t) => t.qty_sold > 0).length;
  const totalListed = tickets.filter((t) => t.status === "listed").length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">{APP_NAME}</div>
        <button className="nav-btn is-active">Dashboard</button>
        <button className="nav-btn nav-add" onClick={() => setEditing({ ...EMPTY_PURCHASE })}>
          + Add purchase
        </button>
        {/* The SALESTRACKER group (Hype Monitor / All Events / Favorites) was
            dropped — carried over from the reference tool, unused here. Tools
            below are still placeholders and wired to nothing. */}
        <div className="nav-section">Tools</div>
        <button className="nav-btn">Invoice Gen</button>
        <button className="nav-btn">OrderAlert</button>
      </aside>

      <main className="main">
        <div className="toolbar">
          <h1>All Events</h1>
          <div className="summary">
            <div className="stat"><div className="label">Sold</div><div className="value">{soldRows}</div></div>
            <div className="stat"><div className="label">Listed</div><div className="value">{totalListed}</div></div>
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

        {!loading && tickets.length > 0 && <ProfitChart tickets={tickets} />}

        {loading ? (
          <div className="empty">Loading…</div>
        ) : error ? null : tickets.length === 0 ? (
          <div className="empty">No events yet. Add a purchase, or wait for a sale email to land.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th><th>Date</th><th>Location / Seat</th><th>Sold</th>
                  <th>Status</th><th>Buy</th><th>Sell</th><th>Profit</th><th>%</th><th></th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const profit = realizedProfit(t);
                  const pct = realizedRoi(t);
                  const cls = profit >= 0 ? "profit-pos" : "profit-neg";
                  // Nothing sold yet → nothing realized, so no profit to show
                  // (unsold cost is inventory, not a loss).
                  const unsold = t.qty_sold === 0;
                  // Sold something, but cost still unknown (poller rows).
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
                          <button className="cost-missing" onClick={() => setEditing({ ...t })}
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
                      <td>
                        <div className="actions">
                          <button className="btn btn-sm btn-primary" onClick={() => setSelling(t)}>Sell</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ ...t })}>Edit</button>
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
      </main>

      {editing && <PurchaseModal ticket={editing} onSave={save} onClose={() => setEditing(null)} />}
      {selling && <SellModal ticket={selling} onSave={save} onClose={() => setSelling(null)} />}
    </div>
  );
}
