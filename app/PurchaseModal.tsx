"use client";

import { useState } from "react";
import { TICKET_TYPES, CURRENCIES, type Ticket } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────
// The purchase side, and only the purchase side. Everything here is something
// the owner knows at buy time; nothing here comes from a sale email. The sell
// price is deliberately absent — the poller owns it, and the Sell button edits
// it separately. One field, one owner.
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
  const [sellText, setSellText] = useState(() => money(form.sell_price ?? 0));

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

  function editSell(text: string) {
    setSellText(text);
    set("sell_price", toNum(text));
  }

  const invalid = !form.event_name?.trim() || !form.location?.trim();

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

          {/* Sale side — normally filled by the poller, editable here so a typo
              (wrong sell price, wrong count) can be fixed in one place. */}
          <div className="modal-section">Sale</div>
          <div className="grid-3">
            <Field label="Sell price" hint="total received">
              <input inputMode="decimal" value={sellText} onChange={(e) => editSell(e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Qty sold" hint={`of ${count}`}>
              <input type="number" min={0} max={count} value={form.qty_sold ?? 0}
                     onChange={(e) => set("qty_sold", Math.min(count, Math.max(0, +e.target.value)))} />
            </Field>
            <Field label="Status">
              <select value={form.status ?? "not_listed"} onChange={(e) => set("status", e.target.value as Ticket["status"])}>
                <option value="sold">Sold</option>
                <option value="listed">Listed</option>
                <option value="not_listed">Not listed</option>
              </select>
            </Field>
          </div>

          <Field label="Comment" full>
            <textarea rows={3} value={form.comment ?? ""} onChange={(e) => set("comment", e.target.value)}
                      placeholder="Additional notes…" />
          </Field>
        </div>

        <footer className="modal-foot">
          {invalid && <span className="foot-hint">Event name and location are required</span>}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={invalid} onClick={() => onSave(form)}>
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
