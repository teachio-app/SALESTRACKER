"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ticks, money as compact } from "@/app/ProfitChart";

// ─────────────────────────────────────────────────────────────
// One measure over time, for one market event — drawn from YOUR captures.
//
// Same chart language as ProfitChart: hairline grid, 2px lines, ringed end
// dots, an SVG tooltip that can't be clipped. What is specific to this data:
//
//   * THE X AXIS IS TIME, NOT CAPTURE NUMBER. Captures happen when you happen
//     to open the page — twice on Monday, then nothing until Friday. Spacing
//     them evenly would draw Monday's hour and the four-day gap as the same
//     width, and every slope on the chart would be a lie about pace.
//   * A MISSING VALUE IS A GAP, NOT A ZERO. A capture taken while a tile still
//     read "N/A" stores null, and the line breaks there instead of diving to
//     the axis and back — which would look like a sell-out that un-happened.
//   * THE Y AXIS FITS THE DATA, not zero. These are lines, which encode change
//     by position, not bars, which encode size by length. Forced to zero, a
//     floor sliding from €92 to €86 — the thing worth seeing — was a flat line.
//   * IT IS DRAWN AT ITS REAL WIDTH. A fixed 600-unit viewBox squeezed onto a
//     phone scaled 11px labels down to about 6px. The chart measures its box
//     and draws 1:1, so text is the same size on every screen.
//
// One unit per chart, always. Tickets and euros never share a y-axis; the page
// draws them as two separate charts.
// ─────────────────────────────────────────────────────────────

export type Series = {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
};

const SURFACE = "#161616";
const TOOLTIP_BG = "#0d0d0d";
const GRID = "#242424";
const MUTED = "#6f6f6f";
const INK = "#ededed";

const DAY = 86_400_000;

function dateLabel(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  // Under two days, the hour is the useful part.
  return spanMs < 2 * DAY
    ? `${day} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}`
    : day;
}

/**
 * Gridline values that enclose the data: the tick step from ProfitChart's
 * `ticks`, extended one step past each end so the highest line always has a
 * gridline above it and the lowest one below.
 */
