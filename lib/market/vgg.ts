// ─────────────────────────────────────────────────────────────
// Viagogo links → an event to look up.
//
// Two ways in, in order of trust:
//
//   1. THE EVENT ID. Viagogo event pages end in "/E-<digits>". When the capture
//      saw a viagogo link on the page it recorded that id, and a lookup by id is
//      exact.
//   2. THE SLUG. The same URL carries the event's name in its path
//      ("…/New-Orleans-Pelicans-Tickets/E-…"). If no capture carries the id,
//      the name words are matched against captured event names. That is a
//      guess, and it is labelled as one all the way to the Discord reply —
//      a number attributed to the wrong event is worse than no number.
//
// A link that yields neither is reported as unreadable rather than matched on
// whatever scraps it has. The owner can paste it back and the shape gets added.
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

/** Fold for comparison: lower-case, no diacritics. "Rosalía" matches "rosalia". */
function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export type NameCandidate = { id: string; name: string; event_date: string | null };

/**
 * Best captured event for a link's name words, or null when there is no
 * confident single answer.
 *
 * "Confident" means at least two words in common AND strictly more than the
 * runner-up. One shared word is how "Manchester United" gets matched to "NBA
 * Manchester"; a tie means the link doesn't say which of two events it is, and
 * picking one would be a coin toss presented as a fact.
 *
 * Past events are skipped when there is an upcoming one to prefer — the same
 * tour visits the same city year after year.
 */
export function matchByName(
  words: string[],
  events: NameCandidate[],
  today: string
): { event: NameCandidate; score: number } | null {
  if (words.length === 0 || events.length === 0) return null;
  const wanted = words.map(fold);

  const scored = events
    .map((e) => {
      const name = fold(e.name);
      const score = wanted.filter((w) => name.includes(w)).length;
      const upcoming = !e.event_date || e.event_date >= today;
      return { e, score, upcoming };
    })
    .filter((x) => x.score >= 2);
  if (!scored.length) return null;

  const pool = scored.some((x) => x.upcoming) ? scored.filter((x) => x.upcoming) : scored;
  pool.sort((a, b) => b.score - a.score);
  if (pool.length > 1 && pool[0].score === pool[1].score) return null;
  return { event: pool[0].e, score: pool[0].score };
}
