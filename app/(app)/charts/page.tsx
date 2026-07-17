"use client";

import { useMemo } from "react";
import { filterByPeriod } from "@/lib/supabase";
import ProfitChart from "@/app/ProfitChart";
import { useDash } from "../DashContext";
import PeriodTabs from "../PeriodTabs";

export default function ChartsPage() {
  const { tickets, loading, error, period } = useDash();
  const shown = useMemo(() => filterByPeriod(tickets, period), [tickets, period]);

  return (
    <>
      <div className="toolbar">
        <h1>Charts</h1>
        <PeriodTabs />
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
