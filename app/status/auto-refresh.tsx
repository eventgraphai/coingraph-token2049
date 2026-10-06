"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Re-renders the server page every `seconds` and shows how fresh the view is.
export function AutoRefresh({ seconds = 30, renderedAt, title }: { seconds?: number; renderedAt: string; title?: string }) {
  const router = useRouter();

  // Status in the browser tab title, so problems are visible from other tabs. Re-applied every second
  // because Next.js re-applies the page metadata title after navigation and refreshes.
  useEffect(() => {
    if (!title) return;
    document.title = title;
    const keep = setInterval(() => {
      if (document.title !== title) document.title = title;
    }, 1000);
    return () => clearInterval(keep);
  }, [title]);
  // Start from the render time so server and client markup match; the interval takes over after hydration.
  const [now, setNow] = useState(() => new Date(renderedAt).getTime());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (paused) return;
    const refresh = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(refresh);
  }, [paused, router, seconds]);

  const age = Math.max(0, Math.round((now - new Date(renderedAt).getTime()) / 1000));

  return (
    <div className="flex items-center gap-3 text-xs text-mist">
      <span className="tabular-nums">Updated {age}s ago</span>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="rounded-md border border-edge px-2.5 py-1 text-bone transition-colors hover:bg-slab-raised focus-visible:outline-2 focus-visible:outline-brand"
      >
        {paused ? "Resume auto-refresh" : `Auto-refresh ${seconds}s · pause`}
      </button>
      <button
        type="button"
        onClick={() => router.refresh()}
        className="rounded-md border border-edge px-2.5 py-1 text-bone transition-colors hover:bg-slab-raised focus-visible:outline-2 focus-visible:outline-brand"
      >
        Refresh now
      </button>
    </div>
  );
}
