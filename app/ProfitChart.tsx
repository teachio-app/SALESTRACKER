"use client";

import { useMemo, useState } from "react";
import { type Ticket, realizedProfit, realizedCost } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────
// A small dashboard, not two loose charts:
//   • a KPI row — the headline numbers, read at a glance;
//   • a cumulative curve — how the running total climbs over time (the hero);
//   • profit by month — where each month landed.
// Never one plot with two y-scales: per-month profit and its running total are
// different magnitudes and get their own frames.
//
// Palette validated against this app's panel surface (#161616): blue #3987e5 /
// red #e66767 — CVD ΔE 19.2 (protan), normal-vision 29.0, both ≥3:1.
// ─────────────────────────────────────────────────────────────

const POS = "#3987e5";
const NEG = "#e66767";
const SURFACE = "#161616";
const TOOLTIP_BG = "#0d0d0d";
const GRID = "#242424";
const BASELINE = "#3d3d3d";
const MUTED = "#6f6f6f";
const INK = "#ededed";

type Bucket = { key: string; label: string; profit: number; count: number; cum: number };

function saleDate(t: Ticket): Date {
  return new Date(t.sold_at ?? t.event_date ?? t.created_at);
}
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTHS[+m - 1]} ${y.slice(2)}`;
}

/** Sold rows with a known cost, bucketed by month, gap-filled so the x-axis is real time. */
function bucketByMonth(rows: { t: Ticket; profit: number }[]): Bucket[] {
  if (rows.length === 0) return [];
  const sums = new Map<string, { profit: number; count: number }>();
  for (const { t, profit } of rows) {
    const k = monthKey(saleDate(t));
    const cur = sums.get(k) ?? { profit: 0, count: 0 };
    cur.profit += profit;
    cur.count += 1;
    sums.set(k, cur);
  }
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

/** Column: 4px rounded data-end, square foot on the baseline. */
function barPath(x: number, y: number, w: number, h: number, up: boolean): string {
  const r = Math.min(4, w / 2, h);
  if (h <= 0.5) return `M${x},${y} h${w}`;
  return up
    ? `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
    : `M${x},${y} L${x},${y + h - r} Q${x},${y + h} ${x + r},${y + h} L${x + w - r},${y + h} Q${x + w},${y + h} ${x + w},${y + h - r} L${x + w},${y} Z`;
}

