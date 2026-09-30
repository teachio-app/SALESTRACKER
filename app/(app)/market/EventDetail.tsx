"use client";

import { useState, type CSSProperties } from "react";
import MarketChart from "./MarketChart";
import { ago, int, localStamp, longDate, money, pct, soldWhen, when, type Detail, type SaleRow } from "./format";
import { Chip, HUE, Icon, PacePill, RunwayBar, SellThroughBar, SignalList, Stat } from "./ui";

// ─────────────────────────────────────────────────────────────
// One event, read top to bottom in the order the questions come:
//   what is it and when → how much has sold, ever and today → price and supply
//   → what that adds up to → what changed → the history → the sales themselves.
// ─────────────────────────────────────────────────────────────

export default function EventDetail({
  detail, error, matchedBy, onBack, onRefresh,
}: {
  detail: Detail | null;
  error: string | null;
  matchedBy: "id" | "name" | null;
  onBack: () => void;
  /** Present when the extension is installed and idle. */
  onRefresh: ((vggId: string) => void) | null;
}) {
  const back = <button className="btn btn-ghost btn-sm" onClick={onBack}>← All events</button>;
  if (error) return <>{back}<div className="error-banner market-gap"><strong>Couldn’t load this event.</strong> {error}</div></>;
  if (!detail) return <>{back}<div className="empty">Loading…</div></>;

  const { event: e, snapshots, sales, summary: s } = detail;
  const L = s.latest;
  const cur = s.currency;
  const d = s.derived;
  const vggId = e.vgg_event_id;
  const where = [e.venue, [e.city, e.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ");

  return (
    <>
      <div className="market-detail-bar">
        {back}
        <div className="market-actions">
          {e.url && (
            <a className="btn btn-ghost btn-sm" href={e.url} target="_blank" rel="noreferrer">
              {Icon.external} Tikey
            </a>
          )}
          {vggId && (
            <button className="btn btn-primary btn-sm" disabled={!onRefresh} onClick={() => onRefresh?.(vggId)}
                    title={onRefresh ? "Read this event from Tikey again" : "Needs the DeskTracker × Tikey extension"}>
              {Icon.refresh} Refresh from Tikey
            </button>
          )}
        </div>
      </div>

      {/* ── what and when ── */}
      <header className="market-hero">
        <h2>{e.name}</h2>
        <div className="market-chips">
          {e.event_date ? (
            <>
              <Chip icon={Icon.calendar}>{longDate(e.event_date)}</Chip>
              <Chip icon={Icon.hourglass} tone={s.daysToEvent != null && s.daysToEvent < 0 ? "muted" : "accent"}>
                {when(s.daysToEvent)}
              </Chip>
            </>
          ) : (
            <Chip icon={Icon.calendar} tone="warn">date not read</Chip>
          )}
          {where && <Chip icon={Icon.pin}>{where}</Chip>}
          <Chip icon={Icon.clock} tone={s.stale ? "warn" : "muted"}>
            updated {ago(s.capturedAt)} · {snapshots.length} read{snapshots.length === 1 ? "" : "s"}
          </Chip>
        </div>
      </header>

      {matchedBy === "name" && (
        <div className="chart-notice market-msg">
          <strong>Matched by name.</strong> Your link carried no event id this page knows, so it was matched on
          the words in it — check this is the event you meant.
        </div>
      )}
      {s.stale && (
        <div className="chart-notice market-msg">
          <strong>This data is {ago(s.capturedAt)}.</strong> Markets move daily — press Refresh from Tikey.
        </div>
      )}

      {L && (
        <>
          {/* ── how much has sold: ever, and in the last day ── */}
          <div className="stat-grid is-hero">
            <Stat hero hue={HUE.sold} icon={Icon.ticket} label="Sold · all time"
                  value={<>{int(L.total_tickets)} <small>tickets</small></>}
                  sub={
                    <>
                      in <strong>{int(L.total_sales)}</strong> sales
                      {d.ticketsPerSale != null && <> · {d.ticketsPerSale} per sale</>}
                      {L.first_sale && <> · since {longDate(L.first_sale)}{d.daysSelling != null && ` (${d.daysSelling} d)`}</>}
                    </>
                  } />
            <Last24h s={s} />
          </div>

          {/* ── price and supply ── */}
          <div className="stat-grid">
            <Stat hue={HUE.floor} icon={Icon.tag} label="Floor price" value={money(L.floor_price, cur)}
                  sub="cheapest listing now" />
            <Stat hue={HUE.average} icon={Icon.scale} label="Average price" value={money(L.average_price, cur)}
                  sub={d.spread != null ? <>{d.spread}× the floor</> : "per ticket sold"} />
            <Stat hue={HUE.available} icon={Icon.layers} label="Available now"
                  value={L.tickets_available == null ? "—" : <>{int(L.tickets_available)} <small>tickets</small></>}
                  sub={L.tickets_available == null ? "not shown on the page" : `in ${int(L.listings)} listings`} />
            <Stat hue={HUE.sold} icon={Icon.pie} label="Sell-through" value={pct(d.sellThrough)}
                  sub="of every ticket offered has sold">
              <SellThroughBar sold={L.total_tickets} available={L.tickets_available} />
              <div className="meter-legend">
                <span><i style={{ background: HUE.sold }} /> sold {int(L.total_tickets)}</span>
                <span><i style={{ background: HUE.available }} /> available {int(L.tickets_available)}</span>
              </div>
            </Stat>
          </div>

          {d.runwayDays != null && s.daysToEvent != null && s.daysToEvent > 0 && (
            <div className="stat stat-wide" style={{ "--hue": HUE.available } as CSSProperties}>
              <div className="stat-head">
                <span className="stat-icon">{Icon.hourglass}</span>
                <span className="stat-label">Runway (estimate)</span>
              </div>
              <div className="runway-line">
                <span className="stat-value">~{Math.round(d.runwayDays)} <small>days</small></span>
                <span className="stat-sub">
                  of supply at the last day’s pace — the event is in <strong>{s.daysToEvent} days</strong>.
                  {d.runwayDays >= s.daysToEvent ? " At this pace it outlasts the event." : " At this pace it runs out first."}
                </span>
              </div>
              <RunwayBar runway={d.runwayDays} daysLeft={s.daysToEvent} />
            </div>
          )}
        </>
      )}

      {/* ── what it adds up to ── */}
      <div className="section-head"><h2>Reading</h2>
        <span className="hint" style={{ margin: 0 }}>what the numbers say — not what to do about them</span>
      </div>
      <SignalList signals={s.signals} />

      {s.change && s.change.hours > 0 && (
        <>
          <div className="section-head"><h2>Since your last read</h2>
            <span className="hint" style={{ margin: 0 }}>{Math.round(s.change.hours)}h between the last two reads</span>
          </div>
          <div className="market-change">
            <Delta label="Available" v={s.change.available} strongWhen="down" hue={HUE.available} />
            <Delta label="Tickets sold" v={s.change.tickets} strongWhen="up" hue={HUE.sold} />
            <Delta label="Sales" v={s.change.sales} strongWhen="up" hue={HUE.sold} />
            <Delta label="Floor" v={s.change.floor} strongWhen="up" hue={HUE.floor} fmt={(n) => money(Math.abs(n), cur)} />
            <Delta label="Average" v={s.change.average} strongWhen="up" hue={HUE.average} fmt={(n) => money(Math.abs(n), cur)} />
          </div>
        </>
      )}

      {/* ── history ── */}
      <div className="section-head"><h2>History</h2>
        <span className="hint" style={{ margin: 0 }}>from your own reads — each Refresh adds a point</span>
      </div>
      {snapshots.length < 2 ? (
        <div className="chart-notice">
          {snapshots.length === 0 ? "No read with numbers yet." : "One read so far."} Press <strong>Refresh from
          Tikey</strong> later — the second read draws the first line.
        </div>
      ) : (
        <>
          <div className="dash-charts">
            <MarketChart
              title="Tickets"
              sub="sold vs available"
              at={snapshots.map((x) => x.captured_at)}
              format={(n) => int(n)}
              series={[
                { key: "sold", label: "Sold", color: HUE.sold, values: snapshots.map((x) => x.total_tickets) },
                { key: "available", label: "Available", color: HUE.available, values: snapshots.map((x) => x.tickets_available) },
              ]}
            />
            <MarketChart
              title="Price"
              sub={`${cur} · average vs floor`}
              at={snapshots.map((x) => x.captured_at)}
              format={(n) => money(n, cur)}
              series={[
                { key: "average", label: "Average", color: HUE.average, values: snapshots.map((x) => x.average_price) },
                { key: "floor", label: "Floor", color: HUE.floor, values: snapshots.map((x) => x.floor_price) },
              ]}
            />
          </div>
          {/* The same numbers as a table: every value on the charts is
              reachable without hovering. */}
          <details className="market-captures">
            <summary>All {snapshots.length} reads as a table</summary>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Read</th>
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
                      <td className="date-cell nums">{localStamp(x.captured_at)}</td>
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

      {/* ── the sales themselves ── */}
      <div className="section-head"><h2>Recent sales</h2>
        <span className="hint" style={{ margin: 0 }}>
          {sales.length} recorded from your reads · times are approximate, read from “9h ago”
        </span>
      </div>
      {(s.prices || s.topSections.length > 0) && (
        <div className="market-bands">
          {s.prices && (
            <div className="band-card">
              <div className="band-title">Price per ticket</div>
              <div className="band-row">
                <span><em>low 25 %</em> {money(s.prices.p25, cur)}</span>
                <span className="band-mid"><em>median</em> {money(s.prices.median, cur)}</span>
                <span><em>high 25 %</em> {money(s.prices.p75, cur)}</span>
              </div>
              <div className="band-note">{s.prices.n} tickets</div>
            </div>
          )}
          {s.topSections.length > 0 && (
            <div className="band-card">
              <div className="band-title">Busiest sections</div>
              <div className="band-row">
                {s.topSections.map((t) => (
                  <span key={t.section}>
                    <span className="sec-chip">{t.section}</span> {t.tickets} tix
                    {t.median != null && <em> @ {money(t.median, cur)}</em>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {sales.length === 0 ? (
        <div className="empty" style={{ padding: "28px 0" }}>No sale rows read for this event yet.</div>
      ) : (
        <SalesTable sales={sales} />
      )}
    </>
  );
}

/** Sold in the last day: the page's tile, or a count of captured rows when it's missing. */
function Last24h({ s }: { s: Detail["summary"] }) {
  const d = s.derived;
  const c = d.captured24h;
  const lowerBound = d.sales24h == null && c != null && c.sales > 0 && !c.complete;
  return (
    <Stat hero hue={HUE.day} icon={Icon.bolt} label="Sold · last 24 hours"
          value={
            d.sales24h != null ? <>{int(d.sales24h)} <small>sales</small></>
            : lowerBound ? <>≥ {int(c!.sales)} <small>sales</small></>
            : "—"
          }
          sub={
            d.sales24h != null ? (
              <>
                {d.tickets24hEst != null && <>≈ <strong>{int(d.tickets24hEst)}</strong> tickets · </>}
                {d.avgSalesPerDay != null && <>usually {d.avgSalesPerDay} sales/day</>}
                {d.sales24hSource === "captured" && <> · counted from recorded sales</>}
              </>
            ) : lowerBound ? (
              <>at least — the recorded sales only reach back part of the day ({int(c!.tickets)} tickets so far)</>
            ) : (
              <>Tikey’s 24h figure wasn’t on the page</>
            )
          }>
      <div className="stat-foot"><PacePill momentum={d.momentum} /></div>
    </Stat>
  );
}

function Delta({
  label, v, strongWhen, hue, fmt,
}: {
  label: string;
  v: number | null;
  strongWhen: "up" | "down";
  hue: string;
  fmt?: (n: number) => string;
}) {
  if (v == null) return null;
  const strong = v === 0 ? null : (v > 0) === (strongWhen === "up");
  const shown = fmt ? fmt(v) : Math.abs(Math.round(v)).toLocaleString("en-US");
  return (
    <div className="delta" style={{ "--hue": hue } as CSSProperties}>
      <div className="delta-label">{label}</div>
      <div className={"delta-value" + (strong == null ? "" : strong ? " is-up" : " is-down")}>
        <span aria-hidden>{v === 0 ? "●" : v > 0 ? "▲" : "▼"}</span> {v === 0 ? "no change" : `${v > 0 ? "+" : "−"}${shown}`}
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
        <table className="table market-sales">
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
                <td><span className="sec-chip">{r.section ?? "—"}</span></td>
                <td className="nums">{r.seat_row ?? "—"}</td>
                <td className="nums market-seats">{r.seats ?? "—"}</td>
                <td className="amount-col"><span className="qty-chip">×{r.qty ?? "?"}</span></td>
                <td className="amount-col nums price-cell">{money(r.price, r.currency)}</td>
                <td className="date-cell sold-cell">{Icon.clock} {soldWhen(r)}</td>
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
