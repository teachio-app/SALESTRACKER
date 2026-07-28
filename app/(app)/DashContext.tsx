"use client";

import { createContext, useContext } from "react";
import type { CashEntry, Ticket } from "@/lib/supabase";

// Shared data + actions, provided by the (app) layout and consumed by both the
// events table and the charts page. Fetched once per navigation into the group,
// so a page switch doesn't refetch on its own but a mutation calls reload().
export type DashCtx = {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  save: (t: Partial<Ticket>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setStatus: (t: Ticket, status: Ticket["status"]) => Promise<void>;
  togglePaid: (t: Ticket) => Promise<void>;
  /** Flag / unflag a problem with the transaction (prompts for a note on flag). */
  toggleFlag: (t: Ticket) => void;
  period: string;
  setPeriod: (p: string) => void;
  openAdd: () => void;
  openEdit: (t: Partial<Ticket>) => void;
  openSell: (t: Ticket) => void;
  copyRow: (t: Ticket) => void;
  openLink: (reviewRow: Ticket) => void;
  /** Merge a flagged sale into an existing purchase, then drop the sale row. */
  linkSale: (reviewRow: Ticket, purchase: Ticket) => Promise<void>;

  // ── Cashflow: manual money in / out, ticket-related or not ──
  entries: CashEntry[];
  /** Kept apart from `error` so a missing `entries` table can't blank the events page. */
  entriesError: string | null;
  saveEntry: (e: Partial<CashEntry>) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;
  /** Open the entry modal — prefilled when the quick-add row hands over a draft. */
  openEntry: (e?: Partial<CashEntry>) => void;
};

const Ctx = createContext<DashCtx | null>(null);
export const DashProvider = Ctx.Provider;

export function useDash(): DashCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDash must be used inside the (app) layout");
  return c;
}
