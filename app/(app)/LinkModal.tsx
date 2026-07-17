"use client";

import { useMemo, useState } from "react";
import { type Ticket } from "@/lib/supabase";
import { useDash } from "./DashContext";

// Manual fallback for a sale the poller couldn't seat-match: pick the purchase
// it belongs to and merge the sell side into it. Only unsold purchases (other
// than the review row itself) are offered.
export default function LinkModal({ reviewRow, onClose }: { reviewRow: Ticket; onClose: () => void }) {
  const { tickets, linkSale } = useDash();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const needle = q.toLowerCase();
    return tickets
      .filter((t) => t.id !== reviewRow.id && !t.needs_review && t.qty_sold < t.qty_total)
      .filter((t) =>
        !needle ||
        (t.event_name ?? "").toLowerCase().includes(needle) ||
        (t.location ?? "").toLowerCase().includes(needle) ||
        (t.section ?? "").toLowerCase().includes(needle)
      )
      // Nearest event date to the sale first — the likely match floats up.
      .sort((a, b) => {
        const key = (t: Ticket) => Math.abs(
          new Date(t.event_date ?? 0).getTime() - new Date(reviewRow.event_date ?? 0).getTime()
        );
        return key(a) - key(b);
      })
      .slice(0, 40);
  }, [tickets, reviewRow, q]);

  async function pick(purchase: Ticket) {
    setBusy(true);
    await linkSale(reviewRow, purchase);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-link" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Link sale to a purchase</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <p className="modal-lede">
            <strong>{reviewRow.event_name}</strong> · {reviewRow.event_date ?? "—"} ·
            {" "}{reviewRow.sell_price.toFixed(2)} {reviewRow.currency}
            {[reviewRow.section, reviewRow.seat_row, reviewRow.seats].filter(Boolean).length > 0 &&
              ` · Sec ${reviewRow.section ?? "-"} / Row ${reviewRow.seat_row ?? "-"} / ${reviewRow.seats ?? "-"}`}
          </p>
          <input autoFocus placeholder="Search your purchases…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="link-list">
            {candidates.length === 0 ? (
              <div className="empty">No matching unsold purchases.</div>
            ) : (
              candidates.map((t) => (
                <button key={t.id} className="link-row" disabled={busy} onClick={() => pick(t)}>
                  <span className="link-ev">{t.event_name}</span>
                  <span className="link-meta">
                    {t.event_date ?? "—"} · {t.location ?? "—"}
                    {t.section && ` · Sec ${t.section}`} · buy {t.buy_price.toFixed(0)} · {t.qty_sold}/{t.qty_total}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
