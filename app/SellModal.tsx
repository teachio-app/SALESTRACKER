"use client";

import { useState } from "react";
import { type Ticket, realizedCost, realizedProfit } from "@/lib/supabase";

// The sell side lives here, apart from the purchase form. Normally the mail
// poller writes these fields; this is the manual override for sales that never
// produced an email — or that the parser flagged for review.

function toNum(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export default function SellModal({
  ticket, onSave, onClose,
}: {
  ticket: Ticket;
  onSave: (t: Partial<Ticket>) => void;
  onClose: () => void;
}) {
  const [sellText, setSellText] = useState(ticket.sell_price ? ticket.sell_price.toFixed(2) : "");
  const [qtySold, setQtySold] = useState(ticket.qty_sold || ticket.qty_total);
  const [status, setStatus] = useState<Ticket["status"]>(ticket.status === "sold" ? "sold" : "sold");

  const sell = toNum(sellText);
  // Preview the realized numbers for the quantity being sold, not the whole
  // batch — matches how the row will read after saving.
  const preview = { buy_price: ticket.buy_price, sell_price: sell, qty_sold: qtySold, qty_total: ticket.qty_total };
  const cost = realizedCost(preview);
  const profit = realizedProfit(preview);
  const known = ticket.buy_price > 0;
  const partial = qtySold > 0 && qtySold < ticket.qty_total;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Record sale</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          <p className="modal-lede">{ticket.event_name}</p>

          <div className="grid-3">
            <label className="field">
              <span className="field-label">Sell price <i className="req">*</i></span>
              <input inputMode="decimal" autoFocus value={sellText}
                     onChange={(e) => setSellText(e.target.value)} placeholder="675.00" />
            </label>
            <label className="field">
              <span className="field-label">Qty sold</span>
              <input type="number" min={0} max={ticket.qty_total} value={qtySold}
                     onChange={(e) => setQtySold(Math.min(ticket.qty_total, Math.max(0, +e.target.value)))} />
            </label>
            <label className="field">
              <span className="field-label">Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as Ticket["status"])}>
                <option value="sold">Sold</option>
                <option value="listed">Listed</option>
                <option value="not_listed">Not listed</option>
              </select>
            </label>
          </div>

          {/* Show the arithmetic rather than let it be a surprise after saving. */}
          <div className="sell-preview">
            {known ? (
              <>
                <span>{partial ? `Cost of ${qtySold}/${ticket.qty_total}` : "Buy"} {cost.toFixed(2)}</span>
                <span className="op">→</span>
                <span>Sell {sell.toFixed(2)}</span>
                <span className="op">=</span>
                <strong className={profit >= 0 ? "profit-pos" : "profit-neg"}>
                  {profit >= 0 ? "+" : "−"}{Math.abs(profit).toFixed(2)} {ticket.currency}
                </strong>
              </>
            ) : (
              <span className="unknown">
                No buy price on this row yet — profit stays unknown until you add one.
              </span>
            )}
          </div>
        </div>

        <footer className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!sell}
                  onClick={() => onSave({ id: ticket.id, sell_price: sell, qty_sold: qtySold, status })}>
            Save sale
          </button>
        </footer>
      </div>
    </div>
  );
}
