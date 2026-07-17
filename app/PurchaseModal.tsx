"use client";

import { useState } from "react";
import { TICKET_TYPES, CURRENCIES, saleTotals, type Ticket, type SaleFill } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────
// Add / edit a purchase, including its individual sales. A batch can sell in
// parts at different prices (2 @ €240, then 2 @ €200); the Sales list holds each
// fill, and sell_price / qty_sold are their sums (computed on save).
//
// Price per ticket and Total price are two views of ONE number. Only the total
// is stored (buy_price); per-ticket is total ÷ count. Typing in either box
// rewrites the other, so they cannot disagree — which is exactly what a pair of
// independently-editable fields would eventually do.
// ─────────────────────────────────────────────────────────────

export const EMPTY_PURCHASE: Partial<Ticket> = {
  event_name: "",
  event_date: "",
  purchase_date: new Date().toISOString().slice(0, 10),
  location: "",
  section: "",
  seat_row: "",
  seats: "",
  ticket_type: "Mobile",
  qty_total: 1,
  qty_sold: 0,
  buy_price: 0,
  sell_price: 0,
  currency: "EUR",
  status: "not_listed",
  order_ref: "",
  email_used: "",
  payment_method: "",
  vgg_event_id: "",
  comment: "",
  sales: [],
};

/** Money in, money out — tolerate "375,60" as well as "375.60". */
function toNum(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? 0 : n;
}
function money(n: number): string {
  return n ? n.toFixed(2) : "";
}

