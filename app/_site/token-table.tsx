"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TokenRow } from "@/lib/site/explorer";
import { TONE_CHIP, toneOf } from "@/lib/site/verdict";
import { compactMoney, money, pct, pctTone, Sparkline } from "./charts";

type Key = "rank" | "price" | "change_1h" | "change_24h" | "change_7d" | "market_cap" | "volume_24h" | "verdict" | "signals_24h" | "funding_pct" | "oi_usd" | "net_flow_24h" | "top10_pct";
const VERDICT_ORDER: Record<string, number> = { avoid: 0, caution: 1, proceed: 2 };

const COLS: { key: Key; label: string; right?: boolean; title?: string }[] = [
  { key: "rank", label: "#" },
  { key: "price", label: "Price", right: true },
  { key: "change_1h", label: "1h", right: true },
  { key: "change_24h", label: "24h", right: true },
  { key: "change_7d", label: "7d", right: true },
  { key: "market_cap", label: "Market cap", right: true },
  { key: "volume_24h", label: "Volume 24h", right: true },
  { key: "verdict", label: "Check", title: "CoinGraph's latest standard check: proceed / caution / avoid, and which dimension flagged it" },
  { key: "signals_24h", label: "Signals 24h", right: true, title: "Alerts from the signal engine in the last 24 hours" },
  { key: "funding_pct", label: "Funding", right: true, title: "Binance perpetual funding rate per 8h" },
  { key: "oi_usd", label: "Open interest", right: true, title: "Futures open interest across Binance, OKX and Bybit" },
  { key: "net_flow_24h", label: "Exchange flow 24h", right: true, title: "Net USD moved onto (+) or off (−) exchanges, read on chain" },
  { key: "top10_pct", label: "Top 10 hold", right: true, title: "Share of supply held by the ten largest wallets" },
];