/** Compact axis label: 5k / 2.5k / 800, no trailing ".0". */
function money(n: number): string {
  const a = Math.abs(n);
  let s: string;
  if (a >= 1000) {
    const k = a / 1000;
    s = `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
  } else {
    s = a.toFixed(0);
  }
  return `${n < 0 ? "−" : ""}${s}`;
}
/** Full number with thousands separators, for the KPI + hero figures. */
function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function ticks(min: number, max: number, n = 4): number[] {
  const span = max - min || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? mag * 10;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// Half-width viewBox so, side by side, each chart renders near 1:1 instead of
// being stretched across the whole page (which magnified every mark).
const W = 600;
const CH = 250;
const BH = 250;
const PAD = { top: 16, right: 16, bottom: 26, left: 46 };

export default function ProfitChart({ tickets }: { tickets: Ticket[] }) {
  // Priced sold rows: realized profit needs both a sale and a known cost.
  const priced = useMemo(
    () => tickets.filter((t) => t.qty_sold > 0 && t.buy_price > 0).map((t) => ({
      t, profit: realizedProfit(t), cost: realizedCost(t),
    })),
    [tickets]
  );
  const data = useMemo(() => bucketByMonth(priced.map(({ t, profit }) => ({ t, profit }))), [priced]);
  const [hover, setHover] = useState<{ i: number; chart: "bar" | "line" } | null>(null);

  const awaitingCost = tickets.filter((t) => t.qty_sold > 0 && !t.buy_price).length;
  const pending = awaitingCost > 0 && (
    <div className="chart-notice">
      <strong>{awaitingCost}</strong> sold {awaitingCost === 1 ? "row has" : "rows have"} no buy price yet, so
      {awaitingCost === 1 ? " it is" : " they are"} left out of these charts — without a cost there's no profit
      to plot. Add the buy price and {awaitingCost === 1 ? "it appears" : "they appear"} here.
    </div>
  );

  // KPIs (profit = revenue − invested, by construction).
  const revenue = priced.reduce((s, r) => s + r.t.sell_price, 0);
  const invested = priced.reduce((s, r) => s + r.cost, 0);
  const profit = priced.reduce((s, r) => s + r.profit, 0);
  const roi = invested > 0 ? (profit / invested) * 100 : 0;

  if (data.length === 0) {
    return (
      <div className="dash">
        {pending}
        <div className="chart-card chart-empty">
          {awaitingCost > 0
            ? "Nothing to chart yet — every sold row is still waiting for its buy price."
            : "No sales yet — the chart starts once a row is marked Sold."}
        </div>
      </div>
    );
  }

  const cw = W - PAD.left - PAD.right;

  // ── Cumulative (hero) ──
  const cPlotH = CH - PAD.top - PAD.bottom;
  const cMin = Math.min(0, ...data.map((d) => d.cum));
  const cMax = Math.max(0, ...data.map((d) => d.cum));
  const cT = ticks(cMin, cMax);
  const cLo = Math.min(cMin, cT[0]);
  const cHi = Math.max(cMax, cT[cT.length - 1]);
  const cy = (v: number) => PAD.top + cPlotH - ((v - cLo) / (cHi - cLo || 1)) * cPlotH;
  const cx = (i: number) => PAD.left + (data.length === 1 ? cw / 2 : (i / (data.length - 1)) * cw);
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${cx(i)},${cy(d.cum)}`).join(" ");
  const area = `${line} L${cx(data.length - 1)},${cy(cLo)} L${cx(0)},${cy(cLo)} Z`;
  const last = data[data.length - 1];
  const lineColor = last.cum >= 0 ? POS : NEG;

  // ── Bars ──
  const bPlotH = BH - PAD.top - PAD.bottom;
  const pMin = Math.min(0, ...data.map((d) => d.profit));
  const pMax = Math.max(0, ...data.map((d) => d.profit));
  const pT = ticks(pMin, pMax);
  const pLo = Math.min(pMin, pT[0]);
  const pHi = Math.max(pMax, pT[pT.length - 1]);
  const by = (v: number) => PAD.top + bPlotH - ((v - pLo) / (pHi - pLo || 1)) * bPlotH;
  const zeroY = by(0);
  const band = cw / data.length;
  const barW = Math.min(26, band - 3);

  const stride = Math.ceil(data.length / 8);

  return (
    <div className="dash">
      {pending}

      {/* ── KPI row ── */}
      <div className="kpis">
        <Kpi label="Total profit" value={`${fmt(profit)} EUR`} tone={profit >= 0 ? "pos" : "neg"} />
        <Kpi label="Revenue" value={`${fmt(revenue)} EUR`} />
        <Kpi label="Invested" value={`${fmt(invested)} EUR`} />
        <Kpi label="ROI" value={`${roi.toFixed(1)}%`} tone={roi >= 0 ? "pos" : "neg"} />
      </div>

      <div className="dash-charts">
      {/* ── Cumulative curve ── */}
      <figure className="chart-card">
        <figcaption className="cap-split">
          <div>
            <span className="chart-title">Total value over time</span>
            <span className="chart-sub">cumulative profit · EUR</span>
          </div>
          <div className={"chart-hero " + (last.cum >= 0 ? "profit-pos" : "profit-neg")}>
            {last.cum >= 0 ? "+" : "−"}{fmt(Math.abs(last.cum))}
          </div>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${CH}`} className="chart-svg" role="img"
             aria-label={`Cumulative profit, latest ${last.cum.toFixed(0)} EUR.`}>
          <defs>
            <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity="0.32" />
              <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {cT.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={cy(v)} y2={cy(v)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 10} y={cy(v)} dy="0.32em" textAnchor="end" fill={MUTED} fontSize={11} className="tick">{money(v)}</text>
            </g>
          ))}
          {cLo < 0 && cHi > 0 && (
            <line x1={PAD.left} x2={W - PAD.right} y1={cy(0)} y2={cy(0)} stroke={BASELINE} strokeWidth={1} />
          )}
          <path d={area} fill="url(#cumGrad)" />
          <path d={line} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={cx(data.length - 1)} cy={cy(last.cum)} r={4.5} fill={lineColor} stroke={SURFACE} strokeWidth={2} />

          {data.map((d, i) => {
            const x0 = Math.max(PAD.left, cx(i) - band / 2);
            const x1 = Math.min(W - PAD.right, cx(i) + band / 2);
            return (
              <rect key={d.key} x={x0} y={PAD.top} width={x1 - x0} height={cPlotH} fill="transparent"
                    onMouseEnter={() => setHover({ i, chart: "line" })} onMouseLeave={() => setHover(null)} />
            );
          })}
          {hover?.chart === "line" && (
            <>
              <line x1={cx(hover.i)} x2={cx(hover.i)} y1={PAD.top} y2={PAD.top + cPlotH} stroke={MUTED} strokeWidth={1} opacity={0.5} />
              <circle cx={cx(hover.i)} cy={cy(data[hover.i].cum)} r={4.5} fill={lineColor} stroke={SURFACE} strokeWidth={2} />
              <Tooltip x={cx(hover.i)} y={PAD.top} title={data[hover.i].label}
                       lines={[`${fmt(data[hover.i].cum)} EUR total`]} />
            </>
          )}
          {data.map((d, i) =>
            i % stride === 0 ? (
              <text key={d.key} x={cx(i)} y={CH - 9} textAnchor="middle" fill={MUTED} fontSize={11} className="tick">{d.label}</text>
            ) : null
          )}
        </svg>
      </figure>

      {/* ── Profit by month ── */}
      <figure className="chart-card">
        <figcaption>
          <span className="chart-title">Profit by month</span>
          <span className="chart-sub">EUR</span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${BH}`} className="chart-svg" role="img"
             aria-label={`Profit by month. ${data.map((d) => `${d.label}: ${d.profit.toFixed(0)}`).join(", ")}`}>
          {pT.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={by(v)} y2={by(v)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 10} y={by(v)} dy="0.32em" textAnchor="end" fill={MUTED} fontSize={11} className="tick">{money(v)}</text>
            </g>
          ))}
          <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke={BASELINE} strokeWidth={1} />
          {data.map((d, i) => {
            const x = PAD.left + i * band + (band - barW) / 2;
            const up = d.profit >= 0;
            const h = Math.abs(by(d.profit) - zeroY);
            const y = up ? zeroY - h : zeroY;
            const on = hover?.chart === "bar" && hover.i === i;
            return (
              <g key={d.key} onMouseEnter={() => setHover({ i, chart: "bar" })} onMouseLeave={() => setHover(null)}>
                <rect x={PAD.left + i * band} y={PAD.top} width={band} height={bPlotH} fill="transparent" />
                <path d={barPath(x, y, barW, h, up)} fill={up ? POS : NEG}
                      opacity={on || !hover || hover.chart !== "bar" ? 1 : 0.4} />
              </g>
            );
          })}
          {data.map((d, i) =>
            i % stride === 0 ? (
              <text key={d.key} x={PAD.left + i * band + band / 2} y={BH - 9} textAnchor="middle" fill={MUTED} fontSize={11} className="tick">{d.label}</text>
            ) : null
          )}
          {hover?.chart === "bar" && (
            <Tooltip x={PAD.left + hover.i * band + band / 2} y={PAD.top} title={data[hover.i].label}
                     lines={[
                       `${data[hover.i].profit >= 0 ? "+" : "−"}${fmt(Math.abs(data[hover.i].profit))} EUR`,
                       `${data[hover.i].count} sale${data[hover.i].count === 1 ? "" : "s"}`,
                     ]} />
          )}
        </svg>
      </figure>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={"kpi-value" + (tone === "pos" ? " profit-pos" : tone === "neg" ? " profit-neg" : "")}>{value}</div>
    </div>
  );
}

/** Tooltip in SVG so the plot can't clip it. */
function Tooltip({ x, y, title, lines }: { x: number; y: number; title: string; lines: string[] }) {
  const w = 122;
  const h = 18 + lines.length * 15;
  const lx = Math.min(Math.max(x - w / 2, 4), W - w - 4);
  return (
    <g pointerEvents="none">
      <rect x={lx} y={y} width={w} height={h} rx={6} fill={TOOLTIP_BG} stroke={GRID} strokeWidth={1} />
      <text x={lx + 9} y={y + 15} fill={INK} fontSize={12} fontWeight={600}>{title}</text>
      {lines.map((l, i) => (
        <text key={i} x={lx + 9} y={y + 30 + i * 15} fill={MUTED} fontSize={11} className="tick">{l}</text>
      ))}
    </g>
  );
}
