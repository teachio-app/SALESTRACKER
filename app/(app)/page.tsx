"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  filterByPeriod, filterEntriesByPeriod, openInvestment, awaitingPayout,
  realizedProfit, todoCounts, todayISO, signedAmount,
  type Ticket,
} from "@/lib/supabase";
import { buildMonths, monthTotals, undatedInvestment, type MonthBucket } from "@/lib/monthly";
import ProfitChart from "@/app/ProfitChart";
import { useDash } from "./DashContext";
import PeriodTabs from "./PeriodTabs";

// ─────────────────────────────────────────────────────────────
// Overview — the page the logo leads to.
//
// It answers "how am I doing" in one screen and then lets you dig: the month
// table is the interactive part, and every row opens to show the actual sales
// and cash entries behind its numbers. Nothing here is a new source of truth —
// the months come from lib/monthly.ts, the same function the charts use, so the
// two can never tell different stories about the same month.
// ─────────────────────────────────────────────────────────────

const money = (n: number) => (n === 0 ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
const signed = (n: number) => (n === 0 ? "—" : `${n > 0 ? "+" : "−"}${Math.abs(Math.round(n)).toLocaleString("en-US")}`);
const tone = (n: number) => (n > 0 ? "profit-pos" : n < 0 ? "profit-neg" : "");

export default function OverviewPage() {
  const { tickets, entries, todos, loading, error, period } = useDash();
  const [open, setOpen] = useState<string | null>(null);

  const inPeriod = useMemo(() => filterByPeriod(tickets, period), [tickets, period]);
  const cash = useMemo(() => filterEntriesByPeriod(entries, period), [entries, period]);
  // Newest month first: the current one is what you came to look at.
  const months = useMemo(
    () => [...buildMonths(inPeriod, cash)].reverse(),
    [inPeriod, cash]
  );
  const totals = useMemo(() => monthTotals(months), [months]);

  // Balances, deliberately over EVERY row rather than the period — money still
  // out is out regardless of the window, same as on the Events page.
  const invested = useMemo(() => openInvestment(tickets), [tickets]);
  // Bought, but with no purchase date to place it in a month — named rather
  // than spread across months it didn't happen in.
  const undated = useMemo(() => undatedInvestment(inPeriod), [inPeriod]);
  const nowKey = todayISO().slice(0, 7);
  const awaiting = useMemo(() => awaitingPayout(tickets), [tickets]);
  const todo = useMemo(() => todoCounts(todos, todayISO()), [todos]);
  const problems = tickets.filter((t) => t.flagged).length;
  const unlinked = tickets.filter((t) => t.needs_review).length;

  return (
    <>
      <div className="toolbar">
        <h1>Overview</h1>
        <PeriodTabs />
      </div>

      {error && (
        <div className="error-banner"><strong>Couldn’t load your rows.</strong> {error}</div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : error ? null : (
        <>
          {/* Headline: what the period made, and what is still out. */}
          <div className="kpis kpis-auto">
            <div className="kpi">
              <div className="kpi-label">Net this period</div>
              <div className={"kpi-value " + tone(totals.net)}>{signed(totals.net)} EUR</div>
              <div className="kpi-sub">
                {money(totals.ticketProfit)} tickets
                {totals.cashIn - totals.cashOut !== 0 && ` · ${signed(totals.cashIn - totals.cashOut)} cash`}
              </div>
            </div>
            {/* Money going OUT this period — the counterpart to Net, and the
                reason a busy buying month no longer looks like a quiet one. */}
            <div className="kpi" title="Batches whose purchase date is recorded. Rows without one can't be placed in a month — they're counted separately below.">
              <div className="kpi-label">Bought this period</div>
              <div className="kpi-value">{money(totals.spent)} EUR</div>
              <div className="kpi-sub">
                {totals.purchases} batch{totals.purchases === 1 ? "" : "es"}
                {undated.rows > 0 && (
                  <span className="stat-caveat"> · {money(undated.total)} undated</span>
                )}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Invested now</div>
              <div className="kpi-value">{money(invested.total)} EUR</div>
              <div className="kpi-sub">all rows, not the period</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Awaiting payout</div>
              <div className="kpi-value">{money(awaiting.total)} EUR</div>
              <div className="kpi-sub">{awaiting.count} row{awaiting.count === 1 ? "" : "s"} unpaid</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Sold this period</div>
              <div className="kpi-value">{totals.sales || "—"}</div>
              <div className="kpi-sub">{money(totals.revenue)} EUR revenue</div>
            </div>
          </div>

          {/* Anything that needs a person. Only shown when there IS something —
              a row of permanent zeroes teaches you to stop reading it. */}
          {(unlinked > 0 || problems > 0 || todo.overdue > 0 || invested.unpriced > 0) && (
            <div className="needs-row">
              {unlinked > 0 && (
                <Link className="needs-chip" href="/review">
                  <strong>{unlinked}</strong> sale{unlinked === 1 ? "" : "s"} to link
                </Link>
              )}
              {invested.unpriced > 0 && (
                <Link className="needs-chip is-warn" href="/events">
                  <strong>{invested.unpriced}</strong> without a buy price
                </Link>
              )}
              {problems > 0 && (
                <Link className="needs-chip is-bad" href="/events">
                  <strong>{problems}</strong> flagged problem{problems === 1 ? "" : "s"}
                </Link>
              )}
              {todo.overdue > 0 && (
                <Link className="needs-chip is-bad" href="/todo">
                  <strong>{todo.overdue}</strong> to-do past deadline
                </Link>
              )}
            </div>
          )}

          <ProfitChart tickets={inPeriod} entries={cash} includeCash />

          {/* ── Month by month, click to open ── */}
          <div className="section-head">
            <h2>Month by month</h2>
            <span className="hint" style={{ margin: 0 }}>click a month to see what’s in it</span>
          </div>

          {/* Say why the Bought column is thin, instead of letting it look
              broken — and say what fixes it. */}
          {undated.rows > 0 && (
            <div className="chart-notice" style={{ marginBottom: 10 }}>
              <strong>{money(undated.total)} EUR</strong> of buying isn’t in the months below:{" "}
              {undated.rows} row{undated.rows === 1 ? " has" : "s have"} no <strong>purchase date</strong>,
              and guessing one would put money in months it never moved in. Fill the date in on a row
              (Edit → Purchase date) and it appears here.
            </div>
          )}

          {months.length === 0 ? (
            <div className="empty">Nothing in this period yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                {/* Two different clocks, on purpose: Invested is the month the
                    money went out, everything to its right is the month the
                    EVENT is played. A sale in August for a match next June
                    belongs to June — that's when the result happened. */}
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="amount-col">Invested</th>
                    <th className="amount-col">Sales</th>
                    <th className="amount-col">Revenue</th>
                    <th className="amount-col">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <MonthRows key={m.key} m={m} now={nowKey} open={open === m.key}
                               onToggle={() => setOpen(open === m.key ? null : m.key)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

function MonthRows({
  m, now, open, onToggle,
}: { m: MonthBucket; now: string; open: boolean; onToggle: () => void }) {
  const empty = m.sales === 0 && m.entries.length === 0 && m.purchases === 0;
  // Sales sit on their EVENT month, so months that haven't happened yet appear
  // above the current one. Without a marker the top row reads as "now" and this
  // month looks empty — say which row is today.
  const when = m.key === now ? "now" : m.key > now ? "future" : "past";
  return (
    <>
      <tr className={`month-row is-${when}` + (open ? " is-open" : "") + (empty ? " is-empty" : "")}
          onClick={empty ? undefined : onToggle}>
        <td>
          <span className="month-caret">{empty ? "" : open ? "▾" : "▸"}</span> {m.label}
          {when === "now" && <span className="month-tag">this month</span>}
          {when === "future" && <span className="month-tag is-ahead">upcoming</span>}
        </td>
        <td className="nums amount-col amount-out" title={m.purchases ? `${m.purchases} batch(es)` : undefined}>
          {m.invested ? `−${money(m.invested)}` : "—"}
        </td>
        <td className="nums amount-col">{m.sales || "—"}</td>
        <td className="nums amount-col">{money(m.revenue)}</td>
        <td className={"nums amount-col " + tone(m.ticketProfit)}><strong>{signed(m.ticketProfit)}</strong></td>
      </tr>

      {open && (
        <tr className="month-detail">
          <td colSpan={5}>
            {m.purchaseRows.length > 0 && (
              <div className="detail-block">
                <div className="detail-head">Bought — {money(m.invested)} EUR</div>
                {[...m.purchaseRows]
                  .sort((a, b) => (b.purchase_date ?? "").localeCompare(a.purchase_date ?? ""))
                  .map((t: Ticket) => (
                    <div className="detail-line" key={t.id}>
                      <span className="detail-when nums">{(t.purchase_date ?? t.created_at ?? "").slice(0, 10)}</span>
                      <span className="detail-what">{t.event_name}</span>
                      <span className="detail-qty nums">{t.qty_sold}/{t.qty_total}</span>
                      <span className="nums amount-out">−{t.buy_price.toFixed(0)}</span>
                      {/* Says whether that money has come back yet. */}
                      <span className={"nums " + (t.qty_sold >= t.qty_total ? "unknown" : "")}>
                        {t.qty_sold === 0 ? "unsold" : t.qty_sold < t.qty_total ? "part sold" : "sold"}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            {m.tickets.length > 0 && (
              <div className="detail-block">
                {/* Dated by the EVENT, matching the row above it. */}
                <div className="detail-head">Events this month — {m.sales} sold</div>
                {[...m.tickets]
                  .sort((a, b) => (a.event_date ?? "").localeCompare(b.event_date ?? ""))
                  .map((t: Ticket) => (
                    <div className="detail-line" key={t.id}>
                      <span className="detail-when nums">{(t.event_date ?? "").slice(0, 10)}</span>
                      <span className="detail-what">{t.event_name}</span>
                      <span className="detail-qty nums">{t.qty_sold}/{t.qty_total}</span>
                      <span className="nums">{t.sell_price.toFixed(0)}</span>
                      <span className="nums unknown">−{t.buy_price.toFixed(0)}</span>
                      <span className={"nums " + tone(realizedProfit(t))}>{signed(realizedProfit(t))}</span>
                    </div>
                  ))}
              </div>
            )}
            {/* Cash has no column any more, but it's still worth seeing when a
                month is opened — it just doesn't belong in a table about
                tickets bought and events played. */}
            {m.entries.length > 0 && (
              <div className="detail-block">
                <div className="detail-head">Cashflow</div>
                {[...m.entries]
                  .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
                  .map((e) => (
                    <div className="detail-line" key={e.id}>
                      <span className="detail-when nums">{e.occurred_at}</span>
                      <span className="detail-what">{e.description}</span>
                      <span className={"nums " + (e.kind === "expense" ? "amount-out" : "amount-in")}>
                        {signed(signedAmount(e))} {e.currency}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
