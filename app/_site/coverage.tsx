import Link from "next/link";
import type { Coverage } from "@/lib/site/data";

const CHAIN: Record<string, string> = { eth: "Ethereum", bsc: "BNB Chain", btc: "Bitcoin", sol: "Solana", ada: "Cardano" };

// "Which tokens?" answered in one glance: the tracked universe by rank, read live from the database.
export function CoverageStrip({ c }: { c: Coverage }) {
  const shown = c.top.filter((t) => !t.stablecoin).slice(0, 24);
  const stables = c.top.filter((t) => t.stablecoin).slice(0, 4).map((t) => t.symbol);
  return (
    <div className="rounded-2xl border border-edge bg-slab p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">The {c.total} largest tokens, tracked around the clock</p>
        <Link href="/tokens" className="text-[12px] text-brand hover:underline">Open the token explorer →</Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {shown.map((t) => (
          <span key={t.symbol} title={t.name} className="numerals rounded-md border border-edge bg-ink px-2 py-1 text-[12px] text-bone">
            {t.symbol}
          </span>
        ))}
        <span className="numerals rounded-md border border-dashed border-edge px-2 py-1 text-[12px] text-mist">+ {c.total - shown.length} more incl. {stables.join(", ")}</span>
      </div>
      <div className="mt-4 grid gap-3 text-[13px] sm:grid-cols-3">
        <div>
          <p className="numerals text-[10px] uppercase tracking-[0.14em] text-mist">Read on chain</p>
          <p className="mt-1 text-bone/90">{c.chains.map((x) => CHAIN[x] ?? x).join(", ")}</p>
        </div>
        <div>
          <p className="numerals text-[10px] uppercase tracking-[0.14em] text-mist">Order books and futures</p>
          <p className="mt-1 text-bone/90">{c.venues.map((v) => v[0].toUpperCase() + v.slice(1)).join(", ")}</p>
        </div>
        <div>
          <p className="numerals text-[10px] uppercase tracking-[0.14em] text-mist">Sectors covered</p>
          <p className="mt-1 text-bone/90">{c.categories.slice(0, 5).map((x) => x.name).join(", ")}</p>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-mist">Any other coin, 21,000+ of them, is searchable and gets a lighter check on demand.</p>
    </div>
  );
}
