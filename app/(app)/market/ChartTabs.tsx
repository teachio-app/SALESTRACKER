"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MarketChart from "./MarketChart";
import { int, money } from "./format";
import type { MarketView } from "./model";

// The chart panel beside the sales table, with the sales tracker's own tabs.
// Everything is drawn from this read's data: the daily series from the full
// sales history (or the page's chart), prices from sales with exact times.
//
// Hues are the validated dark-mode steps used across the Market page: daily
// tickets blue, daily average teal against the 7-day average violet (CVD ΔE
// 17.3 on the #161616 panel), sections violet, the distribution blue.

const BLUE = "#3987e5";
const TEAL = "#199e70";
const VIOLET = "#9085e9";

const TABS = ["Quantity Sold", "Average Price", "Sections Analytics", "Distribution"] as const;
type Tab = (typeof TABS)[number];

export default function ChartTabs({ view }: { view: MarketView }) {
  const [tab, setTab] = useState<Tab>("Quantity Sold");
  return (
    <div className="tk-card tk-charts">
      <div className="tk-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={"tk-tab" + (tab === t ? " is-on" : "")} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="tk-tab-body">
        {tab === "Quantity Sold" && <QuantitySold view={view} />}
        {tab === "Average Price" && <AveragePrice view={view} />}
        {tab === "Sections Analytics" && <Sections view={view} />}
        {tab === "Distribution" && <Distribution view={view} />}
      </div>
    </div>
  );
}

function Missing({ what }: { what: string }) {
  return (
    <div className="tk-chart-missing">
      {what} needs the full sales history, and this read only had the rows on the tracker’s first page.
      <span> Reload the extension (v3) and press Refresh — it reads the page’s own data.</span>
    </div>
  );
}

function QuantitySold({ view }: { view: MarketView }) {
  const d = view.daily;
  if (!d || d.length < 2) return <Missing what="The daily chart" />;
  return (
    <>
      <div className="tk-chart-title">Daily Ticket Sales</div>
      <div className="tk-chart-sub">
        Number of tickets sold per day · {view.dailySource === "sales" ? "counted from every sale" : "from the tracker’s chart"}
      </div>
      <MarketChart
        title="Tickets sold per day"
        sub=""
        at={d.map((p) => `${p.day}T12:00:00.000Z`)}
        series={[{ key: "t", label: "Tickets", color: BLUE, values: d.map((p) => p.tickets) }]}
        format={(n) => int(n)}
        dots
        bare
      />
    </>
  );
}

function AveragePrice({ view }: { view: MarketView }) {
  const series = useMemo(() => {
    if (view.salesSource !== "full") return null;
    const by = new Map<string, { sum: number; n: number }>();
    for (const s of view.sales) {
      if (!s.at || s.price == null || s.price <= 0) continue;
      const day = s.at.slice(0, 10);
      const q = s.qty && s.qty > 0 ? s.qty : 1;
      const e = by.get(day) ?? { sum: 0, n: 0 };
      e.sum += s.price * q;
      e.n += q;
      by.set(day, e);
    }
    const days = [...by.keys()].sort();
    if (days.length < 2) return null;
    const daily = days.map((d) => by.get(d)!.sum / by.get(d)!.n);
    // A 7-day window, weighted by tickets, so a quiet day's one sale doesn't
    // swing the line as much as a busy day's forty.
    const rolling = days.map((d, i) => {
      let sum = 0;
      let n = 0;
      const start = Date.parse(`${d}T00:00:00Z`) - 6 * 86_400_000;
      for (let j = i; j >= 0 && Date.parse(`${days[j]}T00:00:00Z`) >= start; j--) { sum += by.get(days[j])!.sum; n += by.get(days[j])!.n; }
      return n ? sum / n : null;
    });
    return { at: days.map((d) => `${d}T12:00:00.000Z`), daily, rolling };
  }, [view]);

  if (!series) return <Missing what="The price chart" />;
  const cur = view.stats.currency;
  return (
    <>
      <div className="tk-chart-title">Average Price</div>
      <div className="tk-chart-sub">Per ticket, per day · {cur}</div>
      <MarketChart
        title="Average price per ticket"
        sub=""
        at={series.at}
        series={[
          { key: "d", label: "Daily", color: TEAL, values: series.daily },
          { key: "r", label: "7-day", color: VIOLET, values: series.rolling },
        ]}
        format={(n) => money(n, cur, 0)}
        bare
      />
    </>
  );
}

