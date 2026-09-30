"use client";

import type { CSSProperties, ReactNode } from "react";
import type { Signal } from "@/lib/market/summary";

// ─────────────────────────────────────────────────────────────
// The Market page's visual pieces.
//
// COLOUR FOLLOWS THE MEASURE, everywhere on the page: "sold" is the same blue
// on its tile, in the sell-through bar and as the Sold line in the chart;
// "available" the same orange; floor violet, average teal. Learn a colour once
// and it means the same thing in every part of the page.
//
// Colour marks things; it never carries the text. Values and labels stay in the
// normal ink, and the colour sits beside them — a tile's top edge and icon, a
// bar's fill, a pill's tint — so every number reads at full contrast and nothing
// depends on telling two hues apart. Pace and tone pills pair their colour with
// a glyph and a word for the same reason.
//
// Hues are the validated dark-mode categorical steps, checked on the #161616
// panel for the pairs that sit side by side (dataviz validator):
//   sold · 24h                       CVD ΔE 15.9
//   floor · average · available · sold  worst adjacent CVD ΔE 9.4
// Yellow was tried for the runway and FAILED beside orange (ΔE 4.8), so the
// runway uses the orange of the supply it is measuring.
// ─────────────────────────────────────────────────────────────

export const HUE = {
  sold: "#3987e5",
  day: "#d55181",
  floor: "#9085e9",
  average: "#199e70",
  available: "#d95926",
} as const;

// ── icons (16px, stroked in currentColor) ──
const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
export const Icon = {
  ticket: I(<><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z" /><path d="M13 6v12" strokeDasharray="2 2" /></>),
  bolt: I(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />),
  tag: I(<><path d="M20 12 12 20l-9-9V3h8l9 9Z" /><circle cx="7.5" cy="7.5" r="1.5" /></>),
  scale: I(<><path d="M4 19h16" /><path d="M7 16V9" /><path d="M12 16V5" /><path d="M17 16v-4" /></>),
  layers: I(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>),
  pie: I(<><path d="M12 3a9 9 0 1 0 9 9h-9V3Z" /><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z" /></>),
  hourglass: I(<><path d="M6 3h12M6 21h12" /><path d="M7 3c0 5 10 5 10 9s-10 4-10 9" /><path d="M17 3c0 5-10 5-10 9s10 4 10 9" /></>),
  calendar: I(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  pin: I(<><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></>),
  clock: I(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  refresh: I(<><path d="M20 11a8 8 0 0 0-14.9-4" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.9 4" /><path d="M20 20v-4h-4" /></>),
  external: I(<><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>),
};

/** A measure with its colour on the top edge and icon — the value stays in ink. */
export function Stat({
  hue, icon, label, value, sub, hero, children,
}: {
  hue: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  hero?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={"stat" + (hero ? " is-hero" : "")} style={{ "--hue": hue } as CSSProperties}>
      <div className="stat-head">
        <span className="stat-icon">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {children}
    </div>
  );
}

/** How fast it's selling against its own average — glyph, number and word. */
export function PacePill({ momentum, compact }: { momentum: number | null; compact?: boolean }) {
  if (momentum == null) return <span className="pill is-muted">pace unknown</span>;
  const tone = momentum >= 1.3 ? "up" : momentum <= 0.6 ? "down" : "neutral";
  const glyph = tone === "up" ? "▲" : tone === "down" ? "▼" : "●";
  const word = tone === "up" ? "faster" : tone === "down" ? "slower" : "usual pace";
  // One decimal, the same as the Reading text — "0.44×" in a tile beside
  // "0.4×" in a sentence reads as two different measurements.
  return (
    <span className={`pill is-${tone}`} title={`${momentum}× its own average daily pace`}>
      <span aria-hidden>{glyph}</span> {momentum.toFixed(1)}×{compact ? "" : ` ${word}`}
    </span>
  );
}

/** A plain coloured chip for dates, countdowns, places. */
export function Chip({ icon, children, tone }: { icon?: ReactNode; children: ReactNode; tone?: "accent" | "warn" | "muted" }) {
  return (
    <span className={"chip" + (tone ? ` is-${tone}` : "")}>
      {icon}
      {children}
    </span>
  );
}

/**
 * Sold vs still available, as one bar. The same two colours as the tickets
 * chart, a 2px gap between the parts so they never blur into one.
 */
export function SellThroughBar({ sold, available, thin }: { sold: number | null; available: number | null; thin?: boolean }) {
  if (sold == null || available == null || sold + available <= 0) {
    return <div className={"meter" + (thin ? " is-thin" : "") + " is-empty"} aria-label="not known" />;
  }
  const s = (sold / (sold + available)) * 100;
  return (
    <div className={"meter" + (thin ? " is-thin" : "")} role="img"
         aria-label={`${Math.round(s)} % sold, ${Math.round(100 - s)} % still available`}>
      <span style={{ width: `${s}%`, background: HUE.sold }} />
      <span style={{ width: `${100 - s}%`, background: HUE.available }} />
    </div>
  );
}

/**
 * How long today's supply would last at the last day's pace, against the time
 * left before the event. The track is the time left; the fill is the supply.
 */
export function RunwayBar({ runway, daysLeft }: { runway: number; daysLeft: number }) {
  const fill = Math.max(2, Math.min(100, (runway / Math.max(1, daysLeft)) * 100));
  return (
    <div className="runway" role="img"
         aria-label={`Supply lasts about ${Math.round(runway)} days; the event is in ${daysLeft} days`}>
      <div className="runway-track">
        <span className="runway-fill" style={{ width: `${fill}%`, background: HUE.available }} />
      </div>
      <div className="runway-scale">
        <span>today</span>
        <span>event · {daysLeft} d</span>
      </div>
    </div>
  );
}

const TONE_GLYPH: Record<Signal["tone"], string> = { up: "▲", down: "▼", neutral: "●", warn: "⚠" };
const TONE_WORD: Record<Signal["tone"], string> = { up: "Stronger", down: "Weaker", neutral: "Note", warn: "Check" };

/** The reading, one card per signal, each marked by tone with a glyph and a word. */
export function SignalList({ signals }: { signals: Signal[] }) {
  if (!signals.length) return <div className="hint">Nothing to read yet.</div>;
  return (
    <ul className="signal-list">
      {signals.map((g, i) => (
        <li key={i} className={`signal is-${g.tone}`}>
          <span className="signal-badge"><span aria-hidden>{TONE_GLYPH[g.tone]}</span> {TONE_WORD[g.tone]}</span>
          <span className="signal-text">{g.text}</span>
        </li>
      ))}
    </ul>
  );
}
