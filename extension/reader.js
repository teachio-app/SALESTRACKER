// ─────────────────────────────────────────────────────────────
// DeskTracker × Tikey — the reader. Runs on Sales Tracker pages.
//
// It does NOTHING on a page you opened yourself. When it loads, it asks the
// extension "did the tracker ask for this tab?" and only if the answer is yes
// does it read. So browsing Tikey normally is untouched; the only pages read are
// the ones the tracker asked for, one at a time, when you pressed Find.
//
// It reads the page your own browser rendered — signed in as you, past any
// security check as you. It fetches nothing and clicks nothing.
//
// Values are found by their LABEL ("Total Sales", "Floor Price") and table
// columns by their HEADER, never by CSS class: class names are generated and
// change with every deploy of the site, labels almost never do. Nothing is
// parsed here — raw strings go to the tracker, whose parser is tested against
// fixtures and fixed with a deploy rather than a reinstall (lib/market/parse.ts).
// ─────────────────────────────────────────────────────────────

const TILES = {
  totalSales: "total sales",
  totalTickets: "total tickets",
  averagePrice: "average price",
  floorPrice: "floor price",
  sales24h: "24h sales",
  firstSale: "first sale",
  listings: "number of listings",
  ticketsAvailable: "tickets available",
};

/** Section titles on the page that are headings but not the event's name. */
const NOT_THE_EVENT = /^(sales tracker|sales statistics|sales history|daily ticket sales|quantity sold|average price|sections analytics|distribution|map)$/i;

const text = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const notKnown = (v) => v == null || /^\s*(n\/?a|-|—|–|loading\.*)?\s*$/i.test(v);

/**
 * An element's OWN text — its direct text nodes, not its children's.
 *
 * The first version compared the whole textContent to the label, and on the live
 * page "24h Sales" never matched: the label carries an info icon with its own
 * tooltip text inside the same element, so its textContent was the label plus a
 * sentence. Own text is just "24h Sales".
 */
function ownText(el) {
  let s = "";
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE) s += n.textContent + " ";
  return s.replace(/\s+/g, " ").trim();
}

/** Label text as compared: lower case, stray icon glyphs ("ⓘ", "*") trimmed off. */
const labelOf = (s) => s.toLowerCase().replace(/[^a-z0-9%]+$/i, "").replace(/^[^a-z0-9]+/i, "").trim();

/** What a tile's value looks like: a count, money, a date, or "N/A". */
const VALUE =
  /^(n\/?a|—|–|-|[€$£]?\s?\d[\d.,\s]*\s?[€$£]?|[A-Za-z]{3,9}\.? \d{1,2},? \d{4}|\d{1,2}\.? [A-Za-z]{3,9}\.?,? \d{4})$/i;

const LABELS = Object.values(TILES);

/**
 * A tile is a value and a label in one box. Find the element whose own text is
 * the label, then climb until a box also holds a value-shaped element, and take
 * the value nearest the label.
 *
 * Two guards against reading a NEIGHBOUR's number: the climb stops at any box
 * that also holds another tile's label (it has left this tile), and among the
 * values in a box the one closest to the label in page order wins.
 */
function readTile(label) {
  for (const node of document.querySelectorAll("body *")) {
    if (labelOf(ownText(node)) !== label) continue;

    let box = node.parentElement;
    for (let up = 0; up < 4 && box; up++) {
      const all = text(box).toLowerCase();
      if (LABELS.some((l) => l !== label && all.includes(l))) break; // left the tile

      const els = [...box.querySelectorAll("*")];
      const at = els.indexOf(node);
      let best = null;
      let bestDist = Infinity;
      els.forEach((el, i) => {
        if (el === node || node.contains(el) || el.contains(node)) return;
        const t = ownText(el);
        if (!t || !VALUE.test(t)) return;
        const dist = Math.abs(i - at);
        if (dist < bestDist) { best = t; bestDist = dist; }
      });
      if (best != null) return best;
      box = box.parentElement;
    }
  }
  return null;
}

function readStats() {
  const stats = {};
  for (const [key, label] of Object.entries(TILES)) {
    const v = readTile(label);
    // "N/A" is kept, not dropped. A tile that has not loaded is a fact, and the
    // tracker needs to tell it apart from a genuine zero.
    if (v != null) stats[key] = v;
  }
  return stats;
}

/**
 * The Sales History table, columns located by HEADER text so a reordered or
 * newly added column moves the reader with it instead of shifting every value.
 */
