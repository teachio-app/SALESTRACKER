"use client";

import { useMemo, useState } from "react";
import { CURRENCIES, ENTRY_CATEGORIES, type CashEntry, type Ticket } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────
// Add / edit one cash entry: money that came in or went out, whether or not a
// ticket is behind it ("prodej kódů LA28" has none; a delivery fee on order
// #159627734 does).
//
// The amount box is always POSITIVE — Income/Expense decides the sign, so there
// is exactly one way to record a cost and no way to type a minus into income.
// The Cashflow page's one-line quick-add covers the common case; this modal is
// for the rest (category, note, which event it belongs to).
// ─────────────────────────────────────────────────────────────

export function emptyEntry(kind: CashEntry["kind"] = "income"): Partial<CashEntry> {
  return {
    kind,
    description: "",
    amount: 0,
    currency: "EUR",
    category: "",
    occurred_at: new Date().toISOString().slice(0, 10),
    ticket_id: null,
    note: "",
  };
}

/** Money in, money out — tolerate "375,60" as well as "375.60". */
function toNum(s: string): number {
  const n = parseFloat(s.replace(",", "."));
  return isNaN(n) ? 0 : n;
}

export default function EntryModal({
  entry,
  tickets,
  onSave,
  onClose,
}: {
  entry: Partial<CashEntry>;
  tickets: Ticket[];
  onSave: (e: Partial<CashEntry>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<CashEntry>>(entry);
  const set = <K extends keyof CashEntry>(k: K, v: CashEntry[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Local text so a half-typed "12" isn't reformatted to "12.00" under the cursor.
  const [amountText, setAmountText] = useState(() => (entry.amount ? String(entry.amount) : ""));
  const amount = Math.abs(toNum(amountText));

  // Newest events first — the entry you're filing is usually about a recent one.
  const linkable = useMemo(
    () => [...tickets].sort((a, b) => (b.event_date ?? "").localeCompare(a.event_date ?? "")),
    [tickets]
  );

  const expense = form.kind === "expense";
  const invalid = !form.description?.trim() || amount <= 0;

  function submit() {
    onSave({
      ...form,
      description: form.description?.trim(),
      amount,
      category: form.category?.trim() || null,
      note: form.note?.trim() || null,
      ticket_id: form.ticket_id || null,
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{form.id ? "Edit entry" : "Add income / cost"}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="modal-body">
          {/* Two big buttons rather than a dropdown: which direction the money
              went is the one thing that must never be picked by accident. */}
          <div className="kind-toggle">
            <button type="button" className={"kind-btn" + (!expense ? " is-in" : "")}
                    onClick={() => set("kind", "income")}>+ Income</button>
            <button type="button" className={"kind-btn" + (expense ? " is-out" : "")}
                    onClick={() => set("kind", "expense")}>− Cost</button>
          </div>

          <label className="field">
            <span className="field-label">Description <i className="req">*</i></span>
            <input value={form.description ?? ""} autoFocus
                   onChange={(e) => set("description", e.target.value)}
                   placeholder="prodej kódů LA28" />
          </label>

          <div className="grid-3">
            <label className="field">
              <span className="field-label">Amount <i className="req">*</i></span>
              <input inputMode="decimal" value={amountText} placeholder="300.00"
                     onChange={(e) => setAmountText(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Currency</span>
              <select value={form.currency ?? "EUR"} onChange={(e) => set("currency", e.target.value)}>
                {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Date</span>
              <input type="date" value={form.occurred_at ?? ""}
                     onChange={(e) => set("occurred_at", e.target.value)} />
            </label>
          </div>

          {/* Free text with suggestions — a fixed <select> would force every new
              kind of income into "Other" the first time it happens. */}
          <label className="field">
            <span className="field-label">
              Category<span className="field-hint">optional</span>
            </span>
            <input list="entry-cats" value={form.category ?? ""}
                   onChange={(e) => set("category", e.target.value)} placeholder="Codes" />
            <datalist id="entry-cats">
              {ENTRY_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>

          <label className="field">
            <span className="field-label">
              Related event<span className="field-hint">optional — leave empty if it isn&apos;t about a ticket</span>
            </span>
            <select value={form.ticket_id ?? ""} onChange={(e) => set("ticket_id", e.target.value || null)}>
              <option value="">— not related to a ticket —</option>
              {linkable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.event_name}{t.event_date ? ` · ${t.event_date}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Note<span className="field-hint">optional</span></span>
            <textarea rows={2} value={form.note ?? ""} onChange={(e) => set("note", e.target.value)}
                      placeholder="Additional detail…" />
          </label>

          <div className="sell-preview">
            <span className={expense ? "amount-out" : "amount-in"}>
              {expense ? "−" : "+"}{amount.toFixed(2)} {form.currency ?? "EUR"}
            </span>
            <span className="op">
              {expense ? "leaves" : "lands in"} the cashflow on {form.occurred_at || "—"}
            </span>
          </div>
        </div>

        <footer className="modal-foot">
          {invalid && <span className="foot-hint">Description and an amount above zero are required</span>}
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={invalid} onClick={submit}>
            {form.id ? "Save entry" : expense ? "Add cost" : "Add income"}
          </button>
        </footer>
      </div>
    </div>
  );
}
