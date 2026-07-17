"use client";

import { useState } from "react";
import { type Ticket, saleTotals } from "@/lib/supabase";

// Quick "record a sale" — APPENDS a fill to the batch's sales, so selling part
// of a batch now and the rest later (at a different price) just adds another
// entry. Full editing of the list lives in the Edit modal.

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
  const already = saleTotals(ticket.sales);
  const remaining = Math.max(0, ticket.qty_total - already.qty);
  const [amountText, setAmountText] = useState("");
  const [qty, setQty] = useState(remaining || ticket.qty_total);

  const amount = toNum(amountText);
  const perTicket = qty > 0 ? amount / qty : 0;

  function save() {
    const fills = [
      ...(ticket.sales ?? []),
      { qty, amount, at: new Date().toISOString().slice(0, 10), source: "manual" },
    ];
    const t = saleTotals(fills);
    onSave({
      id: ticket.id,
      sales: fills,
      sell_price: t.amount,
      qty_sold: Math.min(ticket.qty_total, t.qty),
      status: "sold",
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Record a sale</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          <p className="modal-lede">
            {ticket.event_name}
            {already.qty > 0 && <> · <span className="unknown">{already.qty}/{ticket.qty_total} already sold</span></>}
          </p>

          <div className="grid-3">
            <label className="field">
              <span className="field-label">Qty this sale</span>
              <input type="number" min={1} max={remaining || ticket.qty_total} value={qty}
                     onChange={(e) => setQty(Math.max(1, +e.target.value))} />
            </label>
            <label className="field">
              <span className="field-label">Amount (total) <i className="req">*</i></span>
              <input inputMode="decimal" autoFocus value={amountText}
                     onChange={(e) => setAmountText(e.target.value)} placeholder="480.00" />
            </label>
            <label className="field">
              <span className="field-label">Per ticket</span>
              <input value={amount ? perTicket.toFixed(2) : ""} readOnly placeholder="—" />
            </label>
          </div>

          <div className="sell-preview">
            {remaining > 0 && qty >= remaining
              ? <span>This completes the batch ({ticket.qty_total}/{ticket.qty_total}).</span>
              : <span>After this: <strong>{Math.min(ticket.qty_total, already.qty + qty)}/{ticket.qty_total}</strong> sold.</span>}
          </div>
        </div>

        <footer className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!amount || qty < 1} onClick={save}>Add sale</button>
        </footer>
      </div>
    </div>
  );
}