function readSales() {
  for (const table of document.querySelectorAll("table")) {
    const heads = [...table.querySelectorAll("thead th, thead td")].map((th) => text(th).toLowerCase());
    if (!heads.length) continue;
    const at = (...names) => heads.findIndex((h) => names.some((n) => h.includes(n)));
    const iPrice = at("price");
    const iQty = at("quantity", "qty");
    const iSection = at("section");
    const iSeat = at("row & seat", "row and seat", "row");
    const iUpdate = at("update time", "update", "time");
    if (iPrice === -1 || iSection === -1) continue; // not the sales table

    const out = [];
    for (const tr of table.querySelectorAll("tbody tr")) {
      const cells = [...tr.querySelectorAll("td")];
      if (!cells.length) continue;
      const cell = (i) => (i >= 0 && cells[i] ? cells[i] : null);

      // "Row & Seat" is one cell holding two lines: the row above, the seats
      // below. Split on the element boundary rather than on whitespace, because
      // a seat range is written "158 - 160" and would split on its own spaces.
      let row = "";
      let seats = "";
      const seatCell = cell(iSeat);
      if (seatCell) {
        const leaves = [...seatCell.querySelectorAll("*")]
          .filter((el) => el.children.length === 0)
          .map(text)
          .filter(Boolean);
        if (leaves.length >= 2) {
          row = leaves[0];
          seats = leaves.slice(1).join(" ");
        } else {
          const parts = (seatCell.innerText || text(seatCell)).split(/\n+/).map((s) => s.trim()).filter(Boolean);
          row = parts[0] ?? "";
          seats = parts.slice(1).join(" ");
        }
      }

      const sale = {
        price: text(cell(iPrice)),
        quantity: text(cell(iQty)),
        section: text(cell(iSection)),
        row,
        seats,
        updateText: text(cell(iUpdate)),
      };
      if (sale.price) out.push(sale);
    }
    if (out.length) return out;
  }
  return [];
}

/**
 * The event's name is the BIGGEST heading on the page, not the first: the page
 * opens with a small "Sales Tracker" title above it, and the first-match reader
 * this replaced would have named every event "Sales Tracker".
 */
function eventHeading() {
  const candidates = [...document.querySelectorAll("h1, h2, h3")]
    .filter((h) => text(h) && !NOT_THE_EVENT.test(text(h)));
  let best = null;
  let size = 0;
  for (const h of candidates) {
    const s = parseFloat(getComputedStyle(h).fontSize) || 0;
    if (s > size) { best = h; size = s; }
  }
  return best;
}

function readEvent() {
  const h = eventHeading();
  const name = text(h);
  const segments = location.pathname.split("/").filter(Boolean);
  // ".../salestracker/viagogo/event/E-161613747" → "E-161613747". Only has to
  // be stable, since it is what joins one refresh of this event to the next.
  const sourceEventId = segments[segments.length - 1] || "";

  const { dateText, venue, city, country } = readHeaderLines(h);
  return { sourceEventId, url: location.href, name, dateText, venue, city, country, vggUrl: readVggLink(h), imageUrl: readImage(h) };
}

/** The event's picture beside the title, when there is one. */
function readImage(h) {
  let scope = h ? h.parentElement : null;
  for (let up = 0; up < 4 && scope; up++) {
    const img = [...scope.querySelectorAll("img")].find((i) => (i.naturalWidth || i.width) >= 40 && /^https?:/i.test(i.currentSrc || i.src));
    if (img) return img.currentSrc || img.src;
    scope = scope.parentElement;
  }
  return "";
}

