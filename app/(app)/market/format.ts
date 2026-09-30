// Formatting shared by the Market page's parts.

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };

export function money(n: number | null | undefined, cur = "EUR", decimals = 2): string {
  if (n == null) return "—";
  const v = n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return SYMBOL[cur] ? `${SYMBOL[cur]}${v}` : `${v} ${cur}`;
}

export const int = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
export const pct = (n: number | null | undefined, signed = false) =>
  n == null ? "—" : `${signed && n > 0 ? "+" : ""}${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} %`;
export const num1 = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));

/** "9h ago", "34m ago", "3 days ago" — how Tikey's own table writes it. */
export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const m = (now - Date.parse(iso)) / 60_000;
  if (m < 1) return "just now";
  if (m < 60) return `${Math.round(m)}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/** "Sat 14 Nov 2026" from a YYYY-MM-DD, read as a calendar date (no time zone shift). */
export function longDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Apr 7, 2026" — the tile's own style. */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function when(days: number | null): string {
  if (days == null) return "";
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}
