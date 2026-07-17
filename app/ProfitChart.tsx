"use client";

import { useMemo, useState } from "react";
import { type Ticket, realizedProfit } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────
// Two charts, never one with two y-axes: per-month profit and its running
// total are different scales and belong on separate plots.
//
//   1. Profit by month  — diverging columns. Sign is carried by POSITION
//      (above/below the zero baseline) first and color second, so the chart
//      still reads under any colour-vision deficiency.
//   2. Cumulative profit — single line + area wash. No legend: one series,
//      the title names it.
//
// Palette validated against this app's own panel surface (#161616), not a
// default one: blue #3987e5 / red #e66767 — worst-pair CVD ΔE 19.2 (protan),
// normal-vision ΔE 29.0, both ≥3:1 against the panel. Re-run
// `validate_palette.js "#3987e5,#e66767" --mode dark --surface "#161616"`
// if the surface ever moves again.
// ─────────────────────────────────────────────────────────────

const POS = "#3987e5";
const NEG = "#e66767";
const SURFACE = "#161616";   // must track --panel; the marker ring is painted with it
const TOOLTIP_BG = "#0d0d0d"; // --bg
const GRID = "#262626";       // --border
const BASELINE = "#3d3d3d";
const MUTED = "#6f6f6f";      // --text-3
const INK = "#ededed";        // --text

type Bucket = { key: string; label: string; profit: number; count: number; cum: number };

/** The sale's own date — falls back to row creation for hand-typed rows. */
function saleDate(t: Ticket): Date {
  return new Date(t.sold_at ?? t.created_at);
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[+m - 1]} ${y.slice(2)}`;
}

/**
 * Sold rows with a known cost, bucketed by month, gap-filled so the x-axis is
 * real time.
 *
 * Rows without a buy price are excluded rather than plotted with a warning. A
 * sale whose cost we don't know doesn't have an overstated profit — it has no
 * known profit at all, and charting its payout as profit answers the question
 * ("how am I doing?") with a number that is simply the wrong quantity.
 */
function bucketByMonth(tickets: Ticket[]): Bucket[] {
  // Any row with sold tickets and a known cost — includes partially-sold rows,
  // whose realized profit counts only the part that sold.
  const sold = tickets.filter((t) => t.qty_sold > 0 && t.buy_price > 0);
  if (sold.length === 0) return [];

  const sums = new Map<string, { profit: number; count: number }>();
  for (const t of sold) {
    const k = monthKey(saleDate(t));
    const cur = sums.get(k) ?? { profit: 0, count: 0 };
    cur.profit += realizedProfit(t);
    cur.count += 1;
    sums.set(k, cur);
  }

  // Fill empty months so a gap in trading reads as a gap, not a missing column.
  const keys = [...sums.keys()].sort();
  const [fy, fm] = keys[0].split("-").map(Number);
  const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
  const out: Bucket[] = [];
  let cum = 0;
  for (let y = fy, m = fm; y < ly || (y === ly && m <= lm); m === 12 ? (m = 1, y++) : m++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    const hit = sums.get(k) ?? { profit: 0, count: 0 };
    cum += hit.profit;
    out.push({ key: k, label: monthLabel(k), profit: hit.profit, count: hit.count, cum });
  }
  return out;
}

/** Bar with a 4px rounded data-end and a square foot on the baseline. */
function barPath(x: number, y: number, w: number, h: number, up: boolean): string {
  const r = Math.min(4, w / 2, h);
  if (h <= 0.5) return `M${x},${y} h${w}`; // a ~zero month: hairline, not a blob
  return up
    ? `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
    : `M${x},${y} L${x},${y + h - r} Q${x},${y + h} ${x + r},${y + h} L${x + w - r},${y + h} Q${x + w},${y + h} ${x + w},${y + h - r} L${x + w},${y} Z`;
}

function money(n: number): string {
  const a = Math.abs(n);
  const s = a >= 10000 ? `${(a / 1000).toFixed(1)}k` : a.toFixed(0);
  return `${n < 0 ? "−" : ""}${s}`;
}

/** Clean axis ticks over a domain that always includes zero. */
function ticks(min: number, max: number, n = 4): number[] {
  const span = max - min || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const W = 560;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 26, left: 46 };

