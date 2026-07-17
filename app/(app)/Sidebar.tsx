"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDash } from "./DashContext";

// Rename the app here.
const APP_NAME = "TICKETDESK";

const NAV = [
  { href: "/", label: "Events" },
  { href: "/charts", label: "Charts" },
];

export default function Sidebar() {
  const path = usePathname();
  const { openAdd } = useDash();

  return (
    <aside className="sidebar">
      <div className="logo">{APP_NAME}</div>
      <button className="nav-btn nav-add" onClick={openAdd}>+ Add purchase</button>
      {NAV.map((n) => (
        <Link key={n.href} href={n.href}
              className={"nav-btn" + (path === n.href ? " is-active" : "")}>
          {n.label}
        </Link>
      ))}
    </aside>
  );
}
