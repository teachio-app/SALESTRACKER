// ─────────────────────────────────────────────────────────────
// Viagogo links → an event to look up.
//
// Viagogo event pages end in "/E-<digits>", and that id is all the Market page
// needs: Tikey's Sales Tracker page for the event is built from it
// (…/salestracker/viagogo/event/E-<id>). The name words in the path are kept
// for messages, never used to guess an event.
//
// A link without an id is reported as such rather than matched on whatever
// scraps it has.
// ─────────────────────────────────────────────────────────────

export type VggRef = {
  /** Viagogo's event id, when the link carries one. */
  eventId: string | null;
  /** Meaningful words from the path, for the name fallback. */
  words: string[];
  /** The link as given, for the reply and for logging an unreadable shape. */
  url: string;
};

/**
 * Path words that describe the catalogue, not the event. "Concert-Tickets" in
 * "…/Concert-Tickets/Rock-and-Pop/Coldplay-Tickets/…" says nothing about which
 * concert, and matching on it would pair every concert with every other.
 */
const NOISE = new Set([
  "tickets", "ticket", "concert", "concerts", "sports", "sport", "theater", "theatre",
  "festival", "festivals", "and", "the", "vs", "v", "at", "of", "in", "rock", "pop",
  "event", "events", "www", "com", "gb", "uk", "de", "en", "us", "ww",
]);

/** Pull a VggRef out of whatever was pasted — a full URL, or just the id. */
export function parseVggLink(input: string | null | undefined): VggRef | null {
  const raw = (input ?? "").trim().replace(/^<|>$/g, ""); // Discord wraps links in <> to suppress previews
  if (!raw) return null;

  // A bare id, typed rather than pasted.
  const bare = raw.match(/^E?-?(\d{6,})$/i);
  if (bare) return { eventId: bare[1], words: [], url: raw };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  // The host must END in viagogo plus a real country suffix. `viagogo\.[a-z.]+`
  // looked right and accepted "viagogo.com.evil.example" — the dots let the
  // suffix swallow a whole second domain. The test for it is in vgg.test.ts.
  if (!/^(?:[a-z0-9-]+\.)*viagogo\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/i.test(url.hostname)) return null;

  const path = decodeURIComponent(url.pathname);
  const eventId =
    path.match(/\/E-(\d{5,})(?:[/?#]|$)/i)?.[1] ??
    url.searchParams.get("eventId") ??
    url.searchParams.get("EventId") ??
    path.match(/\/events?\/(\d{5,})(?:[/?#]|$)/i)?.[1] ??
    null;

  const words = path
    .split(/[/\-_+\s]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !/^e$/.test(w) && !NOISE.has(w));

  return { eventId, words: [...new Set(words)], url: url.toString() };
}
