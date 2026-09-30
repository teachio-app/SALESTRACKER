// ─────────────────────────────────────────────────────────────
// MARKET CAPTURE — the shape the browser extension sends.
//
// Every field is a RAW STRING, exactly as it was rendered on screen. Nothing is
// parsed, normalised or converted on the browser side, and that is deliberate:
//
//   * the extension has to be reinstalled to change, the server does not. When
//     the site renames a label or starts writing "9 hours ago" instead of
//     "9h ago", the fix is a deploy, not a message asking the owner to update
//     an extension;
//   * raw strings can be TESTED. A fixture is a copy-paste of what was on the
//     page, and the test reads exactly like the screenshot it came from;
//   * "N/A" survives the trip. A tile that hasn't loaded says N/A, and if the
//     extension parsed it, that would arrive as 0 — an event with zero tickets
//     available and 584 sales is a strong buy signal and a complete fiction.
//
// So: dumb capture, careful parse, and the raw text is kept alongside the parsed
// value wherever it might later turn out to have been read wrong.
// ─────────────────────────────────────────────────────────────

/** One sale row from the Sales History table. */
export type RawSale = {
  price: string;        // "€340,21"
  quantity: string;     // "3"
  section: string;      // "107"
  row: string;          // "22"
  seats: string;        // "158 - 160"   (sometimes junk: "from - froo")
  updateText: string;   // "9h ago"
};

/** The Sales Statistics tiles, keyed by the label shown under each number. */
export type RawStats = {
  totalSales?: string;        // "584"
  totalTickets?: string;      // "1261"
  averagePrice?: string;      // "€211,45"
  floorPrice?: string;        // "€85,66"
  sales24h?: string;          // "17"
  firstSale?: string;         // "Sep 15, 2026"
  listings?: string;          // "836"   — "N/A" until the panel loads
  ticketsAvailable?: string;  // "2150"  — ditto
};

export type RawEvent = {
  sourceEventId: string;  // from the page URL — the join key across captures
  url: string;
  name: string;           // "NBA Manchester: New Orleans Pelicans vs San Antonio Spurs"
  dateText?: string;      // "Sunday, January 17, 2027"
  venue?: string;         // "Co-op Live"
  city?: string;          // "Manchester"
  country?: string;       // "United Kingdom"
  /** The page's link out to the event on viagogo, when it has one. */
  vggUrl?: string;
};

/** The whole POST body. */
export type Capture = {
  source: string;         // "tikey"
  capturedAt: string;     // ISO, set by the extension at capture time
  currency?: string;      // the currency selector's value, e.g. "EUR"
  event: RawEvent;
  stats: RawStats;
  sales: RawSale[];
};

// ── Parsed forms ──────────────────────────────────────────────────────

export type ParsedStats = {
  total_sales: number | null;
  total_tickets: number | null;
  average_price: number | null;
  floor_price: number | null;
  sales_24h: number | null;
  first_sale: string | null;       // ISO date
  listings: number | null;
  tickets_available: number | null;
  currency: string;
};

export type ParsedSale = {
  fingerprint: string;
  price: number | null;
  qty: number | null;
  section: string | null;
  seat_row: string | null;
  seats: string | null;
  /** Derived from "9h ago" and the capture time — approximate by design. */
  sold_at_approx: string | null;
  /** How approximate. An hour-old sale is worth more than a week-old one. */
  precision: "exact" | "minute" | "hour" | "day" | "week" | "month" | "unknown";
  raw_update: string;
};
