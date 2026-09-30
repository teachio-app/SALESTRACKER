"use client";

import { useMemo } from "react";
import { ago, int, longDate, money, pct, when, type MarketEvent } from "./format";
import { HUE, PacePill, SellThroughBar } from "./ui";

// Every event read so far. Upcoming first, soonest at the top; finished events
// sink to the bottom, dimmed, instead of disappearing — their history is still
// worth having.

export default function EventList({ events, onOpen }: { events: MarketEvent[]; onOpen: (id: string) => void }) {
  const rows = useMemo(() => {
    const up = events.filter((e) => (e.summary.daysToEvent ?? 0) >= 0);
    const past = events.filter((e) => (e.summary.daysToEvent ?? 0) < 0);
    const byDate = (a: MarketEvent, b: MarketEvent) => (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999");
    return [...up.sort(byDate), ...past.sort(byDate).reverse()];
  }, [events]);

  return (
    <>
      {/* On a phone an eight-column table either scrolls sideways or wraps every
          event name onto five lines. Cards carry the same figures in a shape
          that fits; CSS shows one or the other. */}
      <div className="market-cards">
        {rows.map((e) => {
          const s = e.summary;
          const L = s.latest;
          const d = s.derived;
          return (
            <button key={e.id} className={"market-card" + ((s.daysToEvent ?? 0) < 0 ? " is-past" : "")} onClick={() => onOpen(e.id)}>
              <div className="market-card-head">
                <span className="market-name">{e.name}</span>
                <span className={"market-where" + (s.stale ? " is-stale" : "")}>{ago(e.last_captured_at)}</span>
              </div>
              <div className="market-where">
                {[e.event_date ? longDate(e.event_date) : "date not read", when(s.daysToEvent), e.city].filter(Boolean).join(" · ")}
              </div>
              <div className="market-card-stats">
                <span><i style={{ background: HUE.sold }} /><em>Sold</em> {int(L?.total_tickets)}</span>
                <span><i style={{ background: HUE.day }} /><em>24h</em> {day24(d)} <PacePill momentum={d.momentum} compact /></span>
                <span><i style={{ background: HUE.floor }} /><em>Floor</em> {money(L?.floor_price, s.currency)}</span>
                <span><i style={{ background: HUE.available }} /><em>Avail</em> {int(L?.tickets_available)}</span>
              </div>
              <SellThroughBar sold={L?.total_tickets ?? null} available={L?.tickets_available ?? null} thin />
            </button>
          );
        })}
      </div>

      <div className="table-wrap market-table-wrap">
        <table className="table market-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Date</th>
              <th className="amount-col"><Key hue={HUE.sold} />Sold · all time</th>
              <th className="amount-col"><Key hue={HUE.day} />Last 24h</th>
              <th className="amount-col"><Key hue={HUE.floor} />Floor / avg</th>
              <th className="amount-col"><Key hue={HUE.available} />Available</th>
              <th>Sell-through</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const s = e.summary;
              const L = s.latest;
              const d = s.derived;
              const past = (s.daysToEvent ?? 0) < 0;
              return (
                <tr key={e.id} className={"market-row" + (past ? " is-past" : "")} onClick={() => onOpen(e.id)}
                    tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") onOpen(e.id); }}>
                  <td>
                    <div className="market-name">{e.name}</div>
                    <div className="market-where">{[e.venue, e.city].filter(Boolean).join(" · ") || "venue not read"}</div>
                  </td>
                  <td className="date-cell">
                    <div>{e.event_date ? longDate(e.event_date) : <span className="is-stale">not read</span>}</div>
                    {s.daysToEvent != null && (
                      <span className={"count-chip" + (past ? " is-past" : "")}>{when(s.daysToEvent)}</span>
                    )}
                  </td>
                  <td className="amount-col nums">
                    <strong>{int(L?.total_tickets)}</strong> <span className="market-where">tix</span>
                    <div className="market-where">{int(L?.total_sales)} sales</div>
                  </td>
                  <td className="amount-col nums">
                    <strong>{day24(d)}</strong> <span className="market-where">sales</span>
                    <div><PacePill momentum={d.momentum} compact /></div>
                  </td>
                  <td className="amount-col nums">
                    <strong>{money(L?.floor_price, s.currency)}</strong>
                    <div className="market-where">{money(L?.average_price, s.currency)}</div>
                  </td>
                  <td className="amount-col nums">
                    <strong>{int(L?.tickets_available)}</strong>
                    <div className="market-where">{L?.listings != null ? `${int(L.listings)} listings` : ""}</div>
                  </td>
                  <td className="through-cell">
                    <SellThroughBar sold={L?.total_tickets ?? null} available={L?.tickets_available ?? null} thin />
                    <div className="market-where">{pct(d.sellThrough)} sold</div>
                  </td>
                  <td className={"date-cell" + (s.stale ? " is-stale" : "")}>
                    {ago(e.last_captured_at)}
                    <div className="market-where">{e.captures} read{e.captures === 1 ? "" : "s"}</div>
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

/**
 * Sales in the last 24h as the list shows it: the figure when known, "≥ N" when
 * only the recorded sales could be counted and they don't reach back the whole
 * day, "—" when there is nothing to go on.
 */
function day24(d: MarketEvent["summary"]["derived"]): string {
  if (d.sales24h != null) return int(d.sales24h);
  if (d.captured24h && d.captured24h.sales > 0) return `≥ ${int(d.captured24h.sales)}`;
  return "—";
}

/** A short colour key in a column header, tying the column to its colour elsewhere on the page. */
function Key({ hue }: { hue: string }) {
  return <span className="col-key" style={{ background: hue }} aria-hidden />;
}