function Sections({ view }: { view: MarketView }) {
  const s = view.features.sections;
  if (!s.length) return <div className="tk-chart-missing">No sections in this read.</div>;
  const max = Math.max(...s.map((x) => x.tickets), 1);
  const cur = view.stats.currency;
  return (
    <>
      <div className="tk-chart-title">Sections Analytics</div>
      <div className="tk-chart-sub">
        Tickets sold by section · median price per ticket{view.salesSource === "screen" ? " · first page only" : ""}
      </div>
      <div className="tk-bars">
        {s.map((x) => (
          <div key={x.section} className="tk-bar-row" title={`${x.section}: ${x.tickets} tickets, ${x.share} % of all`}>
            <span className="tk-bar-label">{x.section}</span>
            <span className="tk-bar-track">
              <span className="tk-bar-fill" style={{ width: `${(x.tickets / max) * 100}%`, background: VIOLET }} />
            </span>
            <span className="tk-bar-value">
              <strong>{int(x.tickets)}</strong> tix · {money(x.median, cur, 0)}
              {x.momentum != null && (
                <span className={x.momentum >= 1.15 ? "tk-up" : x.momentum <= 0.85 ? "tk-down" : "tk-flat"}>
                  {" "}{x.momentum >= 1.15 ? "▲" : x.momentum <= 0.85 ? "▼" : "●"} {x.momentum}×
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {view.salesSource === "full" && (
        <div className="tk-chart-foot">▲▼ = the section’s share of the last 7 days against its share overall.</div>
      )}
    </>
  );
}

/** Price histogram, one column per band, per-ticket prices. */
function Distribution({ view }: { view: MarketView }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(560);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const bins = useMemo(() => {
    const prices: number[] = [];
    for (const s of view.sales) {
      if (s.price == null || s.price <= 0) continue;
      const q = s.qty && s.qty > 0 ? Math.min(s.qty, 50) : 1;
      for (let i = 0; i < q; i++) prices.push(s.price);
    }
    if (prices.length < 5) return null;
    prices.sort((a, b) => a - b);
    // The middle 96 %, so one €2 junk sale or one €9,000 box doesn't flatten the rest.
    const lo = prices[Math.floor(prices.length * 0.02)];
    const hi = prices[Math.ceil(prices.length * 0.98) - 1];
    const raw = (hi - lo) / 14 || 1;
    const step = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => s >= raw) ?? raw;
    const start = Math.floor(lo / step) * step;
    const n = Math.max(1, Math.ceil((hi - start) / step));
    const counts = new Array(n).fill(0);
    for (const p of prices) {
      if (p < start || p > start + n * step) continue;
      counts[Math.min(n - 1, Math.floor((p - start) / step))]++;
    }
    return { start, step, counts, total: prices.length, median: prices[Math.floor(prices.length / 2)] };
  }, [view]);

  if (!bins) return <div className="tk-chart-missing">Not enough priced sales to draw a distribution.</div>;
  const cur = view.stats.currency;
  const H = 230;
  const PAD = { top: 14, right: 12, bottom: 28, left: 40 };
  const pw = W - PAD.left - PAD.right;
  const ph = H - PAD.top - PAD.bottom;
  const max = Math.max(...bins.counts, 1);
  const band = pw / bins.counts.length;
  const bw = Math.min(24, band - 3);
  const y = (v: number) => PAD.top + ph - (v / max) * ph;
  const xOf = (price: number) => PAD.left + ((price - bins.start) / (bins.step * bins.counts.length)) * pw;
  const labelEvery = Math.ceil(bins.counts.length / (W < 480 ? 4 : 7));

  return (
    <>
      <div className="tk-chart-title">Distribution</div>
      <div className="tk-chart-sub">
        Tickets sold by price band · {int(bins.total)} tickets{view.salesSource === "screen" ? " · first page only" : ""}
      </div>
      <div ref={box}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
             aria-label={`Price distribution; median ${money(bins.median, cur, 0)}`} onMouseLeave={() => setHover(null)}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke="#242424" />
              <text x={PAD.left - 6} y={y(max * f)} dy="0.32em" textAnchor="end" fill="#6f6f6f" fontSize={11} className="tick">{Math.round(max * f)}</text>
            </g>
          ))}
          {bins.counts.map((c, i) => {
            const h = Math.max(c ? 2 : 0, y(0) - y(c));
            const bx = PAD.left + i * band + (band - bw) / 2;
            const r = Math.min(4, bw / 2, h);
            return (
              <g key={i} onMouseEnter={() => setHover(i)}>
                <rect x={PAD.left + i * band} y={PAD.top} width={band} height={ph} fill="transparent" />
                {h > 0 && (
                  <path fill={BLUE} opacity={hover == null || hover === i ? 1 : 0.45}
                        d={`M${bx},${y(0)} L${bx},${y(0) - h + r} Q${bx},${y(0) - h} ${bx + r},${y(0) - h} L${bx + bw - r},${y(0) - h} Q${bx + bw},${y(0) - h} ${bx + bw},${y(0) - h + r} L${bx + bw},${y(0)} Z`} />
                )}
                {i % labelEvery === 0 && (
                  <text x={PAD.left + i * band} y={H - 9} fill="#6f6f6f" fontSize={11} className="tick">{money(bins.start + i * bins.step, cur, 0)}</text>
                )}
              </g>
            );
          })}
          <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#3d3d3d" />
          {/* The median, marked and labelled in ink. */}
          <line x1={xOf(bins.median)} x2={xOf(bins.median)} y1={PAD.top} y2={y(0)} stroke="#ededed" strokeDasharray="0" strokeWidth={1} opacity={0.5} />
          <text x={xOf(bins.median) + 4} y={PAD.top + 10} fill="#ededed" fontSize={11}>median {money(bins.median, cur, 0)}</text>
          {hover != null && (
            <g pointerEvents="none">
              <rect x={Math.min(W - 150, Math.max(4, PAD.left + hover * band - 40))} y={PAD.top + 16} width={146} height={38} rx={6} fill="#0d0d0d" stroke="#242424" />
              <text x={Math.min(W - 150, Math.max(4, PAD.left + hover * band - 40)) + 10} y={PAD.top + 32} fill="#ededed" fontSize={12} fontWeight={600} className="tick">
                {int(bins.counts[hover])} tickets
              </text>
              <text x={Math.min(W - 150, Math.max(4, PAD.left + hover * band - 40)) + 10} y={PAD.top + 47} fill="#6f6f6f" fontSize={11} className="tick">
                {money(bins.start + hover * bins.step, cur, 0)} – {money(bins.start + (hover + 1) * bins.step, cur, 0)}
              </text>
            </g>
          )}
        </svg>
      </div>
    </>
  );
}