export default function PurchaseModal({
  ticket,
  onSave,
  onClose,
}: {
  ticket: Partial<Ticket>;
  onSave: (t: Partial<Ticket>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Ticket>>(ticket);
  const set = <K extends keyof Ticket>(k: K, v: Ticket[K]) => setForm((f) => ({ ...f, [k]: v }));

  const count = form.qty_total ?? 1;
  const total = form.buy_price ?? 0;
  // Local text state so a half-typed "18" doesn't get reformatted to "18.00".
  const [perText, setPerText] = useState(() => money(count > 0 ? total / count : 0));
  const [totalText, setTotalText] = useState(() => money(total));

  const fills: SaleFill[] = form.sales ?? [];
  const soldTotals = saleTotals(fills);
  const setFills = (next: SaleFill[]) => set("sales", next);
  const setFill = (i: number, patch: Partial<SaleFill>) =>
    setFills(fills.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const addFill = () =>
    setFills([...fills, { qty: 1, amount: 0, at: new Date().toISOString().slice(0, 10) }]);
  const removeFill = (i: number) => setFills(fills.filter((_, j) => j !== i));

  function editPer(text: string) {
    setPerText(text);
    const t = toNum(text) * count;
    setTotalText(money(t));
    set("buy_price", t);
  }
  function editTotal(text: string) {
    setTotalText(text);
    const t = toNum(text);
    setPerText(money(count > 0 ? t / count : 0));
    set("buy_price", t);
  }
  function editCount(text: string) {
    const c = Math.max(1, parseInt(text || "1", 10) || 1);
    set("qty_total", c);
    // Count is the divisor: hold the total, re-derive per-ticket. Holding
    // per-ticket instead would silently rewrite what was actually paid.
    setPerText(money(toNum(totalText) / c));
  }

  const invalid = !form.event_name?.trim() || !form.location?.trim();

  function submit() {
    // Derive the row aggregates from the fills so they never drift from the list.
    const t = saleTotals(fills);
    onSave({
      ...form,
      sales: fills,
      sell_price: t.amount,
      qty_sold: Math.min(count, t.qty),
      status: t.qty > 0 ? "sold" : form.status ?? "not_listed",
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{form.id ? "Edit purchase" : "Add purchase"}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          <div className="grid-3">
            <Field label="Event name" required>
              <input value={form.event_name ?? ""} onChange={(e) => set("event_name", e.target.value)}
                     placeholder="Metallica" autoFocus />
            </Field>
            <Field label="Event date">
              <input type="date" value={form.event_date ?? ""} onChange={(e) => set("event_date", e.target.value)} />
            </Field>
            <Field label="Purchase date">
              <input type="date" value={form.purchase_date ?? ""} onChange={(e) => set("purchase_date", e.target.value)} />
            </Field>

            <Field label="Location" required>
              <input value={form.location ?? ""} onChange={(e) => set("location", e.target.value)}
                     placeholder="Cardiff - UK" />
            </Field>
            <Field label="Section">
              <input value={form.section ?? ""} onChange={(e) => set("section", e.target.value)} placeholder="L35" />
            </Field>
            <Field label="Row">
              <input value={form.seat_row ?? ""} onChange={(e) => set("seat_row", e.target.value)} placeholder="20" />
            </Field>

            <Field label="Seats">
              <input value={form.seats ?? ""} onChange={(e) => set("seats", e.target.value)} placeholder="15-16" />
            </Field>
            <Field label="Ticket type">
              <select value={form.ticket_type ?? "Mobile"} onChange={(e) => set("ticket_type", e.target.value)}>
                {TICKET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Tickets count" required>
              <input type="number" min={1} value={count} onChange={(e) => editCount(e.target.value)} />
            </Field>

            <Field label="Price per ticket" hint="or fill the total →">
              <input inputMode="decimal" value={perText} onChange={(e) => editPer(e.target.value)} placeholder="187.80" />
            </Field>
            <Field label="Total price" hint={count > 1 ? `${count} × per-ticket` : undefined}>
              <input inputMode="decimal" value={totalText} onChange={(e) => editTotal(e.target.value)} placeholder="375.60" />
            </Field>
            <Field label="Currency">
              <select value={form.currency ?? "EUR"} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </Field>

            <Field label="Order number">
              <input value={form.order_ref ?? ""} onChange={(e) => set("order_ref", e.target.value)} placeholder="159627734" />
            </Field>
            <Field label="Email used">
              <input type="email" value={form.email_used ?? ""} onChange={(e) => set("email_used", e.target.value)}
                     placeholder="you@example.com" />
            </Field>
            <Field label="Payment method">
              <input value={form.payment_method ?? ""} onChange={(e) => set("payment_method", e.target.value)}
                     placeholder="PayPal" />
            </Field>

            <Field label="VGG event ID">
              <input value={form.vgg_event_id ?? ""} onChange={(e) => set("vgg_event_id", e.target.value)}
                     placeholder="151804250" />
            </Field>
          </div>

          {/* Sales — one row per partial sale, so a batch can sell in pieces at
              different prices. sell_price / qty sold are the sums, on save. */}
          <div className="modal-section">
            Sales
            <span className="section-sum">
              {soldTotals.qty}/{count} sold · {soldTotals.amount.toFixed(2)} {form.currency ?? "EUR"}
            </span>
          </div>
          <div className="fills">
            {fills.length === 0 && <div className="fills-empty">No sales yet. Add one when a batch (or part of it) sells.</div>}
            {fills.map((f, i) => (
              <div className="fill-row" key={i}>
                <label className="fill-cell">
                  <span>Qty</span>
                  <input type="number" min={1} value={f.qty}
                         onChange={(e) => setFill(i, { qty: Math.max(0, +e.target.value) })} />
                </label>
                <label className="fill-cell">
                  <span>Amount (total)</span>
                  <input inputMode="decimal" value={f.amount || ""} placeholder="0.00"
                         onChange={(e) => setFill(i, { amount: toNum(e.target.value) })} />
                </label>
                <label className="fill-cell">
                  <span>Date</span>
                  <input type="date" value={f.at ?? ""} onChange={(e) => setFill(i, { at: e.target.value })} />
                </label>
                <button className="fill-x" onClick={() => removeFill(i)} title="Remove this sale" type="button">×</button>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm fill-add" type="button" onClick={addFill}>+ Add sale</button>
          </div>

          <Field label="Comment" full>
            <textarea rows={3} value={form.comment ?? ""} onChange={(e) => set("comment", e.target.value)}
                      placeholder="Additional notes…" />
          </Field>
        </div>

        <footer className="modal-foot">
          {invalid && <span className="foot-hint">Event name and location are required</span>}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={invalid} onClick={submit}>
            {form.id ? "Update purchase" : "Add purchase"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({
  label, children, required, hint, full,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  hint?: string;
  full?: boolean;
}) {
  return (
    <label className={"field" + (full ? " field-full" : "")}>
      <span className="field-label">
        {label}{required && <i className="req">*</i>}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
