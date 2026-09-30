// ─────────────────────────────────────────────────────────────
// DeskTracker Market Capture — content script.
//
// Reads a Sales Tracker page that is ALREADY on screen and posts what it read
// to your own tracker. It fetches nothing, opens nothing, clicks nothing: the
// only pages it ever sees are the ones you opened yourself. That is the whole
// design. A script that walked the site on its own would be scraping, would
// show up as unusual traffic on your account, and would put the account you pay
// for at risk. This does not.
//
// It reads the rendered DOM rather than the site's API responses. A single-page
// app's internal JSON changes shape without warning and without any visible
// sign; the words under the numbers are what the site promises its users and
// they change far more slowly. So every value is found BY ITS LABEL —
// "Total Sales", "Floor Price" — never by a CSS class, which is generated and
// changes on every deploy.
//
// Nothing is parsed here. Raw strings go to the server, where the parsing is
// tested against fixtures and can be fixed with a deploy instead of asking you
// to reinstall an extension. See lib/market/parse.ts.
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

const text = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "");

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
      const whole = text(box);
      const rest = whole.replace(new RegExp(label, "i"), "").trim();
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
    // server needs to tell it apart from a genuine zero.
    if (v != null) stats[key] = v;
  }
  return stats;
}

/**
 * The Sales History table. Columns are located by their HEADER text, so a
 * reordered or newly inserted column moves the reader with it instead of
 * silently shifting every value one to the left.
 */
function readSales() {
  for (const table of document.querySelectorAll("table")) {
    const heads = [...table.querySelectorAll("thead th, thead td")].map((th) => text(th).toLowerCase());
    if (!heads.length) continue;
    const at = (...names) => heads.findIndex((h) => names.some((n) => h.includes(n)));
    const iPrice = at("price");
    const iQty = at("quantity", "qty");
    const iSection = at("section");
    const iSeat = at("row & seat", "row &amp; seat", "row and seat", "row");
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
        const lines = [...seatCell.querySelectorAll("*")]
          .map(text)
          .filter((t) => t.length > 0);
        const uniq = lines.filter((t, i) => lines.indexOf(t) === i && !lines.some((o, j) => j !== i && o.includes(t) && o !== t));
        if (uniq.length >= 2) {
          row = uniq[0];
          seats = uniq[1];
        } else {
          const parts = text(seatCell).split(/\s{2,}|\n/).filter(Boolean);
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
 * The event header. The name is the page's biggest heading; the rest sits under
 * it as date / venue / city, country.
 */
function readEvent() {
  const h = document.querySelector("h1, h2");
  const name = text(h);
  const url = location.href;

  // The id is whatever identifies the event in the URL: the last path segment,
  // or an ?id= parameter. Kept as-is — it only has to be stable, not pretty.
  const qs = new URLSearchParams(location.search);
  const fromQuery = qs.get("id") || qs.get("eventId") || qs.get("event");
  const segments = location.pathname.split("/").filter(Boolean);
  const sourceEventId = fromQuery || segments[segments.length - 1] || "";

  // Walk the few blocks after the heading for the date / venue / location trio.
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
        if (t && t !== name && t.length < 120) near.push(t);
      }
      if (near.length >= 3) break;
      node = node.parentElement;
    }
    for (const t of near) {
      if (!dateText && /\b(19|20)\d{2}\b/.test(t) && /[A-Za-z]{3}/.test(t)) dateText = t;
      else if (t.includes(",") && !venue && dateText) {
        const [c, ...rest] = t.split(",");
        city = c.trim();
        country = rest.join(",").trim();
      } else if (!venue && dateText) venue = t;
    }
  }

  return { sourceEventId, url, name, dateText, venue, city, country };
}

/** The currency selector, so the server doesn't have to guess from a symbol. */
function readCurrency() {
  const sel = document.querySelector("select");
  if (sel && /^[A-Z]{3}$/.test(sel.value || "")) return sel.value;
  const body = document.body ? document.body.innerText : "";
  const m = body.match(/\b(EUR|USD|GBP)\b/);
  return m ? m[1] : "";
}

function buildCapture() {
  const event = readEvent();
  if (!event.name || !event.sourceEventId) return null;
  const stats = readStats();
  const sales = readSales();
  // A page with neither a tile nor a sale row is not a Sales Tracker page (or
  // has not rendered yet). Sending it would create an empty event row.
  if (!Object.keys(stats).length && !sales.length) return null;
  return {
    source: "tikey",
    capturedAt: new Date().toISOString(),
    currency: readCurrency(),
    event,
    stats,
    sales,
  };
}

// ── sending ───────────────────────────────────────────────────────────
// The same page re-renders constantly (sorting, pagination, live updates) and
// each render would otherwise fire a capture. A signature of what was actually
// read suppresses the repeats without suppressing real change: when a new page
// of sales is opened, or a tile finally loads, the signature moves and it sends.

let lastSignature = "";
let timer = null;

function signature(c) {
  return JSON.stringify([c.event.sourceEventId, c.stats, c.sales.length, c.sales[0], c.sales[c.sales.length - 1]]);
}

async function send(capture) {
  const { endpoint, token } = await chrome.storage.sync.get(["endpoint", "token"]);
  if (!endpoint || !token) {
    console.info("[DeskTracker] not configured — open the extension's Options page.");
    return;
  }
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(capture),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Loud on purpose. A capture tool that fails quietly looks exactly like a
      // quiet market, and you would not find out for weeks.
      console.error("[DeskTracker] capture rejected:", res.status, out);
      lastSignature = "";
      return;
    }
    console.info(
      `[DeskTracker] captured "${out.event?.name ?? ""}" — ` +
        `${out.sales?.new ?? 0} new sale(s), ${out.sales?.known ?? 0} already known` +
        `${out.snapshot ? ", snapshot saved" : ", no snapshot (page still loading)"}`
    );
  } catch (e) {
    console.error("[DeskTracker] capture failed to send:", e);
    lastSignature = "";
  }
}

function maybeCapture() {
  const capture = buildCapture();
  if (!capture) return;
  const sig = signature(capture);
  if (sig === lastSignature) return;
  lastSignature = sig;
  send(capture);
}

/** Debounced, because a single interaction fires dozens of mutations. */
function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(maybeCapture, 1200);
}

new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });

// A single-page app changes the URL without reloading, so a new event has to be
// noticed by watching the URL rather than by waiting for a page load.
let lastPath = location.pathname + location.search;
setInterval(() => {
  const now = location.pathname + location.search;
  if (now !== lastPath) {
    lastPath = now;
    lastSignature = "";
    schedule();
  }
}, 1000);

schedule();
