"use client";

import { useMemo, useRef, useState } from "react";
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
  const {
    remove, setStatus, togglePaid, toggleFlag, openEdit, openSell, copyRow, openLink, save,
    removeMany, patchMany,
  } = useDash();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: 1 });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Anchor for shift-click, so a range can be selected the way every other
  // table on a computer does it.
  const anchor = useRef<string | null>(null);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const va = value(a, sort.key), vb = value(b, sort.key);
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return c * sort.dir;
    });
    return out;
  }, [rows, sort]);

  // A selection only ever means rows currently on screen. Searching, changing
  // the period, or deleting must not leave invisible rows armed for the next
  // bulk action — a delete that takes rows you can't see is unforgivable.
  const visible = useMemo(() => new Set(sorted.map((t) => t.id)), [sorted]);
  const selected = useMemo(() => sorted.filter((t) => picked.has(t.id)), [sorted, picked]);
  const selectedIds = selected.map((t) => t.id);
  const allPicked = sorted.length > 0 && selected.length === sorted.length;

  function toggleRow(id: string, shiftKey: boolean) {
    setPicked((prev) => {
      const next = new Set([...prev].filter((x) => visible.has(x)));
      // Shift-click fills in everything between the last click and this one.
      if (shiftKey && anchor.current && anchor.current !== id) {
        const order = sorted.map((t) => t.id);
        const a = order.indexOf(anchor.current), b = order.indexOf(id);
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          const add = !next.has(id);
          for (let i = lo; i <= hi; i++) add ? next.add(order[i]) : next.delete(order[i]);
          return next;
        }
      }
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    anchor.current = id;
  }

  const clear = () => { setPicked(new Set()); anchor.current = null; };

  async function bulk(run: () => Promise<void>) {
    await run();
    clear(); // a stale selection after an action is how the next one goes wrong
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }));
  }
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="th-sort" onClick={() => toggleSort(k)}>{children}{arrow(k)}</th>
  );

  return (
    <>
      {/* Only present once something is selected — an always-visible bar of
          destructive buttons is a hazard, not a feature. */}
      {selected.length > 0 && (
        <div className="bulk-bar">
          <span className="bulk-count">{selected.length} selected</span>
          <button className="btn btn-sm btn-ghost" onClick={() => bulk(async () =>
            patchMany(selectedIds, { paid_out: true }))}>Mark paid</button>
          <button className="btn btn-sm btn-ghost" onClick={() => bulk(async () =>
            patchMany(selectedIds, { paid_out: false }))}>Mark unpaid</button>
          <select className="status-select" value="" aria-label="Set status for the selected rows"
                  onChange={(e) => {
                    const v = e.target.value as Ticket["status"] | "";
                    if (v) bulk(async () => patchMany(selectedIds, { status: v }));
                    e.target.value = "";
                  }}>
            <option value="">Set status…</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {/* The imported rows carry no purchase date — it was never in the
              export — so the only way it gets in is by hand. Doing that one row
              at a time across 150 rows is why this is here: search for an
              event, select the lot, set the date once. */}
          <label className="bulk-date">
            <span>Bought</span>
            <input type="date" aria-label="Set purchase date for the selected rows"
                   onChange={(e) => {
                     const v = e.target.value;
                     if (v) bulk(async () => patchMany(selectedIds, { purchase_date: v }));
                     e.target.value = "";
                   }} />
          </label>
          {/* Clearing the review flag in bulk is the fast way out of a backlog
              of poller rows that have no purchase to link to. */}
          <button className="btn btn-sm btn-ghost" onClick={() => bulk(async () =>
            patchMany(selectedIds, { needs_review: false }))}>Clear review</button>
          <button className="btn btn-sm btn-danger" onClick={() => bulk(async () =>
            removeMany(selectedIds))}>Delete {selected.length}</button>
          <button className="btn btn-sm btn-ghost bulk-clear" onClick={clear}>Cancel</button>
        </div>
      )}

      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="pick-cell">
              <input type="checkbox" className="paid-check" checked={allPicked}
                     ref={(el) => {
                       // Indeterminate can only be set from JS, and it's what
                       // tells "some" apart from "none" at a glance.
                       if (el) el.indeterminate = selected.length > 0 && !allPicked;
                     }}
                     onChange={() => (allPicked ? clear() : setPicked(new Set(sorted.map((t) => t.id))))}
                     title={allPicked ? "Deselect all" : "Select all shown"} />
            </th>
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
            const isPicked = picked.has(t.id);
            return (
              <tr key={t.id}
                  className={[t.flagged ? "is-flagged" : "", isPicked ? "is-picked" : ""].filter(Boolean).join(" ") || undefined}>
                <td className="pick-cell">
                  <input type="checkbox" className="paid-check" checked={isPicked}
                         onChange={(e) => toggleRow(t.id, (e.nativeEvent as MouseEvent).shiftKey)}
                         aria-label={`Select ${t.event_name}`} />
                </td>
                <td>
                  <div className="event-name">
                    {t.needs_review && <span className="review-badge" title="Poller wasn't sure — check this">review</span>}
                    {t.flagged && (
                      <span className="flag-badge" title={t.flag_note ?? "Problem with this transaction"}>⚠ problem</span>
                    )}
                    {t.event_name}
                  </div>
                  {t.flagged && t.flag_note && <div className="flag-note">{t.flag_note}</div>}
                  {t.order_ref && <div className="order-ref">#{t.order_ref}</div>}
                </td>
                <td className="nums date-cell">{t.event_date ?? "—"}</td>
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
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => openLink(t)}
                                title="Merge this sale into an existing purchase">Link</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => save({ id: t.id, needs_review: false })}
                                title="No purchase to link — keep it as a standalone sale">No purchase</button>
                      </>
                    )}
                    <button className="btn btn-sm btn-primary" onClick={() => openSell(t)}>Sell</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(t)}>Edit</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => copyRow(t)}>Copy</button>
                    <button className={"btn btn-sm " + (t.flagged ? "btn-flag-on" : "btn-flag")}
                            onClick={() => toggleFlag(t)}
                            title={t.flagged ? "Clear the problem flag" : "Flag a problem with this transaction"}>⚠</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(t.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}
