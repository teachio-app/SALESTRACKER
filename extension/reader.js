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
 * The tiles are a number with its label underneath. Find the element whose own
 * text IS the label, then walk up to the box that holds both and take the part
 * that isn't the label.
 *
 * "Own text" matters: without it, a container holding every tile also "contains"
 * the words "Total Sales", and the match would return the whole strip.
 */
function readTile(label) {
  const wanted = label.toLowerCase();
  const nodes = document.querySelectorAll("div, span, p, dt, dd, h1, h2, h3, h4, h5, h6, small, label");
  for (const node of nodes) {
    if (text(node).toLowerCase() !== wanted) continue;
    let box = node.parentElement;
    for (let up = 0; up < 3 && box; up++) {
      const rest = text(box).replace(new RegExp(label, "i"), "").trim();
      // A tile holds the label and one value. Anything much longer is a
      // container that swallowed its neighbours.
      if (rest && rest.length <= 40) return rest;
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

  // The date / venue / "City, Country" lines sit under the heading.
  let dateText = "";
  let venue = "";
  let city = "";
  let country = "";
  if (h) {
    const near = [];
    let node = h.parentElement;
    for (let up = 0; up < 3 && node; up++) {
      for (const el of node.children) {
        const t = text(el);
        if (t && t !== name && t.length < 120 && !near.includes(t)) near.push(t);
      }
      if (near.length >= 3) break;
      node = node.parentElement;
    }
    for (const t of near) {
      if (!dateText && /\b(19|20)\d{2}\b/.test(t) && /[A-Za-z]{3}/.test(t)) dateText = t;
      else if (dateText && !venue && !t.includes(",")) venue = t;
      else if (dateText && !city && t.includes(",")) {
        const [c, ...rest] = t.split(",");
        city = c.trim();
        country = rest.join(",").trim();
      }
    }
  }

  return { sourceEventId, url: location.href, name, dateText, venue, city, country, vggUrl: readVggLink(h) };
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
        send({ type: "captured", capture: c });
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
