"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DOCS_NAV } from "@/lib/docs/nav";

/* ---------------------------------------------------------------- Copy */
export function Copy({ text, className = "" }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy to clipboard"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* blocked */ }
      }}
      className={`numerals rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-[#a6adbb] transition-colors hover:border-[#b4de6d]/50 hover:text-[#b4de6d] ${className}`}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/* ---------------------------------------------------------------- Code with language tabs */
export type Sample = { label: string; code: string; node?: ReactNode };
export function CodeTabs({ samples, title }: { samples: Sample[]; title?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const r = requestAnimationFrame(() => {
      try { const saved = localStorage.getItem("cg-docs-lang"); const k = samples.findIndex((s) => s.label === saved); if (k >= 0) setI(k); } catch { /* storage off */ }
    });
    return () => cancelAnimationFrame(r);
  }, [samples]);
  const pick = (k: number) => { setI(k); try { localStorage.setItem("cg-docs-lang", samples[k].label); } catch { /* storage off */ } };
  const s = samples[Math.min(i, samples.length - 1)];
  return (
    <div className="instrument my-5 overflow-hidden rounded-xl border border-white/10 bg-[#14181f]">
      <div className="flex items-center gap-1 border-b border-white/10 px-2">
        {title && <span className="numerals mr-2 pl-1 text-[11px] text-[#858da0]">{title}</span>}
        {samples.length > 1
          ? samples.map((x, k) => (
              <button key={x.label} type="button" onClick={() => pick(k)} className={`-mb-px border-b-2 px-2.5 py-2 text-[12px] transition-colors ${k === i ? "border-[#b4de6d] text-[#e8ecf2]" : "border-transparent text-[#858da0] hover:text-[#e8ecf2]"}`}>
                {x.label}
              </button>
            ))
          : !title && <span className="numerals py-2 pl-1 text-[11px] text-[#858da0]">{s.label}</span>}
        <span className="ml-auto py-1.5"><Copy text={s.code} /></span>
      </div>
      <pre className="numerals max-h-[560px] overflow-auto px-4 py-3.5 text-[12.5px] leading-[1.7] text-[#e8ecf2]"><code>{s.node ?? s.code}</code></pre>
    </div>
  );
}

/* ---------------------------------------------------------------- Theme toggle */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setDark(document.documentElement.dataset.docsTheme === "dark"));
    return () => cancelAnimationFrame(r);
  }, []);
  const flip = () => {
    const next = !dark;
    if (next) document.documentElement.dataset.docsTheme = "dark";
    else delete document.documentElement.dataset.docsTheme;
    setDark(next);
    try { localStorage.setItem("cg-docs-theme", next ? "dark" : "light"); } catch { /* storage off */ }
  };
  return (
    <button type="button" onClick={flip} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} className="grid h-8 w-8 place-items-center rounded-lg border border-edge text-mist transition-colors hover:text-bone">
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      )}
    </button>
  );
}

/* ---------------------------------------------------------------- Sidebar with filter + mobile drawer */
export function Sidebar() {
  const path = usePathname();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(path);
  // Close the mobile drawer after navigating.
  if (open && openedAt !== path) { setOpen(false); setOpenedAt(path); }
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return DOCS_NAV;
    return DOCS_NAV.map((g) => ({ ...g, links: g.links.filter((l) => `${l.title} ${l.description} ${l.href}`.toLowerCase().includes(t)) })).filter((g) => g.links.length);
  }, [q]);

  const list = (
    <nav aria-label="Documentation" className="space-y-6 pb-10">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-mist">{g.title}</p>
          <ul className="space-y-px">
            {g.links.map((l) => {
              const active = path === l.href;
              return (
                <li key={l.href}>
                  <Link href={l.href} className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[13.5px] transition-colors ${active ? "bg-brand/10 font-medium text-brand" : "text-bone/80 hover:bg-slab hover:text-bone"}`}>
                    <span className="truncate">{l.title}</span>
                    {l.badge && g.title === "API reference" && <span className="numerals shrink-0 text-[9.5px] text-mist">{l.badge.replace(" ", "·")}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!groups.length && <p className="px-2 text-[13px] text-mist">No pages match “{q}”.</p>}
    </nav>
  );

  const filter = (
    <div className="relative mb-5">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter pages…" aria-label="Filter pages" className="w-full rounded-lg border border-edge bg-slab px-3 py-1.5 text-[13px] text-bone placeholder:text-mist focus:border-brand/60 focus:outline-none" />
    </div>
  );

  return (
    <>
      <div className="sticky top-14 z-30 -mx-4 border-b border-edge bg-void/95 px-4 py-2 backdrop-blur lg:hidden">
        <button type="button" onClick={() => { setOpenedAt(path); setOpen((o) => !o); }} aria-expanded={open} className="flex items-center gap-2 text-[13px] text-bone">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={open ? "M6 6l12 12M18 6L6 18" : "M4 6h16M4 12h16M4 18h16"} /></svg>
          {open ? "Close menu" : "Menu"}
        </button>
        {open && <div className="mt-3 max-h-[70vh] overflow-y-auto">{filter}{list}</div>}
      </div>
      <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] overflow-y-auto py-8 pr-4 lg:block">
        {filter}
        {list}
      </aside>
    </>
  );
}

/* ---------------------------------------------------------------- On this page */
export function Toc() {
  const path = usePathname();
  const [items, setItems] = useState<{ id: string; text: string; level: number }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const hs = [...document.querySelectorAll<HTMLElement>("#doc-content h2[id], #doc-content h3[id]")];
    const r = requestAnimationFrame(() => setItems(hs.map((h) => ({ id: h.id, text: (h.dataset.toc ?? h.textContent ?? "").replace(/\s*#$/, ""), level: h.tagName === "H2" ? 2 : 3 }))));
    const io = new IntersectionObserver((es) => { const v = es.filter((e) => e.isIntersecting); if (v[0]) setActive(v[0].target.id); }, { rootMargin: "-80px 0px -70% 0px" });
    hs.forEach((h) => io.observe(h));
    return () => { cancelAnimationFrame(r); io.disconnect(); };
  }, [path]);
  if (items.length < 2) return null;
  return (
    <nav aria-label="On this page" className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] overflow-y-auto py-8 xl:block">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-mist">On this page</p>
      <ul className="space-y-1.5 border-l border-edge">
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} className={`-ml-px block border-l py-0.5 text-[12.5px] leading-snug transition-colors ${i.level === 3 ? "pl-6" : "pl-3"} ${active === i.id ? "border-brand text-brand" : "border-transparent text-mist hover:text-bone"}`}>
              {i.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
