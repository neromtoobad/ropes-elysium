"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV } from "@/docs/nav";

export function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const current = path === "/docs" ? "/docs/overview" : path;
  return (
    <>
      <button className="docs-menu" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Close menu" : "Docs menu"}
      </button>
      <nav className={`docs-side ${open ? "open" : ""}`} aria-label="docs">
        {NAV.map((s) => (
          <div key={s.title} className="docs-side-group">
            <p>{s.title}</p>
            {s.pages.map((p) => {
              const href = `/docs/${p.slug}`;
              return (
                <Link key={p.slug} href={href} className={current === href ? "active" : ""} onClick={() => setOpen(false)}>
                  {p.title}
                </Link>
              );
            })}
          </div>
        ))}
        <div className="docs-side-group">
          <p>Live</p>
          <Link href="/transparency" className={path === "/transparency" ? "active" : ""}>Transparency ↗</Link>
          <Link href="/play">Play ↗</Link>
        </div>
      </nav>
    </>
  );
}
