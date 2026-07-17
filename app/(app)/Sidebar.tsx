"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDash } from "./DashContext";

// Rename the app here.
const APP_NAME = "TICKETDESK";

export default function Sidebar() {
  const path = usePathname();
  const { openAdd, tickets } = useDash();
  const reviewCount = tickets.filter((t) => t.needs_review).length;

  const NAV = [
    { href: "/", label: "Events", badge: 0 },
    { href: "/charts", label: "Charts", badge: 0 },
    { href: "/review", label: "Review", badge: reviewCount },
  ];

  return (
    <aside className="sidebar">
      <div className="logo">
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
      </div>
      <button className="nav-btn nav-add" onClick={openAdd}>+ Add purchase</button>
      {NAV.map((n) => (
        <Link key={n.href} href={n.href}
              className={"nav-btn" + (path === n.href ? " is-active" : "")}>
          {n.label}
          {n.badge > 0 && <span className="nav-badge">{n.badge}</span>}
        </Link>
      ))}
    </aside>
  );
}
