"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ago, int, money } from "./format";
import type { TableSale } from "./model";
import { Icon } from "./ui";

// The Sales History table, laid out like the sales tracker's own: price,
// quantity, section, row & seat, time — searchable, filterable by section and
// quantity, sortable, paged. When the page's data carried the full history this
// is every sale; otherwise the rows that were on screen, and it says so.

type SortKey = "time" | "price" | "qty";
const QTY_FILTERS = ["all", "1", "2", "3", "4+"] as const;

export default function SalesHistory({
  sales, source, totalSales, currency, capturedAt,
}: {
  sales: TableSale[];
  source: "full" | "screen";
  totalSales: number | null;
  currency: string;
  capturedAt: string;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<(typeof QTY_FILTERS)[number]>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "time", dir: -1 });
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // Close the sections menu on an outside click.
  useEffect(() => {
    if (!sectionsOpen) return;
    const off = (e: MouseEvent) => { if (menu.current && !menu.current.contains(e.target as Node)) setSectionsOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [sectionsOpen]);

  const sectionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sales) if (s.section) m.set(s.section, (m.get(s.section) ?? 0) + (s.qty ?? 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [sales]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = sales.filter((s) => {
      if (picked.size && !(s.section && picked.has(s.section))) return false;
      if (qty !== "all") {
        const n = s.qty ?? 1;
        if (qty === "4+" ? n < 4 : n !== Number(qty)) return false;
      }
      if (q) {
        const hay = `${s.price ?? ""} ${money(s.price, currency)} ${s.section ?? ""} ${s.row ?? ""} ${s.seats ?? ""}`.toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const val = (s: TableSale) => (sort.key === "price" ? s.price ?? -1 : sort.key === "qty" ? s.qty ?? 0 : s.at ? Date.parse(s.at) : 0);
    return out.sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [sales, query, picked, qty, sort, currency]);

  useEffect(() => setPage(1), [query, picked, qty, pageSize, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = rows.slice((page - 1) * pageSize, page * pageSize);
  const now = Date.parse(capturedAt) || Date.now();

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === -1 ? " ↓" : " ↑") : "");

  return (
    <div className="tk-card tk-history">
      <div className="tk-card-head">
        <h3>Sales History</h3>
        <span className="tk-count">{int(source === "full" ? sales.length : totalSales ?? sales.length)} sales</span>
        <span className="tk-currency">{currency}</span>
      </div>

      {source === "screen" && (
        <div className="tk-note">
          Showing the {sales.length} sales from the tracker’s first page — the full history wasn’t in the page’s data.
        </div>
      )}

      <div className="tk-filters">
        <label className="tk-search">
          {Icon.search}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by price, section, row, seat…" />
        </label>

        <div className="tk-menu" ref={menu}>
          <button className={"tk-select" + (picked.size ? " is-on" : "")} onClick={() => setSectionsOpen((o) => !o)}>
            Sections{picked.size ? ` · ${picked.size}` : ""} {Icon.chevron}
          </button>
          {sectionsOpen && (
            <div className="tk-menu-pop" role="listbox">
              <div className="tk-menu-actions">
                <button onClick={() => setPicked(new Set())}>Clear</button>
              </div>
              {sectionCounts.slice(0, 80).map(([sec, n]) => (
                <label key={sec} className="tk-menu-item">
                  <input type="checkbox" checked={picked.has(sec)}
                         onChange={() => setPicked((p) => { const x = new Set(p); x.has(sec) ? x.delete(sec) : x.add(sec); return x; })} />
                  <span className="tk-sec">{sec}</span>
                  <span className="tk-menu-n">{n} tix</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <select className="tk-select" value={qty} onChange={(e) => setQty(e.target.value as typeof qty)} aria-label="Quantity">
          {QTY_FILTERS.map((q) => <option key={q} value={q}>{q === "all" ? "Quantity" : `${q} ticket${q === "1" ? "" : "s"}`}</option>)}
        </select>

        <select className="tk-select tk-pagesize" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page">
          {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <div className="tk-table-wrap">
        <table className="tk-table">
          <thead>
            <tr>
              <th className="th-sort" onClick={() => toggleSort("price")}>Price{arrow("price")}</th>
              <th className="th-sort c" onClick={() => toggleSort("qty")}>Quantity{arrow("qty")}</th>
              <th className="c">Section</th>
              <th className="c">Row &amp; seat</th>
              <th className="th-sort c" onClick={() => toggleSort("time")}>Update time{arrow("time")}</th>
            </tr>
          </thead>
          <tbody>
            {current.map((s, i) => (
              <tr key={i}>
                <td className="tk-price">{money(s.price, s.currency || currency)}</td>
                <td className="c tk-qty">{s.qty ?? "—"}</td>
                <td className="c tk-sec">{s.section ?? "—"}</td>
                <td className="c tk-seat">
                  <div>{s.row ?? "—"}</div>
                  <div className="tk-seat-sub">{s.seats ?? "N/A"}</div>
                </td>
                <td className="c tk-time" title={s.at ?? ""}>{s.approx ? "~" : ""}{ago(s.at, now)}</td>
              </tr>
            ))}
            {!current.length && (
              <tr><td colSpan={5} className="tk-empty">No sales match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="tk-pager">
        <span className="tk-pager-info">
          {int(current.length)} sales · page {page}/{pages} · {int(rows.length)} total
        </span>
        <div className="tk-pages">
          {pageList(page, pages).map((p, i) =>
            p === "…" ? <span key={`g${i}`} className="tk-gap">…</span> : (
              <button key={p} className={"tk-page" + (p === page ? " is-on" : "")} onClick={() => setPage(p)}>{p}</button>
            )
          )}
        </div>
        <div className="tk-prevnext">
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      </div>
    </div>
  );
}

/** 1 2 3 4 5 … 27 around the current page. */
function pageList(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push("…");
  for (let p = from; p <= to; p++) out.push(p);
  if (to < pages - 1) out.push("…");
  out.push(pages);
  return out;
}
