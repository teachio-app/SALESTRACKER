"use client";

import { useMemo, useState } from "react";
import { type Ticket, realizedProfit, realizedRoi } from "@/lib/supabase";
import { useDash } from "./DashContext";

const STATUS_LABEL: Record<Ticket["status"], string> = {
  sold: "Sold",
  listed: "Listed",
  not_listed: "Not listed",
};

function seatLine(t: Ticket): string {
  return [t.section && `Sec ${t.section}`, t.seat_row && `Row ${t.seat_row}`, t.seats && `Seat ${t.seats}`]
    .filter(Boolean)
    .join(" · ");
}

type SortKey = "event" | "date" | "sold" | "buy" | "sell" | "profit" | "pct" | "paid";

function value(t: Ticket, key: SortKey): number | string {
  switch (key) {
    case "event": return (t.event_name ?? "").toLowerCase();
    case "date": return t.event_date ?? "";
    case "sold": return t.qty_total ? t.qty_sold / t.qty_total : 0;
    case "buy": return t.buy_price;
    case "sell": return t.sell_price;
    case "profit": return realizedProfit(t);
    case "pct": return realizedRoi(t);
    case "paid": return Number(t.paid_out);
  }
}

export default function TicketsTable({ rows, showLink = false }: { rows: Ticket[]; showLink?: boolean }) {
  const { remove, setStatus, togglePaid, openEdit, openSell, copyRow, openLink } = useDash();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: 1 });

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const va = value(a, sort.key), vb = value(b, sort.key);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return c * sort.dir;
    });
    return out;
  }, [rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="th-sort" onClick={() => toggleSort(k)}>{children}{arrow(k)}</th>
  );

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <Th k="event">Event</Th>
            <Th k="date">Date</Th>
            <th>Location / Seat</th>
            <Th k="sold">Sold</Th>
            <th>Status</th>
            <Th k="buy">Buy</Th>
            <Th k="sell">Sell</Th>
            <Th k="profit">Profit</Th>
            <Th k="pct">%</Th>
            <Th k="paid">Paid</Th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
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
                            title="The poller never sets a buy price — add yours">+ buy price</button>
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
                    {showLink && t.needs_review && (
                      <button className="btn btn-sm btn-primary" onClick={() => openLink(t)}
                              title="Merge this sale into an existing purchase">Link</button>
                    )}
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
  );
}
