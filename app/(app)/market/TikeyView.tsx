"use client";

import ChartTabs from "./ChartTabs";
import SalesHistory from "./SalesHistory";
import { ago, int, longDate, money, shortDate } from "./format";
import type { MarketView } from "./model";
import { Icon } from "./ui";

// One event, laid out like the sales tracker's own page: the header, the eight
// statistics, then the sales history beside the charts — so nothing has to be
// relearned — with the A.I analysis one click away in the top-right corner.
//
// The tiles colour their numbers the way the sales tracker does, because that
// is the page this one mirrors; at this size (26px, bold) every one of these
// hues clears 3:1 on the #161616 panel.

const TILE = { blue: "#4b93e8", green: "#3ecf8e", white: "#f2f2f2", orange: "#f0a93b", red: "#ef6b6b" };

export default function TikeyView({
  view, onAI, onRefresh, refreshing,
}: {
  view: MarketView;
  onAI: () => void;
  onRefresh: (() => void) | null;
  refreshing: boolean;
}) {
  const e = view.event;
  const s = view.stats;
  const cur = s.currency;
  const place = [e.city ? e.city.toUpperCase() : null, e.country].filter(Boolean).join(", ");

  const tiles: { value: string; label: string; hue: string; date?: boolean }[] = [
    { value: int(s.total_sales), label: "Total Sales", hue: TILE.blue },
    { value: int(s.total_tickets), label: "Total Tickets", hue: TILE.green },
    { value: money(s.average_price, cur), label: "Average Price", hue: TILE.white },
    { value: money(s.floor_price, cur), label: "Floor Price", hue: TILE.green },
    { value: s.sales_24h != null ? int(s.sales_24h) : view.features.velocity.tickets24hCounted ? `~${int(view.features.velocity.tickets24h)}` : "—", label: "24h Sales", hue: TILE.blue },
    { value: shortDate(s.first_sale), label: "First Sale", hue: TILE.white, date: true },
    { value: int(s.listings), label: "Number of Listings", hue: TILE.orange },
    { value: int(s.tickets_available), label: "Tickets Available", hue: TILE.red },
  ];

  return (
    <>
      <section className="tk-header">
        {e.imageUrl && <img className="tk-image" src={e.imageUrl} alt="" />}
        <div className="tk-title">
          <h2>
            {e.name}
            <a href={e.tikeyUrl} target="_blank" rel="noreferrer" className="tk-ext" title="Open on the sales tracker">{Icon.external}</a>
          </h2>
          <div className="tk-date">{e.dateText || longDate(e.date) || "date not read"}</div>
          {e.venue && <div className="tk-venue">{e.venue}</div>}
          {place && <div className="tk-venue">{place}</div>}
        </div>
        <div className="tk-actions">
          <button className="tk-ai" onClick={onAI}>
            {Icon.sparkle} <span>A.I analýza</span>
          </button>
          <div className="tk-actions-row">
            <span className="tk-read">read {ago(view.capturedAt)}</span>
            <button className="btn btn-ghost btn-sm" disabled={!onRefresh || refreshing} onClick={() => onRefresh?.()}>
              {Icon.refresh} {refreshing ? "Reading…" : "Refresh"}
            </button>
          </div>
        </div>
      </section>

      <h3 className="tk-h">Sales Statistics</h3>
      <div className="tk-tiles">
        {tiles.map((t) => (
          <div key={t.label} className={"tk-tile" + (t.date ? " is-date" : "")}>
            <div className="tk-tile-value" style={{ color: t.hue }}>{t.value}</div>
            <div className="tk-tile-label">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="tk-split">
        <SalesHistory
          sales={view.sales}
          source={view.salesSource}
          totalSales={s.total_sales}
          currency={cur}
          capturedAt={view.capturedAt}
        />
        <ChartTabs view={view} />
      </div>
    </>
  );
}
