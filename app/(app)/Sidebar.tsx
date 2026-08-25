"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { todoCounts } from "@/lib/supabase";
import { useDash } from "./DashContext";

// Rename the app here.
const APP_NAME = "DESKTRACKER";

export default function Sidebar() {
  const path = usePathname();
  const { openAdd, openEntry, tickets, todos } = useDash();
  const reviewCount = tickets.filter((t) => t.needs_review).length;
  const todoCount = todoCounts(todos);

  const NAV = [
    { href: "/", label: "Overview", badge: 0, alert: false },
    { href: "/events", label: "Events", badge: 0, alert: false },
    { href: "/cashflow", label: "Cashflow", badge: 0, alert: false },
    { href: "/charts", label: "Charts", badge: 0, alert: false },
    { href: "/review", label: "Review", badge: reviewCount, alert: false },
    // The badge counts what's still open; it turns red once something is late,
    // so a missed deadline is visible from any page without opening the list.
    { href: "/todo", label: "To do", badge: todoCount.open, alert: todoCount.overdue > 0 },
    { href: "/scanner", label: "Scanner", badge: 0, alert: false },
  ];

  return (
    <aside className="sidebar">
      {/* The logo is the way home, the way it is on every other site. */}
      <Link className="logo" href="/">
        <span className="logo-mark" aria-hidden>
          <svg viewBox="0 0 64 64">
            <defs>
              <linearGradient id="tmark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#4b93e8" />
                <stop offset="1" stopColor="#2a78d6" />
              </linearGradient>
            </defs>
            <rect width="64" height="64" rx="15" fill="url(#tmark)" />
            <path d="M16 17 H48 V26 H36.5 V49 H27.5 V26 H16 Z" fill="#fff" />
          </svg>
        </span>
        {APP_NAME}
      </Link>
      <button className="nav-btn nav-add" onClick={openAdd}>+ Add purchase</button>
      {/* Money that isn't a ticket batch — reachable from every page, because
          "I just got paid for the LA28 codes" happens wherever you are. */}
      <button className="nav-btn nav-add-alt" onClick={() => openEntry()}>+ Add income / cost</button>
      {NAV.map((n) => (
        <Link key={n.href} href={n.href}
              className={"nav-btn" + (path === n.href ? " is-active" : "")}>
          {n.label}
          {n.badge > 0 && (
            <span className={"nav-badge" + (n.alert ? " is-late" : "")}>{n.badge}</span>
          )}
        </Link>
      ))}
    </aside>
  );
}
