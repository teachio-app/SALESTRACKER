"use client";

import { useMemo, useState } from "react";
import {
  CURRENCIES,
  PERIODS,
  entryTotals,
  filterByPeriod,
  filterEntriesByPeriod,
  realizedProfit,
  signedAmount,
  type CashEntry,
  type Ticket,
} from "@/lib/supabase";
import { useDash } from "../DashContext";
import PeriodTabs from "../PeriodTabs";
import { exportEntriesCsv } from "../exportRows";

// ─────────────────────────────────────────────────────────────
// Cashflow — money in and out that the tickets table can't express: "prodej
// kódů LA28", a platform fee, a train ticket to a collection. An entry MAY name
// the event it belongs to, and mostly won't.
//
// The one-line quick-add at the top is the whole point: type what it was, type
// the amount, hit Enter. Everything else (category, note, which event) lives in
// the modal behind "More…" and can be filled in later, or never.
// ─────────────────────────────────────────────────────────────

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

type SortKey = "date" | "desc" | "amount";

export default function CashflowPage() {
  const { entries, tickets, loading, entriesError, period, saveEntry, removeEntry, openEntry } = useDash();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });

  // Quick-add row. Kept as loose text until submit so a half-typed amount is
  // never coerced under the cursor.
  const [kind, setKind] = useState<CashEntry["kind"]>("income");
  const [desc, setDesc] = useState("");
  const [amountText, setAmountText] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const byId = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);
  const inPeriod = useMemo(() => filterEntriesByPeriod(entries, period), [entries, period]);

  const tokens = useMemo(() => fold(search.trim()).split(/\s+/).filter(Boolean), [search]);
  const searching = tokens.length > 0;
  // Search looks past the period filter, same as the events page — "find that
  // one entry" must never be hidden by the current window.
  const shown = useMemo(() => {
    const base = searching ? entries : inPeriod;
    if (!searching) return base;
    return base.filter((e) => {
      const h = fold([e.description, e.category, e.note, byId.get(e.ticket_id ?? "")?.event_name, e.occurred_at]
        .filter(Boolean).join(" "));
      return tokens.every((tok) => h.includes(tok));
    });
  }, [searching, entries, inPeriod, tokens, byId]);

  const sorted = useMemo(() => {
    const val = (e: CashEntry): string | number =>
      sort.key === "desc" ? e.description.toLowerCase()
      : sort.key === "amount" ? signedAmount(e)
      : e.occurred_at + e.created_at;
    return [...shown].sort((a, b) => {
      const va = val(a), vb = val(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }, [shown, sort]);

  // Headline numbers follow the period, not the search — they describe the
  // window you picked, so typing in the box doesn't move them.
  const totals = entryTotals(inPeriod);
  // Ticket profit over the same window, so "Overall" answers what actually came
  // in: sold-batch profit plus everything on this page.
  const ticketProfit = useMemo(
    () => filterByPeriod(tickets, period)
      .filter((t: Ticket) => t.qty_sold > 0 && t.buy_price > 0)
      .reduce((s, t) => s + realizedProfit(t), 0),
    [tickets, period]
  );
  // Every total is summed as one pot; flag it when the rows aren't all in one
  // currency rather than quietly adding GBP to EUR.
  const mixed = new Set(inPeriod.map((e) => e.currency)).size > 1;

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "All";
  const scope = searching
    ? `Search "${search.trim()}" (${shown.length} entries)`
    : period === "all" ? "All entries" : `Last ${periodLabel}`;

  function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    const amount = Math.abs(parseFloat(amountText.replace(",", ".")));
    if (!desc.trim() || !amount) return;
    saveEntry({ kind, description: desc.trim(), amount, currency, occurred_at: date });
    setDesc("");
    setAmountText("");
    // Kind, currency and date stay put — entering three costs in a row shouldn't
    // mean re-picking "Cost" three times.
  }

  /** Hand the half-filled quick-add row to the full modal instead of losing it. */
  function openWithDraft() {
    const amount = Math.abs(parseFloat(amountText.replace(",", ".")));
    openEntry({
      kind, description: desc, currency, occurred_at: date,
      amount: Number.isFinite(amount) ? amount : 0,
    });
  }

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");
  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "desc" ? 1 : -1 }));

  return (
    <>
      <div className="toolbar">
        <h1>Cashflow</h1>
        <PeriodTabs />
        <div className="summary">
          <div className="stat">
            <div className="label">Income</div>
            <div className="value profit-pos">{totals.income.toFixed(0)}</div>
          </div>
          <div className="stat">
            <div className="label">Costs</div>
            <div className="value profit-neg">{totals.expense.toFixed(0)}</div>
          </div>
          <div className="stat">
            <div className="label">Net{mixed && <span className="stat-caveat"> · mixed currencies</span>}</div>
            <div className={"value " + (totals.net >= 0 ? "profit-pos" : "profit-neg")}>
              {totals.net.toFixed(0)} EUR
            </div>
          </div>
          <div className="stat" title="This page's net plus realized ticket profit in the same period">
            <div className="label">Overall incl. tickets</div>
            <div className={"value " + (totals.net + ticketProfit >= 0 ? "profit-pos" : "profit-neg")}>
              {(totals.net + ticketProfit).toFixed(0)} EUR
            </div>
          </div>
        </div>
      </div>

      {/* Quick add — the fast path. Enter submits. */}
      <form className="quick-add" onSubmit={quickAdd}>
        <select className="qa-kind" value={kind} onChange={(e) => setKind(e.target.value as CashEntry["kind"])}
                aria-label="Income or cost">
          <option value="income">+ Income</option>
          <option value="expense">− Cost</option>
        </select>
        <input className="qa-desc" value={desc} onChange={(e) => setDesc(e.target.value)}
               placeholder="What was it? e.g. prodej kódů LA28" aria-label="Description" />
        <input className="qa-amount nums" inputMode="decimal" value={amountText}
               onChange={(e) => setAmountText(e.target.value)} placeholder="300" aria-label="Amount" />
        <select className="qa-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}
                aria-label="Currency">
          {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
        </select>
        <input className="qa-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
               aria-label="Date" />
        <button className="btn btn-primary" type="submit">Add</button>
        <button className="btn btn-ghost" type="button" onClick={openWithDraft}
                title="Category, note, link to an event">More…</button>
      </form>

      <div className="table-toolbar">
        <input className="search" placeholder="Search — description, category, note, event…"
               value={search} onChange={(e) => setSearch(e.target.value)} />
        {searching && <span className="search-count">{shown.length} found</span>}
        <div className="export-actions">
          <button className="btn btn-sm btn-ghost" disabled={shown.length === 0}
                  onClick={() => exportEntriesCsv(sorted, tickets, `desktracker_cashflow_${new Date().toISOString().slice(0, 10)}.csv`)}
                  title={`Download ${scope} as CSV`}>Export CSV</button>
        </div>
      </div>

      {entriesError && (
        <div className="error-banner">
          <strong>Couldn’t load your cash entries.</strong> {entriesError}
          {" "}If this is the first time you’re opening this page, run <code>supabase/schema.sql</code> again
          in the Supabase SQL editor — it creates the <code>entries</code> table.
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : entriesError ? null : entries.length === 0 ? (
        <div className="empty">
          Nothing here yet. Type what you earned or paid in the row above — it doesn’t have to relate to a ticket.
        </div>
      ) : sorted.length === 0 ? (
        <div className="empty">
          {searching ? "Nothing matches your search." : "No entries in this period. Try a longer range."}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="th-sort" onClick={() => toggleSort("date")}>Date{arrow("date")}</th>
                <th className="th-sort" onClick={() => toggleSort("desc")}>Description{arrow("desc")}</th>
                <th>Category</th>
                <th>Related event</th>
                <th className="th-sort amount-col" onClick={() => toggleSort("amount")}>Amount{arrow("amount")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => {
                const out = e.kind === "expense";
                const linked = e.ticket_id ? byId.get(e.ticket_id) : undefined;
                return (
                  <tr key={e.id}>
                    <td className="nums date-cell">{e.occurred_at}</td>
                    <td>
                      <div className="entry-desc">{e.description}</div>
                      {e.note && <div className="entry-sub">{e.note}</div>}
                    </td>
                    <td>{e.category ? <span className="tag">{e.category}</span> : <span className="unknown">—</span>}</td>
                    <td className="venue-cell">
                      {linked ? (
                        <>
                          {linked.event_name}
                          {linked.event_date && <><br /><span className="seat">{linked.event_date}</span></>}
                        </>
                      ) : (
                        <span className="unknown">—</span>
                      )}
                    </td>
                    <td className={"nums amount-col " + (out ? "amount-out" : "amount-in")}>
                      {out ? "−" : "+"}{e.amount.toFixed(2)} {e.currency}
                    </td>
                    <td>
                      <div className="actions">
                        <button className="btn btn-sm btn-ghost" onClick={() => openEntry(e)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => removeEntry(e.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
