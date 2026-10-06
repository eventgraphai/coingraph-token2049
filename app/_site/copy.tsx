"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked: the text is still visible to select */
        }
      }}
      className="numerals shrink-0 rounded-md border border-edge bg-slab px-2 py-1 text-[11px] text-mist transition-colors hover:border-brand/40 hover:text-brand"
    >
      {done ? "Copied" : label}
    </button>
  );
}

// A terminal-style snippet with a copy button.
export function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-edge bg-ink">
      <div className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2">
        <span className="numerals text-[11px] uppercase tracking-[0.12em] text-mist">{title}</span>
        <CopyButton text={code} />
      </div>
      <pre className="numerals overflow-x-auto px-4 py-3 text-[12.5px] leading-relaxed text-bone/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}
