"use client";

import { useMemo, useState } from "react";
import { filterByPeriod, filterEntriesByPeriod } from "@/lib/supabase";
import ProfitChart from "@/app/ProfitChart";
import { useDash } from "../DashContext";
import PeriodTabs from "../PeriodTabs";

export default function ChartsPage() {
  const { tickets, entries, loading, error, period } = useDash();
  // On by default: the question these charts answer is "how am I doing", and
  // money made outside a ticket batch is part of that. The toggle is here
  // because ROI stops meaning "return on ticket stock" once it's folded in.
  const [includeCash, setIncludeCash] = useState(true);

  const shown = useMemo(() => filterByPeriod(tickets, period), [tickets, period]);
  const cash = useMemo(() => filterEntriesByPeriod(entries, period), [entries, period]);

  return (
    <>
      <div className="toolbar">
        <h1>Charts</h1>
        <PeriodTabs />
        <label className="scan-check" style={{ marginLeft: "auto", margin: 0 }}>
          <input type="checkbox" checked={includeCash} onChange={(e) => setIncludeCash(e.target.checked)} />
          <span>Include cashflow ({cash.length})</span>
        </label>
      </div>

      {error && (
        <div className="error-banner">
          <strong>Couldn’t load your rows.</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : error ? null : (
        <ProfitChart tickets={shown} entries={cash} includeCash={includeCash} />
      )}
    </>
  );
}