export function niceDomain(min: number, max: number): number[] {
  let lo = min;
  let hi = max;
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const t = ticks(lo, hi);
  const step = t.length > 1 ? t[1] - t[0] : hi - lo;
  const start = Math.floor(lo / step) * step;
  const end = Math.max(Math.ceil(hi / step) * step, start + step);
  const out: number[] = [];
  for (let v = start; v <= end + step / 1e6; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export default function MarketChart({
  title,
  sub,
  at,
  series,
  format,
}: {
  title: string;
  sub: string;
  /** Capture instants, ISO, ascending — one per value in every series. */
  at: string[];
  series: Series[];
  /** Full value for the tooltip and end labels. The axis uses a compact form. */
  format: (n: number) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = W < 480;
  const H = narrow ? 210 : 240;
  // Right padding holds the direct end labels.
  const PAD = { top: 14, right: narrow ? 66 : 74, bottom: 26, left: 44 };

  const xs = at.map((s) => Date.parse(s));
  const t0 = xs[0];
  const t1 = xs[xs.length - 1];
  const span = t1 - t0 || 1;
  const pw = W - PAD.left - PAD.right;
  const ph = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + ((xs[i] - t0) / span) * pw;

  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const yt = niceDomain(Math.min(...all), Math.max(...all));
  const lo = yt[0];
  const hi = yt[yt.length - 1];
  const y = (v: number) => PAD.top + ph - ((v - lo) / (hi - lo || 1)) * ph;

  /** A path that lifts the pen over nulls, so a missing reading is a gap. */
  const path = (values: (number | null)[]) => {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  // End labels sit at each series' LAST known value. When two land within a
  // line-height of each other they are spread apart just enough to read, and a
  // short leader keeps each tied to its own line.
  const ends = series
    .map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && s.values[i] == null) i--;
      return i < 0 ? null : { s, i, v: s.values[i] as number, ly: y(s.values[i] as number) };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < ends.length; k++) {
    if (ends[k].ly - ends[k - 1].ly < 14) ends[k].ly = ends[k - 1].ly + 14;
  }

  // Nearest capture to the pointer, in time. Readers aim at a date, not a line.
  const nearest = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    return best;
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") { setHover((h) => Math.min(xs.length - 1, (h ?? -1) + 1)); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { setHover((h) => Math.max(0, (h ?? xs.length) - 1)); e.preventDefault(); }
    else if (e.key === "Escape") setHover(null);
  };

  // A handful of date labels, always the first and the last capture — fewer on
  // a phone, where five dates collide.
  const want = narrow ? 3 : 5;
  const xTicks = xs.length <= want
    ? xs.map((_, i) => i)
    : [...new Set(Array.from({ length: want }, (_, k) => Math.round((k * (xs.length - 1)) / (want - 1))))];

  const summaryText = series
    .map((s) => {
      const last = [...s.values].reverse().find((v) => v != null);
      return `${s.label}: ${last == null ? "no value" : format(last)}`;
    })
    .join("; ");

  return (
    <figure className="chart-card">
      <figcaption className="cap-split">
        <div>
          <span className="chart-title">{title}</span>
          <span className="chart-sub">{sub}</span>
        </div>
        {/* The legend is the identity channel; the end labels only supplement it. */}
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.key} className="legend-item">
              <span className="legend-key" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
          ))}
        </div>
      </figcaption>

      <div ref={box}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="chart-svg"
          role="img"
          tabIndex={0}
          aria-label={`${title}, ${at.length} captures. Latest — ${summaryText}. Use the arrow keys to step through captures.`}
          onMouseMove={(e) => setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover((h) => h ?? xs.length - 1)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          {yt.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fill={MUTED} fontSize={11} className="tick">
                {compact(v)}
              </text>
            </g>
          ))}

          {series.map((s) => (
            <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {/* A capture with no neighbour on either side has no line to sit on;
              without a dot it would simply not be drawn. */}
          {series.map((s) =>
            s.values.map((v, i) =>
              v != null && s.values[i - 1] == null && s.values[i + 1] == null ? (
                <circle key={`${s.key}-${i}`} cx={x(i)} cy={y(v)} r={4} fill={s.color} stroke={SURFACE} strokeWidth={2} />
              ) : null
            )
          )}

          {ends.map((e) => (
            <g key={e.s.key}>
              <circle cx={x(e.i)} cy={y(e.v)} r={4.5} fill={e.s.color} stroke={SURFACE} strokeWidth={2} />
              {Math.abs(e.ly - y(e.v)) > 1 && (
                <line x1={x(e.i) + 6} x2={W - PAD.right + 4} y1={y(e.v)} y2={e.ly} stroke={MUTED} strokeWidth={1} opacity={0.6} />
              )}
              {/* Text wears the ink colour, never the series colour. */}
              <text x={W - PAD.right + 8} y={e.ly} dy="0.32em" fill={INK} fontSize={11} className="tick">
                {format(e.v)}
              </text>
            </g>
          ))}

          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={H - 8} fill={MUTED} fontSize={11} className="tick"
                  textAnchor={i === 0 ? "start" : i === xs.length - 1 ? "end" : "middle"}>
              {dateLabel(xs[i], span)}
            </text>
          ))}

          {hover != null && (
            <g pointerEvents="none" className="chart-hover">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ph} stroke={MUTED} strokeWidth={1} opacity={0.5} />
              {series.map((s) =>
                s.values[hover] != null ? (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] as number)} r={4.5}
                          fill={s.color} stroke={SURFACE} strokeWidth={2} />
                ) : null
              )}
              <Tooltip x={x(hover)} top={PAD.top} width={W} title={dateLabel(xs[hover], 0)}
                       rows={series.map((s) => ({
                         color: s.color,
                         label: s.label,
                         value: s.values[hover] == null ? "not loaded" : format(s.values[hover] as number),
                       }))} />
            </g>
          )}
        </svg>
      </div>
    </figure>
  );
}

/** Values lead, labels follow; each row keyed with a short stroke of its colour. */
function Tooltip({
  x, top, width, title, rows,
}: {
  x: number;
  top: number;
  width: number;
  title: string;
  rows: { color: string; label: string; value: string }[];
}) {
  const w = 168;
  const h = 22 + rows.length * 16;
  // Beside the crosshair rather than over it, flipping sides near the right
  // edge, so the tooltip never hides the point it describes.
  const right = x + 12 + w <= width - 4;
  const lx = right ? x + 12 : Math.max(4, x - 12 - w);
  return (
    <g>
      <rect x={lx} y={top} width={w} height={h} rx={6} fill={TOOLTIP_BG} stroke={GRID} strokeWidth={1} />
      <text x={lx + 10} y={top + 16} fill={MUTED} fontSize={11}>{title}</text>
      {rows.map((r, i) => {
        const ry = top + 33 + i * 16;
        return (
          <g key={r.label}>
            <line x1={lx + 10} x2={lx + 22} y1={ry - 4} y2={ry - 4} stroke={r.color} strokeWidth={2} strokeLinecap="round" />
            <text x={lx + 28} y={ry} fill={INK} fontSize={12} fontWeight={600} className="tick">{r.value}</text>
            <text x={lx + w - 10} y={ry} fill={MUTED} fontSize={11} textAnchor="end">{r.label}</text>
          </g>
        );
      })}
    </g>
  );
}
