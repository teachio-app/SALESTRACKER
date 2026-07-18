"use client";

import { useMemo } from "react";
import { useDash } from "../DashContext";
import TicketsTable from "../TicketsTable";

// The review queue: sales the poller couldn't confidently seat-match to a
// purchase. Each row has a "Link" action to merge it into the right purchase.
export default function ReviewPage() {
  const { tickets, loading, error } = useDash();
  const rows = useMemo(() => tickets.filter((t) => t.needs_review), [tickets]);

  return (
    <>
      <div className="toolbar">
        <h1>Review</h1>
      </div>

      {error && (
        <div className="error-banner">
          <strong>Couldn’t load your rows.</strong> {error}
        </div>
      )}

      {loading ? (
        <div className="empty">Loading…</div>
      ) : error ? null : rows.length === 0 ? (
        <div className="empty">Nothing to review — every sale is linked to a purchase.</div>
      ) : (
        <>
          <div className="chart-notice" style={{ marginBottom: 12 }}>
            These sales came in from email but couldn’t be matched to a purchase by seat.
            Use <strong>Link</strong> to merge one into the right purchase, or <strong>No purchase</strong>
            {" "}to keep it as a standalone sale — either way it leaves this queue.
          </div>
          <TicketsTable rows={rows} showLink />
        </>
      )}
    </>
  );
}
