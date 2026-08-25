"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  filterByPeriod, filterEntriesByPeriod, openInvestment, awaitingPayout,
  realizedProfit, todoCounts, todayISO, signedAmount,
  type Ticket,
} from "@/lib/supabase";
import { buildMonths, monthTotals, type MonthBucket } from "@/lib/monthly";
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
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">Net this period</div>
              <div className={"kpi-value " + tone(totals.net)}>{signed(totals.net)} EUR</div>
              <div className="kpi-sub">
                {money(totals.ticketProfit)} tickets
                {totals.cashIn - totals.cashOut !== 0 && ` · ${signed(totals.cashIn - totals.cashOut)} cash`}
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

          {months.length === 0 ? (
            <div className="empty">Nothing in this period yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="amount-col">Sales</th>
                    <th className="amount-col">Revenue</th>
                    <th className="amount-col">Cost</th>
                    <th className="amount-col">Ticket profit</th>
                    <th className="amount-col">Cash in</th>
                    <th className="amount-col">Cash out</th>
                    <th className="amount-col">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => (
                    <MonthRows key={m.key} m={m} open={open === m.key}
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

function MonthRows({ m, open, onToggle }: { m: MonthBucket; open: boolean; onToggle: () => void }) {
  const empty = m.sales === 0 && m.entries.length === 0;
  return (
    <>
      <tr className={"month-row" + (open ? " is-open" : "") + (empty ? " is-empty" : "")}
          onClick={empty ? undefined : onToggle}>
        <td>
          <span className="month-caret">{empty ? "" : open ? "▾" : "▸"}</span> {m.label}
        </td>
        <td className="nums amount-col">{m.sales || "—"}</td>
        <td className="nums amount-col">{money(m.revenue)}</td>
        <td className="nums amount-col">{money(m.cost)}</td>
        <td className={"nums amount-col " + tone(m.ticketProfit)}>{signed(m.ticketProfit)}</td>
        <td className="nums amount-col amount-in">{m.cashIn ? `+${money(m.cashIn)}` : "—"}</td>
        <td className="nums amount-col amount-out">{m.cashOut ? `−${money(m.cashOut)}` : "—"}</td>
        <td className={"nums amount-col " + tone(m.net)}><strong>{signed(m.net)}</strong></td>
      </tr>

      {open && (
        <tr className="month-detail">
          <td colSpan={8}>
            {m.tickets.length > 0 && (
              <div className="detail-block">
                <div className="detail-head">Sales</div>
                {[...m.tickets]
                  .sort((a, b) => (b.sold_at ?? "").localeCompare(a.sold_at ?? ""))
                  .map((t: Ticket) => (
                    <div className="detail-line" key={t.id}>
                      <span className="detail-when nums">{(t.sold_at ?? t.event_date ?? "").slice(0, 10)}</span>
                      <span className="detail-what">{t.event_name}</span>
                      <span className="detail-qty nums">{t.qty_sold}/{t.qty_total}</span>
                      <span className="nums">{t.sell_price.toFixed(0)}</span>
                      <span className="nums unknown">−{t.buy_price.toFixed(0)}</span>
                      <span className={"nums " + tone(realizedProfit(t))}>{signed(realizedProfit(t))}</span>
                    </div>
                  ))}
              </div>
            )}
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
