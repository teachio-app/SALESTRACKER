"use client";

import { useEffect, useState } from "react";
import type { Ticket } from "@/lib/supabase";
import PurchaseModal, { EMPTY_PURCHASE } from "@/app/PurchaseModal";
import SellModal from "@/app/SellModal";
import Sidebar from "./Sidebar";
import { DashProvider, type DashCtx } from "./DashContext";

// Owns the ticket data and the modals for the whole dashboard, and hands them to
// both pages (events table, charts) through context — so the sidebar's Add
// button and the table's Edit/Sell buttons all drive the same modal state, and
// there's one fetch regardless of which page you're on.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Ticket> | null>(null);
  const [selling, setSelling] = useState<Ticket | null>(null);
  // Shared across Events + Charts so the chosen window carries between pages.
  const [period, setPeriod] = useState("all");

  // `silent` refetches without flipping the full-page loading state. The loading
  // state swaps the whole table for a "Loading…" line, which collapses the page
  // and throws the scroll back to the top. Only the FIRST load shows it; every
  // refetch after an edit is silent, so the list stays put where you are.
  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/tickets");
      const body = await res.json();
      if (!res.ok || !Array.isArray(body)) {
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      setTickets(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (!silent) setTickets([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function save(t: Partial<Ticket>) {
    const method = t.id ? "PATCH" : "POST";
    // Optimistic: reflect an edit on the row immediately so a checkbox/dropdown
    // doesn't wait on the round trip. Stable keys mean React updates in place —
    // no unmount, no scroll jump. The silent refetch then reconciles with what
    // the server actually stored (generated profit, sold_at, …).
    if (t.id) setTickets((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...t } : x)));
    setEditing(null);
    setSelling(null);
    await fetch("/api/tickets", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t),
    });
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

  const ctx: DashCtx = {
    tickets,
    loading,
    error,
    reload: load,
    save,
    remove,
    setStatus: (t, status) => save({ id: t.id, status }),
    togglePaid: (t) => save({ id: t.id, paid_out: !t.paid_out }),
    period,
    setPeriod,
    openAdd: () => setEditing({ ...EMPTY_PURCHASE }),
    openEdit: (t) => setEditing({ ...t }),
    openSell: (t) => setSelling(t),
    copyRow: (t) => {
      const { id, created_at, updated_at, profit, external_id, sold_at, ...rest } = t;
      setEditing({ ...rest, event_name: t.event_name + " (copy)" });
    },
  };

  return (
    <DashProvider value={ctx}>
      <div className="app">
        <Sidebar />
        <main className="main">{children}</main>
      </div>
      {editing && <PurchaseModal ticket={editing} onSave={save} onClose={() => setEditing(null)} />}
      {selling && <SellModal ticket={selling} onSave={save} onClose={() => setSelling(null)} />}
    </DashProvider>
  );
}
