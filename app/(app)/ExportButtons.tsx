"use client";

import { useState } from "react";
import type { Ticket } from "@/lib/supabase";
import { exportCsv, exportPdf } from "./exportRows";

// Two small buttons that export exactly the rows handed to them — so whatever the
// search box and period filter are currently showing is what lands in the file.
export default function ExportButtons({ rows, scope }: { rows: Ticket[]; scope: string }) {
  const [busy, setBusy] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const empty = rows.length === 0;

  function onCsv() {
    exportCsv(rows, `desktracker_${stamp}.csv`);
  }

  async function onPdf() {
    if (busy) return;
    setBusy(true);
    try {
      await exportPdf(rows, { filename: `desktracker_${stamp}.pdf`, scope, stamp });
    } catch (e) {
      alert("PDF export failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-actions">
      <button className="btn btn-sm btn-ghost" onClick={onCsv} disabled={empty}
              title="Download the current view as a CSV spreadsheet">Export CSV</button>
      <button className="btn btn-sm btn-ghost" onClick={onPdf} disabled={empty || busy}
              title="Download the current view as a PDF table">
        {busy ? "PDF…" : "Export PDF"}
      </button>
    </div>
  );
}