export function TokenTable({ rows }: { rows: TokenRow[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "rank", dir: 1 });
  const [filter, setFilter] = useState<"all" | "flagged" | "signals" | "futures">("all");

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    let list = rows.filter((r) => !t || r.symbol.toLowerCase().includes(t) || r.name.toLowerCase().includes(t) || r.id.includes(t));
    if (filter === "flagged") list = list.filter((r) => r.verdict && r.verdict !== "proceed");
    if (filter === "signals") list = list.filter((r) => r.signals_24h > 0);
    if (filter === "futures") list = list.filter((r) => r.oi_usd != null);
    const val = (r: TokenRow): number => {
      if (sort.key === "verdict") return r.verdict ? VERDICT_ORDER[r.verdict] ?? 3 : 4;
      const v = r[sort.key];
      return typeof v === "number" ? v : sort.key === "rank" ? 1e9 : -Infinity;
    };
    return [...list].sort((a, b) => (val(a) - val(b)) * sort.dir);
  }, [rows, q, sort, filter]);

  const head = (c: (typeof COLS)[number]) => (
    <th key={c.key} title={c.title} className={`whitespace-nowrap px-2 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-mist ${c.right ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.key === "rank" ? 1 : -1 }))} className={`hover:text-bone ${sort.key === c.key ? "text-brand" : ""}`}>
        {c.label}{sort.key === c.key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the 100 tracked tokens…" aria-label="Search tokens" className="w-full max-w-xs rounded-lg border border-edge bg-slab px-3 py-1.5 text-[13px] text-bone placeholder:text-mist focus:border-brand/60 focus:outline-none" />
        {([["all", "All"], ["flagged", "Caution / avoid"], ["signals", "With signals"], ["futures", "With futures"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-lg border px-3 py-1.5 text-[12.5px] ${filter === k ? "border-brand/50 bg-brand/10 text-brand" : "border-edge bg-slab text-mist hover:text-bone"}`}>{l}</button>
        ))}
        <span className="ml-auto text-[12px] text-mist">{shown.length} of {rows.length}</span>
      </div>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-edge">
        <table className="w-full min-w-[1180px] text-[12.5px]">
          <thead className="bg-slab"><tr>{COLS.slice(0, 1).map(head)}<th className="px-2 py-2 text-left text-[10.5px] font-semibold uppercase tracking-wider text-mist">Token</th>{COLS.slice(1).map(head)}<th className="px-2 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-mist">7d</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-edge transition-colors hover:bg-slab/60">
                <td className="numerals px-2 py-2 text-mist">{r.rank ?? "—"}</td>
                <td className="px-2 py-2">
                  <Link href={`/tokens/${r.id}`} className="flex items-center gap-2">
                    {r.image ? <img src={r.image} alt="" width={20} height={20} className="rounded-full" loading="lazy" /> : <span className="h-5 w-5 rounded-full bg-edge" />} {/* eslint-disable-line @next/next/no-img-element -- CoinGecko-hosted logo */}
                    <span className="font-semibold text-bone">{r.symbol}</span><span className="truncate text-mist">{r.name}</span>
                  </Link>
                </td>
                <td className="numerals px-2 py-2 text-right">{money(r.price, 4)}</td>
                <td className={`numerals px-2 py-2 text-right ${pctTone(r.change_1h)}`}>{pct(r.change_1h, 1)}</td>
                <td className={`numerals px-2 py-2 text-right ${pctTone(r.change_24h)}`}>{pct(r.change_24h, 1)}</td>
                <td className={`numerals px-2 py-2 text-right ${pctTone(r.change_7d)}`}>{pct(r.change_7d, 1)}</td>
                <td className="numerals px-2 py-2 text-right text-mist">{compactMoney(r.market_cap)}</td>
                <td className="numerals px-2 py-2 text-right text-mist">{compactMoney(r.volume_24h)}</td>
                <td className="px-2 py-2">
                  {r.verdict ? (
                    <Link href={r.eval_id ? `/proof/${r.eval_id}` : `/tokens/${r.id}`} title={r.flagged.length ? `Flagged: ${r.flagged.join(", ")}` : "No dimension flagged"} className={`numerals inline-block rounded border px-1.5 py-0.5 text-[10.5px] font-semibold uppercase ${TONE_CHIP[toneOf(r.verdict)]}`}>{r.verdict}{r.flagged.length ? ` · ${r.flagged[0]}` : ""}</Link>
                  ) : <Link href={`/tokens/${r.id}`} className="text-[11px] text-mist hover:text-brand">check →</Link>}
                </td>
                <td className="numerals px-2 py-2 text-right">{r.signals_24h ? <span className={r.max_severity >= 3 ? "text-blood" : r.max_severity === 2 ? "text-ember" : "text-mist"}>{r.signals_24h}{r.brief_id ? <Link href={`/briefs/${r.brief_id}`} className="ml-1 text-brand" title={r.brief_headline ?? ""}>brief</Link> : null}</span> : <span className="text-mist/50">—</span>}</td>
                <td className={`numerals px-2 py-2 text-right ${r.funding_pct == null ? "text-mist/50" : Math.abs(r.funding_pct) > 0.05 ? "text-ember" : "text-mist"}`}>{r.funding_pct == null ? "—" : `${r.funding_pct.toFixed(3)}%`}</td>
                <td className="numerals px-2 py-2 text-right text-mist">{r.oi_usd == null ? <span className="text-mist/50">—</span> : compactMoney(r.oi_usd)}</td>
                <td className={`numerals px-2 py-2 text-right ${r.net_flow_24h == null ? "text-mist/50" : r.net_flow_24h > 0 ? "text-ember" : "text-life"}`}>{r.net_flow_24h == null ? "—" : `${r.net_flow_24h > 0 ? "+" : "−"}${compactMoney(Math.abs(r.net_flow_24h)).replace("$", "$")}`}</td>
                <td className={`numerals px-2 py-2 text-right ${r.top10_pct == null ? "text-mist/50" : r.top10_pct >= 65 ? "text-ember" : "text-mist"}`}>{r.top10_pct == null ? "—" : `${Math.round(r.top10_pct)}%`}</td>
                <td className="px-2 py-1"><Sparkline points={r.spark} /></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={16} className="px-3 py-4 text-mist">No tokens match.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
