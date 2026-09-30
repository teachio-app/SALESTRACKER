"use client";

import type { ReactNode } from "react";

// Small visual pieces shared by the Market page.

// ── icons (16px, stroked in currentColor) ──
const I = (d: ReactNode, size = 16) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
export const Icon = {
  external: I(<><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>),
  refresh: I(<><path d="M20 11a8 8 0 0 0-14.9-4" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.9 4" /><path d="M20 20v-4h-4" /></>),
  search: I(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  chevron: I(<path d="m6 9 6 6 6-6" />, 14),
  close: I(<><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>),
  sparkle: I(<><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m6 6 2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></>),
  globe: I(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" /></>),
};

/** A 0–max bar with its value, for scores. Colour sits in the fill; the number stays in ink. */
export function ScoreBar({ label, value, max = 10, hue }: { label: string; value: number; max?: number; hue: string }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <span className="score-track" role="img" aria-label={`${label}: ${value} of ${max}`}>
        <span className="score-fill" style={{ width: `${w}%`, background: hue }} />
      </span>
      <span className="score-value">{value}<small>/{max}</small></span>
    </div>
  );
}

export function Pill({ tone, children }: { tone: "up" | "down" | "neutral" | "warn" | "muted"; children: ReactNode }) {
  return <span className={`pill is-${tone}`}>{children}</span>;
}
