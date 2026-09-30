// Types and formatting shared by the Market page's parts.

import type { Summary, SummarySnapshot } from "@/lib/market/summary";

export type MarketEvent = {
  id: string;
  name: string;
  event_date: string | null;
  venue: string | null;
  city: string | null;
  country: string | null;
  url: string | null;
  vgg_event_id: string | null;
  tier: string;
  last_captured_at: string | null;
  captures: number;
  summary: Summary;
};

export type SaleRow = {
  price: number | null;
  qty: number | null;
  currency: string;
  section: string | null;
  seat_row: string | null;
  seats: string | null;
  sold_at_approx: string | null;
  precision: string | null;
};

export type Detail = { event: MarketEvent; snapshots: SummarySnapshot[]; sales: SaleRow[]; summary: Summary };

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

export function money(n: number | null | undefined, cur = "EUR"): string {
  if (n == null) return "—";
  const v = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return SYMBOL[cur] ? `${SYMBOL[cur]}${v}` : `${v} ${cur}`;
}

export const int = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)} %`);

export function ago(iso: string | null): string {
  if (!iso) return "never";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function when(days: number | null): string {
  if (days == null) return "";
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}

/** "Sat 14 Nov 2026" from a YYYY-MM-DD, read as a calendar date (no time zone shift). */
export function longDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "30 Sept 2026, 13:37:05" in the viewer's own time zone, not the stored UTC. */
export function localStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/** "~9h ago" for a recent, hour-precise time; the date once it's older or coarser. */
export function soldWhen(r: SaleRow): string {
  if (!r.sold_at_approx) return "—";
  const h = (Date.now() - Date.parse(r.sold_at_approx)) / 3_600_000;
  if ((r.precision === "hour" || r.precision === "minute" || r.precision === "exact") && h < 48) {
    if (h < 1) return `~${Math.max(1, Math.round(h * 60))}m ago`;
    return `~${Math.round(h)}h ago`;
  }
  return `~${r.sold_at_approx.slice(0, 10)}`;
}