/** "Sunday, January 17, 2027", "January 17, 2027", "17 January 2027", "17.01.2027". */
const DATE_LINE =
  /((mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?([a-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\.?\s+[a-z]{3,9}\.?,?\s+\d{4}|\d{1,2}[./]\d{1,2}[./]\d{4})/i;
/** Header text that is chrome, not event detail. */
const NOT_DETAIL = /^(share|compact view|↗|sales tracker|sales statistics|open|copy|view)$/i;

/**
 * The date, venue and "City, Country" under the event's name.
 *
 * Read as the page's text LINES in order after the heading, whatever elements
 * hold them. The first version walked the heading's parent elements and assumed
 * the three lines were siblings; on the live page they weren't, and every event
 * came back with no date — which took "days to event" and the runway with it.
 * Lines are classified by what they look like, and reading stops at the first
 * statistics label, before any number tile can be mistaken for a venue.
 */
function readHeaderLines(h) {
  const out = { dateText: "", venue: "", city: "", country: "" };
  if (!h) return out;

  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let started = false;
  for (let n = walker.nextNode(); n && lines.length < 14; n = walker.nextNode()) {
    if (!started) {
      // Start after the heading's own text.
      if (h.contains(n)) started = true;
      continue;
    }
    if (h.contains(n)) continue;
    const el = n.parentElement;
    if (!el || el.closest("script, style, noscript, button, nav")) continue;
    const t = n.textContent.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const low = labelOf(t);
    if (low === "sales statistics" || LABELS.includes(low)) break;
    if (t.length < 3 || NOT_DETAIL.test(t)) continue;
    lines.push(t);
  }

  for (const t of lines) {
    if (!out.dateText && DATE_LINE.test(t)) { out.dateText = t; continue; }
    // "Manchester, United Kingdom": one comma, words either side, no year.
    const loc = t.match(/^([^,\d]{2,60}),\s*([^,\d]{2,60})$/);
    if (!out.city && loc) { out.city = loc[1].trim(); out.country = loc[2].trim(); continue; }
    if (!out.venue && !/\d{4}/.test(t) && t.length <= 80 && !/[€$£]/.test(t)) { out.venue = t; continue; }
  }
  return out;
}

/**
 * The page's visible text in order, short — for the tracker to show when some
 * field couldn't be read. It is what it takes to fix the reader for a layout it
 * hasn't seen, without anyone having to dig through DevTools.
 */
function outline() {
  const rows = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && rows.length < 70; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || el.closest("script, style, noscript, table tbody")) continue;
    const t = n.textContent.replace(/\s+/g, " ").trim();
    if (!t) continue;
    rows.push(`${el.tagName.toLowerCase()}: ${t.slice(0, 80)}`);
  }
  return rows;
}

/** The ↗ link beside the title, when it points at a viagogo event. */
function readVggLink(heading) {
  const isEventLink = (a) => /viagogo\./i.test(a.href) && /\/E-\d{5,}/i.test(a.href);
  let scope = heading ? heading.parentElement : null;
  for (let up = 0; up < 4 && scope; up++) {
    const hit = [...scope.querySelectorAll("a[href]")].find(isEventLink);
    if (hit) return hit.href;
    scope = scope.parentElement;
  }
  const anywhere = [...document.querySelectorAll("a[href]")].filter(isEventLink);
  return anywhere.length === 1 ? anywhere[0].href : "";
}

/** The currency the page is showing, so the tracker doesn't guess from a symbol. */
function readCurrency() {
  const sel = [...document.querySelectorAll("select")].find((s) => /^[A-Z]{3}$/.test(s.value || ""));
  if (sel) return sel.value;
  const m = (document.body ? document.body.innerText : "").match(/\b(EUR|USD|GBP)\b/);
  return m ? m[1] : "";
}

function buildCapture() {
  const event = readEvent();
  if (!event.name || !event.sourceEventId) return null;
  return { source: "tikey", capturedAt: new Date().toISOString(), currency: readCurrency(), event, stats: readStats(), sales: readSales() };
}

/**
 * Everything beyond what's on screen: the JSON the page's scripts fetched (kept
 * by tap.js), chart series, and JSON embedded in the page itself. Handed to the
 * tracker as-is — it is parsed THERE, where the parsing is tested and a fix is a
 * deploy rather than a reinstall (lib/market/deep.ts).
 */
function collectDeep() {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", on);
      resolve(v);
    };
    const on = (e) => {
      if (e.source !== window || !e.data || e.data.source !== "desktracker-tap" || e.data.id !== id) return;
      done({ payloads: e.data.payloads || [], apex: e.data.apex || [], embedded: embeddedJson(), tap: true });
    };
    window.addEventListener("message", on);
    window.postMessage({ source: "desktracker-reader", type: "collect", id }, location.origin);
    // No tap (an older install, or a page it couldn't hook): carry on without it.
    setTimeout(() => done({ payloads: [], apex: [], embedded: embeddedJson(), tap: false }), 1500);
  });
}

/** JSON a server-rendered page embeds for its own scripts, e.g. Next.js's __NEXT_DATA__. */
function embeddedJson() {
  const out = [];
  for (const s of document.querySelectorAll('script[type="application/json"], script#__NEXT_DATA__')) {
    const t = (s.textContent || "").trim();
    if (!t || t.length > 5_000_000) continue;
    try { out.push({ url: `#${s.id || "inline-json"}`, at: Date.now(), json: JSON.parse(t) }); } catch { /* not JSON */ }
    if (out.length >= 10) break;
  }
  return out;
}