export default function ProfitChart({ tickets }: { tickets: Ticket[] }) {
  const data = useMemo(() => bucketByMonth(tickets), [tickets]);
  const [hover, setHover] = useState<{ i: number; chart: "bar" | "line" } | null>(null);

  // The poller fills in the sell side only, by design — buy prices are typed in
  // by hand. Those rows are held out of the maths above; name them here so the
  // omission is visible instead of silent.
  const awaitingCost = tickets.filter((t) => t.qty_sold > 0 && !t.buy_price).length;
  const pending = awaitingCost > 0 && (
    <div className="chart-notice">
      <strong>{awaitingCost}</strong> sold {awaitingCost === 1 ? "row has" : "rows have"} no buy price yet, so
      {awaitingCost === 1 ? " it is" : " they are"} left out of these charts — without a cost there is no
      profit to plot, and charting the payout instead would just be revenue in a green bar.
      Add the buy price and {awaitingCost === 1 ? "it appears" : "they appear"} here.
    </div>
  );

  if (data.length === 0) {
    return (
      <div className="charts">
        {pending}
        <div className="chart-card chart-empty">
          {awaitingCost > 0
            ? "Nothing to chart yet — every sold row is still waiting for its buy price."
            : "No sales yet — the chart starts once a row is marked Sold."}
        </div>
      </div>
    );
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // ── Chart 1: profit by month ──
  const pMin = Math.min(0, ...data.map((d) => d.profit));
  const pMax = Math.max(0, ...data.map((d) => d.profit));
  const pTicks = ticks(pMin, pMax);
  const pLo = Math.min(pMin, pTicks[0]);
  const pHi = Math.max(pMax, pTicks[pTicks.length - 1]);
  const py = (v: number) => PAD.top + plotH - ((v - pLo) / (pHi - pLo || 1)) * plotH;
  const zeroY = py(0);

  const band = plotW / data.length;
  const barW = Math.min(24, band - 2); // 2px surface gap between neighbours

  // ── Chart 2: cumulative ──
  const cMin = Math.min(0, ...data.map((d) => d.cum));
  const cMax = Math.max(0, ...data.map((d) => d.cum));
  const cTicks = ticks(cMin, cMax);
  const cLo = Math.min(cMin, cTicks[0]);
  const cHi = Math.max(cMax, cTicks[cTicks.length - 1]);
  const cy = (v: number) => PAD.top + plotH - ((v - cLo) / (cHi - cLo || 1)) * plotH;
  const cx = (i: number) => PAD.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${cx(i)},${cy(d.cum)}`).join(" ");
  const area = `${line} L${cx(data.length - 1)},${cy(cLo)} L${cx(0)},${cy(cLo)} Z`;
  const last = data[data.length - 1];
  const lineColor = last.cum >= 0 ? POS : NEG;

  // Label every month only when they fit; otherwise thin them out.
  const stride = Math.ceil(data.length / 6);

  return (
    <div className="charts">
      {pending}

      {/* ── Profit by month ── */}
      <figure className="chart-card">
        <figcaption>
          <span className="chart-title">Profit by month</span>
          <span className="chart-sub">EUR · sold rows only</span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
             aria-label={`Profit by month. ${data.map((d) => `${d.label}: ${d.profit.toFixed(0)} EUR`).join(", ")}`}>
          {pTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={py(v)} y2={py(v)}
                    stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={py(v)} dy="0.32em" textAnchor="end"
                    fill={MUTED} fontSize={10} className="tick">{money(v)}</text>
            </g>
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke={BASELINE} strokeWidth={1} />

          {data.map((d, i) => {
            const x = PAD.left + i * band + (band - barW) / 2;
            const up = d.profit >= 0;
            const h = Math.abs(py(d.profit) - zeroY);
            const y = up ? zeroY - h : zeroY;
            const on = hover?.chart === "bar" && hover.i === i;
            return (
              <g key={d.key} onMouseEnter={() => setHover({ i, chart: "bar" })}
                 onMouseLeave={() => setHover(null)}>
                <rect x={PAD.left + i * band} y={PAD.top} width={band} height={plotH} fill="transparent" />
                <path d={barPath(x, y, barW, h, up)} fill={up ? POS : NEG}
                      opacity={on || !hover || hover.chart !== "bar" ? 1 : 0.45} />
              </g>
            );
          })}

          {data.map((d, i) =>
            i % stride === 0 ? (
              <text key={d.key} x={PAD.left + i * band + band / 2} y={H - 8} textAnchor="middle"
                    fill={MUTED} fontSize={10} className="tick">{d.label}</text>
            ) : null
          )}

          {hover?.chart === "bar" && (
            <Tooltip x={PAD.left + hover.i * band + band / 2} y={PAD.top}
                     title={data[hover.i].label}
                     lines={[
                       `${data[hover.i].profit >= 0 ? "+" : "−"}${Math.abs(data[hover.i].profit).toFixed(2)} EUR`,
                       `${data[hover.i].count} sale${data[hover.i].count === 1 ? "" : "s"}`,
                     ]} />
          )}
        </svg>
      </figure>

      {/* ── Cumulative ── */}
      <figure className="chart-card">
        <figcaption>
          <span className="chart-title">Cumulative profit</span>
          <span className="chart-sub">EUR · running total</span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" role="img"
             aria-label={`Cumulative profit. Latest ${last.cum.toFixed(0)} EUR after ${data.length} months.`}>
          {cTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={cy(v)} y2={cy(v)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={cy(v)} dy="0.32em" textAnchor="end"
                    fill={MUTED} fontSize={10} className="tick">{money(v)}</text>
            </g>
          ))}
          {cLo < 0 && cHi > 0 && (
            <line x1={PAD.left} x2={W - PAD.right} y1={cy(0)} y2={cy(0)} stroke={BASELINE} strokeWidth={1} />
          )}

          <path d={area} fill={lineColor} opacity={0.1} />
          <path d={line} fill="none" stroke={lineColor} strokeWidth={2}
                strokeLinejoin="round" strokeLinecap="round" />

          {/* End marker: 2px surface ring keeps it legible over the line. */}
          <circle cx={cx(data.length - 1)} cy={cy(last.cum)} r={5}
                  fill={lineColor} stroke={SURFACE} strokeWidth={2} />

          {/* Hover bands, clamped to the plot: points sit ON the edges, so a
              raw half-band around the first/last one hangs outside the frame. */}
          {data.map((d, i) => {
            const x0 = Math.max(PAD.left, cx(i) - band / 2);
            const x1 = Math.min(W - PAD.right, cx(i) + band / 2);
            return (
              <rect key={d.key} x={x0} y={PAD.top} width={x1 - x0} height={plotH} fill="transparent"
                    onMouseEnter={() => setHover({ i, chart: "line" })} onMouseLeave={() => setHover(null)} />
            );
          })}
          {hover?.chart === "line" && (
            <>
              <line x1={cx(hover.i)} x2={cx(hover.i)} y1={PAD.top} y2={PAD.top + plotH}
                    stroke={MUTED} strokeWidth={1} opacity={0.5} />
              <circle cx={cx(hover.i)} cy={cy(data[hover.i].cum)} r={5}
                      fill={lineColor} stroke={SURFACE} strokeWidth={2} />
              <Tooltip x={cx(hover.i)} y={PAD.top}
                       title={data[hover.i].label}
                       lines={[`${data[hover.i].cum.toFixed(2)} EUR total`]} />
            </>
          )}

          {data.map((d, i) =>
            i % stride === 0 ? (
              <text key={d.key} x={cx(i)} y={H - 8} textAnchor="middle"
                    fill={MUTED} fontSize={10} className="tick">{d.label}</text>
            ) : null
          )}
        </svg>
      </figure>
    </div>
  );
}

/** Tooltip drawn in SVG so it can't be clipped by the plot area. */
function Tooltip({ x, y, title, lines }: { x: number; y: number; title: string; lines: string[] }) {
  const w = 108;
  const h = 18 + lines.length * 14;
  const lx = Math.min(Math.max(x - w / 2, 4), W - w - 4); // keep it inside the frame
  return (
    <g pointerEvents="none">
      <rect x={lx} y={y} width={w} height={h} rx={6} fill={TOOLTIP_BG} stroke={GRID} strokeWidth={1} />
      <text x={lx + 8} y={y + 14} fill={INK} fontSize={11} fontWeight={600}>{title}</text>
      {lines.map((l, i) => (
        <text key={i} x={lx + 8} y={y + 28 + i * 14} fill={MUTED} fontSize={10.5} className="tick">{l}</text>
      ))}
    </g>
  );
}
