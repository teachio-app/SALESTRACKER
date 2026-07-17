"use client";

import { createContext, useContext } from "react";
import type { Ticket } from "@/lib/supabase";

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
  openAdd: () => void;
  openEdit: (t: Partial<Ticket>) => void;
  openSell: (t: Ticket) => void;
  copyRow: (t: Ticket) => void;
};

const Ctx = createContext<DashCtx | null>(null);
export const DashProvider = Ctx.Provider;

export function useDash(): DashCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDash must be used inside the (app) layout");
  return c;
}
