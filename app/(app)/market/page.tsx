"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Signal, Summary, SummarySnapshot } from "@/lib/market/summary";
import MarketChart from "./MarketChart";

// ─────────────────────────────────────────────────────────────
// Market — what the resale market is doing for events you've looked at.
//
// Everything here is YOUR data: sales-tracker pages you opened with the capture
// extension installed, stored in your own tables. Paste a viagogo link to jump
// to an event, or pick one from the list.
//
// The page reads; it does not advise. Every figure is either a number off the
// captured page or a derivation from those numbers whose working is shown, and
// the Reading section says what the data shows rather than what to do about it.
//
// It fetches its own data rather than going through DashContext: market data is
// only needed here, and loading it for every page would slow the whole
// dashboard's first paint for the sake of one tab.
// ─────────────────────────────────────────────────────────────

type MarketEvent = {
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

type SaleRow = {
  price: number | null;
  qty: number | null;
  currency: string;
  section: string | null;
  seat_row: string | null;
  seats: string | null;
  sold_at_approx: string | null;
  precision: string | null;
};

type Detail = { event: MarketEvent; snapshots: SummarySnapshot[]; sales: SaleRow[]; summary: Summary };

type Found = { result: "found"; id: string; matchedBy: "id" | "name" };
type Resolve = Found | { result: "not_captured"; eventId: string | null; url: string } | { result: "unreadable" };

// Validated against the #161616 panel (dataviz validator, dark mode):
// sold/available CVD ΔE 26.8, average/floor CVD ΔE 17.3; all ≥ 3:1.
const C_SOLD = "#3987e5";
const C_AVAILABLE = "#d95926";
const C_AVERAGE = "#199e70";
const C_FLOOR = "#9085e9";

const SYMBOL: Record<string, string> = { EUR: "€", USD: "$", GBP: "£" };
function money(n: number | null | undefined, cur = "EUR"): string {
  if (n == null) return "—";
  const v = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return SYMBOL[cur] ? `${SYMBOL[cur]}${v}` : `${v} ${cur}`;
}
const int = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-US"));
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n * 100)} %`);

function ago(iso: string | null): string {
  if (!iso) return "never";
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 48) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function when(days: number | null): string {
  if (days == null) return "";
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}

/** The API's own error text, or a plain reason. The missing-table case gets its fix spelled out. */
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}
const isMissingTables = (msg: string | null) => !!msg && /schema cache|market_events|market_snapshots/i.test(msg);

export default function MarketPage() {
  const [events, setEvents] = useState<MarketEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [matchedBy, setMatchedBy] = useState<"id" | "name" | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [link, setLink] = useState("");
  const [finding, setFinding] = useState(false);
  const [findMsg, setFindMsg] = useState<ReactNode>(null);

  useEffect(() => {
    // An ?id= in the address opens that event directly, so a detail view can
    // be bookmarked or reopened from history.
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setSelected(id);
    getJson<MarketEvent[]>("/api/market/events")
      .then((list) => { setEvents(list); setError(null); })
      .catch((e: Error) => { setEvents([]); setError(e.message); });
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set("id", selected);
    else url.searchParams.delete("id");
    window.history.replaceState(null, "", url.toString());

    if (!selected) { setDetail(null); setDetailError(null); return; }
    let live = true;
    setDetail(null);
    setDetailError(null);
    getJson<Detail>(`/api/market/events/${selected}`)
      .then((d) => { if (live) setDetail(d); })
      .catch((e: Error) => { if (live) setDetailError(e.message); });
    return () => { live = false; };
  }, [selected]);

  function open(id: string, how: "id" | "name" | null = null) {
    setMatchedBy(how);
    setSelected(id);
    window.scrollTo({ top: 0 });
  }

  async function find(e: FormEvent) {
    e.preventDefault();
    const q = link.trim();
    if (!q) return;
    setFinding(true);
    setFindMsg(null);
    try {
      const r = await getJson<Resolve>(`/api/market/events?link=${encodeURIComponent(q)}`);
      if (r.result === "found") {
        open(r.id, r.matchedBy);
        setLink("");
      } else if (r.result === "not_captured") {
        setFindMsg(
          <>
            <strong>Not captured yet.</strong> Open this event once on the sales-tracker site with the
            capture extension installed, then search again.
            {r.eventId && <> <span className="nums">(viagogo E-{r.eventId})</span></>}
          </>
        );
      } else {
        setFindMsg(
          <>
            <strong>That isn’t a viagogo event link I can read.</strong> Expected something like{" "}
            <code>https://www.viagogo.com/…/E-151234567</code>.
          </>
        );
      }
    } catch (err) {
      setFindMsg(<><strong>Search failed.</strong> {(err as Error).message}</>);
    } finally {
      setFinding(false);
    }
  }

  return (
    <>
      <div className="toolbar market-toolbar">
        <h1>Market</h1>
        <form className="market-find" onSubmit={find}>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Paste a viagogo event link…"
            aria-label="viagogo event link"
            spellCheck={false}
          />
          <button className="btn btn-primary" disabled={finding || !link.trim()}>
            {finding ? "Finding…" : "Find"}
          </button>
        </form>
      </div>

      {findMsg && <div className="chart-notice market-msg">{findMsg}</div>}

      {isMissingTables(error) ? (
        <div className="chart-notice">
          <strong>The market tables don’t exist yet.</strong> Run <code>supabase/schema.sql</code> in the
          Supabase SQL editor once — it creates <code>market_events</code>, <code>market_snapshots</code> and{" "}
          <code>market_sales</code> — then reload this page.
        </div>
      ) : error ? (
        <div className="error-banner"><strong>Couldn’t load market data.</strong> {error}</div>
      ) : null}

      {selected ? (
        <EventDetail
          detail={detail}
          error={detailError}
          matchedBy={matchedBy}
          onBack={() => { setSelected(null); setMatchedBy(null); }}
        />
      ) : events == null ? (
        <div className="empty">Loading…</div>
      ) : !error && events.length === 0 ? (
        <NothingYet />
      ) : events.length > 0 ? (
        <EventList events={events} onOpen={(id) => open(id)} />
      ) : null}
    </>
  );
}

// ── The list ──────────────────────────────────────────────────────────

function EventList({ events, onOpen }: { events: MarketEvent[]; onOpen: (id: string) => void }) {
  // Upcoming first, soonest at the top; finished events sink to the bottom,
  // dimmed, instead of disappearing — their history is still worth having.
  const rows = useMemo(() => {
    const up = events.filter((e) => (e.summary.daysToEvent ?? 0) >= 0);
    const past = events.filter((e) => (e.summary.daysToEvent ?? 0) < 0);
    const byDate = (a: MarketEvent, b: MarketEvent) => (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999");
    return [...up.sort(byDate), ...past.sort(byDate).reverse()];
  }, [events]);

  return (
    <>
      {/* On a phone an eight-column table either scrolls sideways or wraps
          every event name onto five lines. Cards carry the same figures in a
          shape that fits; CSS shows one or the other. */}
      <div className="market-cards">
        {rows.map((e) => {
          const s = e.summary;
          const L = s.latest;
          const past = (s.daysToEvent ?? 0) < 0;
          return (
            <button key={e.id} className={"market-card" + (past ? " is-past" : "")} onClick={() => onOpen(e.id)}>
              <div className="market-card-head">
                <span className="market-name">{e.name}</span>
                <span className={"market-where" + (s.stale ? " is-stale" : "")}>{ago(e.last_captured_at)}</span>
              </div>
              <div className="market-where">
                {[e.event_date, when(s.daysToEvent), e.city].filter(Boolean).join(" · ")}
              </div>
              <div className="market-card-stats">
                <span><em>Sold</em> {int(L?.total_tickets)}</span>
                <span><em>24h</em> {int(L?.sales_24h)} <Pace momentum={s.derived.momentum} /></span>
                <span><em>Floor</em> {money(L?.floor_price, s.currency)}</span>
                <span><em>Avail</em> {L?.tickets_available == null ? "—" : int(L.tickets_available)}</span>
                <span><em>Sell-through</em> {pct(s.derived.sellThrough)}</span>
              </div>
            </button>
          );
        })}
      </div>

    <div className="table-wrap market-table-wrap">
      <table className="table market-table">
        <thead>
          <tr>
            <th>Event</th>
            <th>Date</th>
            <th className="amount-col">Sold</th>
            <th className="amount-col">Last 24h</th>
            <th className="amount-col">Floor / Avg</th>
            <th className="amount-col">Available</th>
            <th className="amount-col">Sell-through</th>
            <th>Captured</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const s = e.summary;
            const L = s.latest;
            const past = (s.daysToEvent ?? 0) < 0;
            return (
              <tr key={e.id} className={"market-row" + (past ? " is-past" : "")} onClick={() => onOpen(e.id)}
                  tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") onOpen(e.id); }}>
                <td>
                  <div className="market-name">{e.name}</div>
                  <div className="market-where">{[e.venue, e.city].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="date-cell">
                  <div className="nums">{e.event_date ?? "—"}</div>
                  <div className="market-where">{when(s.daysToEvent)}</div>
                </td>
                <td className="amount-col nums">
                  {int(L?.total_tickets)}
                  <div className="market-where">{int(L?.total_sales)} sales</div>
                </td>
                <td className="amount-col nums">
                  {int(L?.sales_24h)}
                  <div className="market-where"><Pace momentum={s.derived.momentum} /></div>
                </td>
                <td className="amount-col nums">
                  {money(L?.floor_price, s.currency)}
                  <div className="market-where">{money(L?.average_price, s.currency)}</div>
                </td>
                <td className="amount-col nums">
                  {L?.tickets_available == null ? <span className="market-where">not loaded</span> : int(L.tickets_available)}
                </td>
                <td className="amount-col nums">{pct(s.derived.sellThrough)}</td>
                <td className={"date-cell" + (s.stale ? " is-stale" : "")}>
                  {ago(e.last_captured_at)}
                  <div className="market-where">{e.captures} capture{e.captures === 1 ? "" : "s"}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

/** Pace against the event's own average, with a glyph so it never rests on colour alone. */
function Pace({ momentum }: { momentum: number | null }) {
  if (momentum == null) return <>—</>;
  const tone = momentum >= 1.3 ? "up" : momentum <= 0.6 ? "down" : "neutral";
  const glyph = tone === "up" ? "▲" : tone === "down" ? "▼" : "•";
  const word = tone === "up" ? "faster" : tone === "down" ? "slower" : "usual";
  return (
    // One decimal, the same as the Reading text — "0.44×" in a tile beside
    // "0.4×" in a sentence reads as two different measurements.
    <span className={`pace is-${tone}`} title={`${momentum}× its average daily pace`}>
      <span aria-hidden>{glyph}</span> {momentum.toFixed(1)}× · {word}
    </span>
  );
}

function NothingYet() {
  return (
    <div className="chart-card market-empty">
      <h2>No events captured yet</h2>
      <ol>
        <li>Install the capture extension from the <code>extension/</code> folder (its README has the steps).</li>
        <li>Open any event’s sales-tracker page as you normally would.</li>
        <li>It appears here — and every later visit adds a point to its history.</li>
      </ol>
      <p className="hint">
        This data has no archive: a tracker’s history starts the day it begins watching. The sooner events
        are captured, the more there is to compare later.
      </p>
    </div>
  );
}

// ── One event ─────────────────────────────────────────────────────────

function EventDetail({
  detail, error, matchedBy, onBack,
}: {
  detail: Detail | null;
  error: string | null;
  matchedBy: "id" | "name" | null;
  onBack: () => void;
}) {
  const back = <button className="btn btn-ghost btn-sm market-back" onClick={onBack}>← All events</button>;
  if (error) return <>{back}<div className="error-banner"><strong>Couldn’t load this event.</strong> {error}</div></>;
  if (!detail) return <>{back}<div className="empty">Loading…</div></>;

  const { event: e, snapshots, sales, summary: s } = detail;
  const L = s.latest;
  const cur = s.currency;
  const d = s.derived;
  const at = snapshots.map((x) => x.captured_at);

  return (
    <>
      {back}

      <div className="market-head">
        <h2>{e.name}</h2>
        <div className="market-meta">
          {[e.event_date, when(s.daysToEvent), e.venue, [e.city, e.country].filter(Boolean).join(", ")]
            .filter(Boolean).join(" · ")}
          {e.url && (
            <> · <a href={e.url} target="_blank" rel="noreferrer">sales tracker ↗</a></>
          )}
        </div>
      </div>

      {matchedBy === "name" && (
        <div className="chart-notice market-msg">
          <strong>Matched by name.</strong> Your link carried no event id this page knows, so it was matched on
          the words in it — check this is the event you meant.
        </div>
      )}
      {s.stale && (
        <div className="chart-notice market-msg">
          <strong>This data is {ago(s.capturedAt)}.</strong> Markets move daily — open the event on the
          sales-tracker site to refresh it.
        </div>
      )}

      {L && (
        <div className="kpis kpis-auto">
          <Kpi label="Sold" value={int(L.total_tickets)} sub={`${int(L.total_sales)} sales · ${d.ticketsPerSale ?? "—"} per sale`} />
          <Kpi label="Last 24h" value={int(L.sales_24h)} sub={<Pace momentum={d.momentum} />} />
          <Kpi label="Floor" value={money(L.floor_price, cur)} sub={`avg ${money(L.average_price, cur)}${d.spread ? ` · ${d.spread}×` : ""}`} />
          <Kpi label="Available" value={L.tickets_available == null ? "—" : int(L.tickets_available)}
               sub={L.tickets_available == null ? "not loaded at capture" : `${int(L.listings)} listings`} />
          <Kpi label="Sell-through" value={pct(d.sellThrough)} sub="of all tickets offered" />
          <Kpi label="Runway (est.)" value={d.runwayDays == null ? "—" : `~${Math.round(d.runwayDays)} d`}
               sub={s.daysToEvent != null && s.daysToEvent >= 0 ? `event ${when(s.daysToEvent)}` : "at the last day’s pace"} />
        </div>
      )}

      <div className="section-head"><h2>Reading</h2>
        <span className="hint" style={{ margin: 0 }}>what the numbers say — not what to do about them</span>
      </div>
      <SignalList signals={s.signals} />

      {s.change && s.change.hours > 0 && (
        <>
          <div className="section-head"><h2>Since your last look</h2>
            <span className="hint" style={{ margin: 0 }}>{Math.round(s.change.hours)}h between the last two captures</span>
          </div>
          <div className="market-change">
            <Delta label="Available" v={s.change.available} goodWhen="down" />
            <Delta label="Tickets sold" v={s.change.tickets} goodWhen="up" />
            <Delta label="Sales" v={s.change.sales} goodWhen="up" />
            <Delta label="Floor" v={s.change.floor} goodWhen="up" fmt={(n) => money(Math.abs(n), cur)} />
            <Delta label="Average" v={s.change.average} goodWhen="up" fmt={(n) => money(Math.abs(n), cur)} />
          </div>
        </>
      )}

      <div className="section-head"><h2>History</h2>
        <span className="hint" style={{ margin: 0 }}>from your own captures — each visit adds a point</span>
      </div>
      {snapshots.length < 2 ? (
        <div className="chart-notice">
          {snapshots.length === 0 ? "No capture with numbers yet." : "One capture so far."} History builds each
          time you open this event — the second visit draws the first line.
        </div>
      ) : (
        <>
          <div className="dash-charts">
            <MarketChart
              title="Tickets"
              sub="sold vs available"
              at={at}
              format={(n) => int(n)}
              series={[
                { key: "sold", label: "Sold", color: C_SOLD, values: snapshots.map((x) => x.total_tickets) },
                { key: "available", label: "Available", color: C_AVAILABLE, values: snapshots.map((x) => x.tickets_available) },
              ]}
            />
            <MarketChart
              title="Price"
              sub={`${cur} · average vs floor`}
              at={at}
              format={(n) => money(n, cur)}
              series={[
                { key: "average", label: "Average", color: C_AVERAGE, values: snapshots.map((x) => x.average_price) },
                { key: "floor", label: "Floor", color: C_FLOOR, values: snapshots.map((x) => x.floor_price) },
              ]}
            />
          </div>
          {/* The same numbers as a table: every value on the charts is
              reachable without hovering. */}
          <details className="market-captures">
            <summary>All {snapshots.length} captures as a table</summary>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Captured</th>
                    <th className="amount-col">Sold</th>
                    <th className="amount-col">Sales</th>
                    <th className="amount-col">24h</th>
                    <th className="amount-col">Available</th>
                    <th className="amount-col">Listings</th>
                    <th className="amount-col">Floor</th>
                    <th className="amount-col">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {[...snapshots].reverse().map((x) => (
                    <tr key={x.captured_at}>
                      <td className="date-cell nums">{x.captured_at.slice(0, 16).replace("T", " ")}</td>
                      <td className="amount-col nums">{int(x.total_tickets)}</td>
                      <td className="amount-col nums">{int(x.total_sales)}</td>
                      <td className="amount-col nums">{int(x.sales_24h)}</td>
                      <td className="amount-col nums">{int(x.tickets_available)}</td>
                      <td className="amount-col nums">{int(x.listings)}</td>
                      <td className="amount-col nums">{money(x.floor_price, x.currency)}</td>
                      <td className="amount-col nums">{money(x.average_price, x.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      <div className="section-head"><h2>Captured sales</h2>
        <span className="hint" style={{ margin: 0 }}>
          {sales.length} recorded · times are approximate, read from “9h ago”
        </span>
      </div>
      {(s.prices || s.topSections.length > 0) && (
        <div className="market-bands">
          {s.prices && (
            <span>
              Per ticket: p25 <strong className="nums">{money(s.prices.p25, cur)}</strong> · median{" "}
              <strong className="nums">{money(s.prices.median, cur)}</strong> · p75{" "}
              <strong className="nums">{money(s.prices.p75, cur)}</strong>
              <span className="market-where"> ({s.prices.n} tickets)</span>
            </span>
          )}
          {s.topSections.length > 0 && (
            <span>
              Busiest sections:{" "}
              {s.topSections.map((t, i) => (
                <span key={t.section}>
                  {i > 0 && " · "}
                  {/* The colon keeps a section number from running into the
                      count: "217 14 tix" read as one number. */}
                  <strong>{t.section}</strong>: {t.tickets} tix{t.median != null && ` @ ${money(t.median, cur)}`}
                </span>
              ))}
            </span>
          )}
        </div>
      )}
      {sales.length === 0 ? (
        <div className="empty" style={{ padding: "28px 0" }}>No sale rows captured for this event yet.</div>
      ) : (
        <SalesTable sales={sales} />
      )}
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

const ICON: Record<Signal["tone"], string> = { up: "▲", down: "▼", neutral: "•", warn: "!" };

function SignalList({ signals }: { signals: Signal[] }) {
  if (!signals.length) return <div className="hint">Nothing to read yet.</div>;
  return (
    <ul className="signal-list">
      {signals.map((g, i) => (
        <li key={i} className={`signal is-${g.tone}`}>
          <span className="signal-icon" aria-hidden>{ICON[g.tone]}</span>
          <span>{g.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Delta({
  label, v, goodWhen, fmt,
}: {
  label: string;
  v: number | null;
  goodWhen: "up" | "down";
  fmt?: (n: number) => string;
}) {
  if (v == null) return null;
  const good = v === 0 ? null : (v > 0) === (goodWhen === "up");
  const shown = fmt ? fmt(v) : Math.abs(Math.round(v)).toLocaleString("en-US");
  return (
    <div className="kpi market-delta">
      <div className="kpi-label">{label}</div>
      <div className={"kpi-value" + (good == null ? "" : good ? " profit-pos" : " profit-neg")}>
        {v === 0 ? "±0" : `${v > 0 ? "+" : "−"}${shown}`}
      </div>
    </div>
  );
}

// Enough to see the recent pattern without turning the page into the table.
const PAGE = 25;

function SalesTable({ sales }: { sales: SaleRow[] }) {
  const [shown, setShown] = useState(PAGE);
  const rows = sales.slice(0, shown);
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          {/* Where first, then how many and for how much, then when — the
              order the source table reads in, with the figures together on
              the right where they align. */}
          <thead>
            <tr>
              <th>Section</th>
              <th>Row</th>
              <th>Seats</th>
              <th className="amount-col">Qty</th>
              <th className="amount-col">Price</th>
              <th>Sold</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.section ?? "—"}</td>
                <td>{r.seat_row ?? "—"}</td>
                <td className="nums market-seats">{r.seats ?? "—"}</td>
                <td className="amount-col nums">{r.qty ?? "—"}</td>
                <td className="amount-col nums">{money(r.price, r.currency)}</td>
                <td className="date-cell">{soldWhen(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sales.length > shown && (
        <button className="btn btn-ghost btn-sm market-more" onClick={() => setShown(shown + PAGE)}>
          {sales.length - shown > PAGE
            ? `Show ${PAGE} more · ${sales.length - shown} left`
            : `Show the last ${sales.length - shown}`}
        </button>
      )}
    </>
  );
}

/** "~9h ago" for a recent, hour-precise time; the date once it's older or coarser. */
function soldWhen(r: SaleRow): string {
  if (!r.sold_at_approx) return "—";
  const h = (Date.now() - Date.parse(r.sold_at_approx)) / 3_600_000;
  if ((r.precision === "hour" || r.precision === "minute" || r.precision === "exact") && h < 48) {
    return h < 1 ? "~just now" : `~${Math.round(h)}h ago`;
  }
  return `~${r.sold_at_approx.slice(0, 10)}`;
}
