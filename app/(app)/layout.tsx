"use client";

import { useEffect, useRef, useState } from "react";
import { saleTotals, type CashEntry, type Ticket, type Todo } from "@/lib/supabase";
import PurchaseModal, { EMPTY_PURCHASE } from "@/app/PurchaseModal";
import SellModal from "@/app/SellModal";
import EntryModal, { emptyEntry } from "@/app/EntryModal";
import Sidebar from "./Sidebar";
import LinkModal from "./LinkModal";
import { DashProvider, type DashCtx } from "./DashContext";

// Owns the ticket data and the modals for the whole dashboard, and hands them to
// both pages (events table, charts) through context — so the sidebar's Add
// button and the table's Edit/Sell buttons all drive the same modal state, and
// there's one fetch regardless of which page you're on.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [todosError, setTodosError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Ticket> | null>(null);
  const [selling, setSelling] = useState<Ticket | null>(null);
  const [linking, setLinking] = useState<Ticket | null>(null);
  const [entryDraft, setEntryDraft] = useState<Partial<CashEntry> | null>(null);
  // Shared across Events + Charts so the chosen window carries between pages.
  const [period, setPeriod] = useState("all");

  // `silent` refetches without flipping the full-page loading state. The loading
  // state swaps the whole table for a "Loading…" line, which collapses the page
  // and throws the scroll back to the top. Only the FIRST load shows it; every
  // refetch after an edit is silent, so the list stays put where you are.
  // Signature of the last data we rendered (row count + newest updated_at). A
  // background poll only re-renders when this changes, so an idle tab isn't
  // churning the table every few seconds.
  const sigRef = useRef({ tickets: "", entries: "", todos: "" });

  async function load(silent = false) {
    if (!silent) setLoading(true);
    // allSettled, not all: these lists live in separate tables and one being
    // unreachable (e.g. `todos` before schema.sql has been re-run) must not
    // take the others' pages down with it.
    const [t, e, d] = await Promise.allSettled([
      fetchList<Ticket>("/api/tickets"),
      fetchList<CashEntry>("/api/entries"),
      fetchList<Todo>("/api/todos"),
    ]);

    if (t.status === "fulfilled") {
      const sig = signature(t.value);
      if (sig !== sigRef.current.tickets) {
        sigRef.current.tickets = sig;
        setTickets(t.value);
      }
      setError(null);
    } else {
      setError(message(t.reason));
      if (!silent) setTickets([]);
    }

    if (e.status === "fulfilled") {
      const sig = signature(e.value);
      if (sig !== sigRef.current.entries) {
        sigRef.current.entries = sig;
        setEntries(e.value);
      }
      setEntriesError(null);
    } else {
      setEntriesError(message(e.reason));
      if (!silent) setEntries([]);
    }

    if (d.status === "fulfilled") {
      const sig = signature(d.value);
      if (sig !== sigRef.current.todos) {
        sigRef.current.todos = sig;
        setTodos(d.value);
      }
      setTodosError(null);
    } else {
      setTodosError(message(d.reason));
      if (!silent) setTodos([]);
    }

    if (!silent) setLoading(false);
  }

  // Live-ish: poll every 15s so a sale the mail poller just added appears without
  // a manual refresh. Only while the tab is visible (no work in a backgrounded
  // tab), and refetch the moment you switch back so it's fresh instantly.
  useEffect(() => {
    load();
    const POLL_MS = 15000;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { timer ??= setInterval(() => load(true), POLL_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { load(true); start(); } else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { stop(); document.removeEventListener("visibilitychange", onVisibility); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(t: Partial<Ticket>) {
    const method = t.id ? "PATCH" : "POST";
    // Optimistic: reflect an edit on the row immediately so a checkbox/dropdown
    // doesn't wait on the round trip. Stable keys mean React updates in place —
    // no unmount, no scroll jump. The silent refetch then reconciles with what
    // the server actually stored (generated profit, sold_at, …).
    if (t.id) setTickets((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...t } : x)));
    setEditing(null);
    setSelling(null);
    const res = await fetch("/api/tickets", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t),
    });
    // Surface a failed save instead of silently reverting on the next reload.
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(`Save failed: ${b.error ?? res.status}`);
    }
    load(true);
  }

  async function remove(id: string) {
    if (!confirm("Delete this row?")) return;
    // Drop it locally first, then confirm with a silent refetch.
    setTickets((prev) => prev.filter((x) => x.id !== id));
    await fetch("/api/tickets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load(true);
  }

  // ── Bulk actions ── the confirm lives here, once, so every caller gets it.
  async function removeMany(ids: string[]) {
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} row${ids.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
    const gone = new Set(ids);
    setTickets((prev) => prev.filter((x) => !gone.has(x.id)));
    const res = await fetch("/api/tickets", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(`Delete failed: ${b.error ?? res.status}`);
    }
    load(true);
  }

  async function patchMany(ids: string[], patch: Partial<Ticket>) {
    if (!ids.length) return;
    const hit = new Set(ids);
    setTickets((prev) => prev.map((x) => (hit.has(x.id) ? { ...x, ...patch } : x)));
    const res = await fetch("/api/tickets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, ...patch }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(`Update failed: ${b.error ?? res.status}`);
    }
    load(true);
  }

  // ── Cash entries ── same optimistic pattern as tickets, own error slot.
  async function saveEntry(e: Partial<CashEntry>) {
    const method = e.id ? "PATCH" : "POST";
    if (e.id) setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, ...e } : x)));
    setEntryDraft(null);
    const res = await fetch("/api/entries", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(e),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setEntriesError(`Save failed: ${b.error ?? res.status}`);
    }
    load(true);
  }

  async function removeEntry(id: string) {
    if (!confirm("Delete this entry?")) return;
    setEntries((prev) => prev.filter((x) => x.id !== id));
    await fetch("/api/entries", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load(true);
  }

  // ── To-do ── ticking a box must feel instant, so every change is optimistic
  // and the silent refetch reconciles (done_at is stamped by a trigger).
  async function saveTodo(t: Partial<Todo>) {
    if (t.id) setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...t } : x)));
    const res = await fetch("/api/todos", {
      method: t.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setTodosError(`Save failed: ${b.error ?? res.status}`);
    }
    load(true);
  }

  async function removeTodo(id: string) {
    setTodos((prev) => prev.filter((x) => x.id !== id));
    await fetch("/api/todos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load(true);
  }

  async function clearDoneTodos() {
    const n = todos.filter((t) => t.done).length;
    if (!n || !confirm(`Delete ${n} finished item${n === 1 ? "" : "s"}?`)) return;
    setTodos((prev) => prev.filter((t) => !t.done));
    await fetch("/api/todos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doneOnly: true }),
    });
    load(true);
  }

  const ctx: DashCtx = {
    tickets,
    loading,
    error,
    reload: load,
    save,
    remove,
    setStatus: (t, status) => save({ id: t.id, status }),
    togglePaid: (t) => save({ id: t.id, paid_out: !t.paid_out }),
    // Flag toggles the red glow. Turning it ON offers a quick note prompt (bad
    // refund, wrong amount…); turning it OFF clears both flag and note. The note
    // is also editable in the edit modal for anything longer.
    toggleFlag: (t) => {
      if (t.flagged) {
        save({ id: t.id, flagged: false, flag_note: null });
        return;
      }
      const note = window.prompt("What's wrong with this transaction? (optional)", "");
      save({ id: t.id, flagged: true, flag_note: note?.trim() || null });
    },
    period,
    setPeriod,
    openAdd: () => setEditing({ ...EMPTY_PURCHASE }),
    openEdit: (t) => setEditing({ ...t }),
    openSell: (t) => setSelling(t),
    copyRow: (t) => {
      const { id, created_at, updated_at, profit, external_id, sold_at, ...rest } = t;
      // A copy is a fresh purchase: keep the buy side, clear the sale side.
      setEditing({
        ...rest, event_name: t.event_name + " (copy)",
        sales: [], qty_sold: 0, sell_price: 0, status: "not_listed", paid_out: false,
        flagged: false, flag_note: null,
      });
    },
    openLink: (t) => setLinking(t),
    removeMany,
    patchMany,
    // Move the review row's sell side onto the chosen purchase, then delete the
    // review row. Optimistic drop of the review row keeps the list steady.
    linkSale: async (reviewRow, purchase) => {
      setLinking(null);
      setTickets((prev) => prev.filter((x) => x.id !== reviewRow.id));
      // Move the review row's sales onto the purchase and re-sum the aggregates.
      const fills = [...(purchase.sales ?? []), ...(reviewRow.sales ?? [])];
      const t = saleTotals(fills);
      await fetch("/api/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: purchase.id,
          sales: fills,
          qty_sold: Math.min(purchase.qty_total, t.qty),
          status: "sold",
          sell_price: t.amount,
          sold_at: reviewRow.sold_at,
          order_ref: reviewRow.order_ref ?? purchase.order_ref,
        }),
      });
      await fetch("/api/tickets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reviewRow.id }),
      });
      load(true);
    },

    entries,
    entriesError,
    saveEntry,
    removeEntry,
    openEntry: (e) => setEntryDraft({ ...emptyEntry(), ...e }),

    todos,
    todosError,
    saveTodo,
    removeTodo,
    clearDoneTodos,
  };

  return (
    <DashProvider value={ctx}>
      <div className="app">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
      {editing && <PurchaseModal ticket={editing} onSave={save} onClose={() => setEditing(null)} />}
      {selling && <SellModal ticket={selling} onSave={save} onClose={() => setSelling(null)} />}
      {linking && <LinkModal reviewRow={linking} onClose={() => setLinking(null)} />}
      {entryDraft && (
        <EntryModal entry={entryDraft} tickets={tickets} onSave={saveEntry}
                    onClose={() => setEntryDraft(null)} />
      )}
    </DashProvider>
  );
}

/** GET a list endpoint, turning a non-200 or a non-array body into a throw. */
async function fetchList<T>(url: string): Promise<T[]> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) {
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return body as T[];
}

/** Row count + newest updated_at: changes only when the data actually did, so an
 *  idle tab's 15s poll doesn't re-render the table every time. */
function signature(rows: { updated_at: string }[]): string {
  return rows.length + "|" + rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
