"use client";

import { PERIODS } from "@/lib/supabase";
import { useDash } from "./DashContext";

// Period selector, shared by Events and Charts. Reads/writes the period held in
// the (app) layout, so switching pages keeps the same window.
export default function PeriodTabs() {
  const { period, setPeriod } = useDash();
  return (
    <div className="period-tabs">
      {PERIODS.map((p) => (
        <button key={p.key}
                className={"period-tab" + (period === p.key ? " is-active" : "")}
                onClick={() => setPeriod(p.key)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
