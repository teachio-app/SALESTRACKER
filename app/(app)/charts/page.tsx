"use client";

import { useMemo, useState } from "react";
import ProfitChart from "@/app/ProfitChart";
import { useDash } from "../DashContext";

// Period presets, in months from today. `null` = everything.
const PERIODS = [
  { key: "1m", label: "1M", months: 1 },
  { key: "3m", label: "3M", months: 3 },
  { key: "6m", label: "6M", months: 6 },
  { key: "1y", label: "1Y", months: 12 },
  { key: "all", label: "All", months: null as number | null },
];

export default function ChartsPage() {
  const { tickets, loading, error } = useDash();
  const [period, setPeriod] = useState("all");

  const shown = useMemo(() => {
    const p = PERIODS.find((x) => x.key === period);
    if (!p?.months) return tickets;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - p.months);
    // Same date a sale is charted on: sold_at, falling back to row creation.
    return tickets.filter((t) => new Date(t.sold_at ?? t.created_at) >= cutoff);
  }, [tickets, period]);

  return (
    <>
      <div className="toolbar">
        <h1>Charts</h1>
        <div className="period-tabs">
          {PERIODS.map((p) => (
            <button key={p.key}
                    className={"period-tab" + (period === p.key ? " is-active" : "")}
                    onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <strong>Couldn’t load your rows.</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : error ? null : (
        <ProfitChart tickets={shown} />
      )}
    </>
  );
}