/** Fields a complete read should have, named — so a partial read can say what's missing. */
function missingFields(c) {
  const miss = [];
  if (!c.event.dateText) miss.push("event date");
  if (!c.event.venue) miss.push("venue");
  if (!c.event.city) miss.push("city");
  // A tile that was never found, and one that still reads N/A after the wait —
  // both mean the number isn't in the capture, and both are worth saying.
  for (const [key, label] of Object.entries(TILES)) {
    if (!(key in c.stats)) miss.push(`“${label}” tile`);
    else if (notKnown(c.stats[key])) miss.push(`“${label}” tile (still N/A)`);
  }
  if (!c.sales.length) miss.push("sales table");
  return miss;
}

/** What the page is showing right now, in the words an error message needs. */
function pageState() {
  const title = document.title || "";
  const body = document.body ? document.body.innerText.slice(0, 2000) : "";
  if (/security checkpoint/i.test(title) || /vercel security checkpoint/i.test(body)) return "checkpoint";
  if (/\/(login|signin|sign-in|auth)\b/i.test(location.pathname)) return "login";
  const pw = [...document.querySelectorAll('input[type="password"]')].some((i) => i.offsetParent !== null);
  if (pw) return "login";
  return "page";
}

/** For the tracker to show when a read fails — enough to fix the reader from. */
function diagnostics(c) {
  return {
    title: document.title,
    path: location.pathname,
    heading: c ? c.event.name : "",
    tilesFound: c ? Object.keys(c.stats).length : 0,
    tilesLoaded: c ? Object.values(c.stats).filter((v) => !notKnown(v)).length : 0,
    saleRows: c ? c.sales.length : 0,
  };
}

// ── only when asked ───────────────────────────────────────────────────

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});

(async () => {
  let answer;
  try {
    answer = await chrome.runtime.sendMessage({ type: "hello" });
  } catch {
    return;
  }
  if (!answer || !answer.read) return; // a page you opened yourself — leave it alone

  // A single-page app paints the frame first and the numbers after, and a tile
  // that hasn't loaded reads "N/A". Wait until the numbers are in AND the page
  // has stopped changing, so a half-loaded page is never what gets stored.
  const started = Date.now();
  const COMPLETE_BY = 15_000; // after this, accept a page with some tiles still N/A
  const GIVE_UP = 40_000;
  let lastSig = "";
  let stableSince = Date.now();
  let lastProgress = 0;

  for (;;) {
    const state = pageState();
    if (state === "login") {
      send({ type: "failed", message: "You're not signed in to Tikey in this browser. Sign in there once, then press Find again." });
      return;
    }

    const c = state === "page" ? buildCapture() : null;
    const elapsed = Date.now() - started;
    if (c) {
      const s = c.stats;
      const haveTotals = !notKnown(s.totalSales);
      const haveSupply = !notKnown(s.listings) && !notKnown(s.ticketsAvailable);
      const sig = JSON.stringify([s, c.sales.length, c.sales[0]]);
      if (sig !== lastSig) { lastSig = sig; stableSince = Date.now(); }
      const settled = Date.now() - stableSince >= 1200;

      const complete = haveTotals && haveSupply && c.sales.length > 0;
      const goodEnough = haveTotals && elapsed >= COMPLETE_BY;
      if (settled && (complete || goodEnough)) {
        const missing = missingFields(c);
        const deep = await collectDeep();
        // The outline travels only when something is missing: it exists to fix
        // the reader, and a complete read has nothing to fix.
        send({ type: "captured", capture: c, missing, deep, ...(missing.length ? { outline: outline() } : {}) });
        return;
      }
    }

    if (elapsed >= GIVE_UP) {
      send({
        type: "failed",
        message: state === "checkpoint"
          ? "Tikey's security check didn't finish. Open Tikey in this browser once yourself, then press Find again."
          : "The Tikey page didn't show its numbers in time.",
        diag: diagnostics(c),
      });
      return;
    }

    // A heartbeat to the tracker, which also keeps the extension's background
    // worker awake while it waits for this tab.
    if (Date.now() - lastProgress > 2500) {
      lastProgress = Date.now();
      send({
        type: "progress",
        message: state === "checkpoint" ? "Tikey is running its security check…" : c ? "Waiting for the numbers to load…" : "Loading the page…",
      });
    }
    await sleep(500);
  }
})();
