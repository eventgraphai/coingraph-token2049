import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { sql } from "@/lib/db";
import { AutoRefresh } from "../status/auto-refresh";

export const metadata: Metadata = {
  title: "Signals — CoinGraph",
  description: "What the signal engine flagged across the top 100 coins, and the investigations it opened.",
};

type Signal = {
  id: number; coin: string; symbol: string | null; kind: string; direction: string; severity: number;
  value: string | null; baseline: string | null; ratio: string | null; event_ts: Date; detected_at: Date; investigation_id: number | null; details: Record<string, unknown> | null;
};
type Investigation = { id: number; coingecko_id: string; symbol: string; status: string; score: string; opened_at: Date; headline: string | null; signals: number };
type KindCount = { kind: string; n: number };

const KIND_LABEL: Record<string, string> = {
  price_move: "Price move", volume_spike: "Volume spike", oi_change: "Open interest", funding_extreme: "Funding extreme",
  liquidation_cluster: "Liquidations", exchange_inflow: "Exchange inflow", exchange_outflow: "Exchange outflow",
  whale_transfer: "Whale transfer", stablecoin_exchange_inflow: "Stablecoins → exchanges", positioning_extreme: "Positioning",
  news_burst: "In the news", tvl_drop: "TVL drop",
};
const SEVERITY = { 1: "text-mist", 2: "text-ember", 3: "text-blood" } as Record<number, string>;
const DIRECTION = { up: "▲", down: "▼", neutral: "•" } as Record<string, string>;

const money = (v: string | number | null) => (v == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(v)));
const ago = (d: Date | string, now: Date) => {
  const s = Math.max(0, Math.round((now.getTime() - new Date(d).getTime()) / 1000));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

function describe(s: Signal): string {
  const d = s.details ?? {};
  switch (s.kind) {
    case "price_move": return `${Number(d.ret_1h_pct) > 0 ? "+" : ""}${Number(d.ret_1h_pct).toFixed(2)}% in 1h (${Number(d.ret_15m_pct) > 0 ? "+" : ""}${Number(d.ret_15m_pct).toFixed(2)}% in 15m), ${Number(d.z_1h).toFixed(1)}σ vs its 24h volatility`;
    case "volume_spike": return `$${money(d.volume_usd_15m as number)} traded in 15 min, ${s.ratio}× the 24h median`;
    case "oi_change": return `open interest ${Number(d.change_pct) > 0 ? "+" : ""}${Number(d.change_pct).toFixed(1)}% in 1h to $${money(d.oi_usd as number)}`;
    case "funding_extreme": return `funding ${Number(d.funding_rate_pct).toFixed(3)}% per 8h (${s.direction === "up" ? "longs" : "shorts"} paying)`;
    case "liquidation_cluster": return `$${money(d.liquidated_usd_15m as number)} liquidated in 15 min, ${s.ratio}× normal`;
    case "exchange_inflow": return `$${money(Math.abs(Number(s.value)))} net moved onto exchanges in 30 min (${s.ratio ?? "—"}× the 7-day median)`;
    case "exchange_outflow": return `$${money(Math.abs(Number(s.value)))} net withdrawn from exchanges in 30 min (${s.ratio ?? "—"}× the 7-day median)`;
    case "whale_transfer": {
      const where = d.direction === "exchange_internal" ? `moved internally at ${d.from_entity}` : d.direction === "mint" ? "minted" : d.direction === "burn" ? "burned"
        : `${d.from_entity ? `from ${d.from_entity}` : ""} ${d.to_entity ? `to ${d.to_entity}` : d.direction === "other" ? "between wallets" : ""}`.trim();
      return `$${money(d.amount_usd as number)} ${where} on ${String(d.chain).toUpperCase()}`;
    }
    case "stablecoin_exchange_inflow": return `$${money(s.value)} of stablecoins moved onto exchanges in 1h (${s.ratio ?? "—"}× the 7-day median)`;
    case "positioning_extreme": return `top traders' long/short ${s.value} vs 7-day average ${s.baseline}`;
    case "news_burst": return `${d.headlines} headlines in 2h — latest: "${d.latest}"`;
    case "tvl_drop": return `${d.protocol} TVL ${Number(d.change_1d_pct).toFixed(1)}% in a day to $${money(d.tvl_usd as number)}`;
    default: return "";
  }
}

export default async function SignalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const token = process.env.STATUS_TOKEN;
  if (token && (await searchParams).token !== token) notFound();

  const [signals, investigations, kinds, [{ now }]] = await Promise.all([
    sql<Signal[]>`
      select s.id, coalesce(s.coingecko_id, 'market') as coin, upper(t.symbol) as symbol, s.kind, s.direction, s.severity, s.value, s.baseline, s.ratio,
             s.event_ts, s.detected_at, s.investigation_id, s.details
      from signals s left join tokens t using (coingecko_id)
      where s.detected_at > now() - interval '24 hours' order by s.detected_at desc limit 150`,
    sql<Investigation[]>`
      select i.id, i.coingecko_id, upper(t.symbol) as symbol, i.status, i.score, i.opened_at, i.headline, cardinality(i.trigger_signal_ids) as signals
      from investigations i join tokens t using (coingecko_id) order by i.opened_at desc limit 30`,
    sql<KindCount[]>`select kind, count(*)::int as n from signals where detected_at > now() - interval '24 hours' group by 1 order by 2 desc`,
    sql<{ now: Date }[]>`select now() as now`,
  ]);
  const at = new Date(now);
  const open = investigations.filter((i) => i.status === "queued" || i.status === "running").length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="numerals text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">Signal engine</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">What stands out across the top 100</h1>
          <p className="mt-1 text-sm text-mist">Nine rules run every minute over the stored market, exchange and onchain data. No API calls. One signal per coin, rule and 15-minute window. {signals.length} signals in 24h.</p>
        </div>
        <AutoRefresh seconds={60} renderedAt={at.toISOString()} title={open ? `${open} open — Signals` : "Signals — CoinGraph"} />
      </header>

      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kinds.map((k) => (
          <div key={k.kind} className="rounded-xl border border-edge bg-slab px-4 py-3">
            <div className="text-[11px] uppercase tracking-wide text-mist">{KIND_LABEL[k.kind] ?? k.kind}</div>
            <div className="numerals mt-1 text-xl font-semibold">{k.n}</div>
          </div>
        ))}
        {!kinds.length && <div className="text-sm text-mist">Nothing unusual in the last 24 hours.</div>}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-mist">Investigations {open ? <span className="ml-2 rounded-full bg-ember/15 px-2 py-0.5 text-xs text-ember">{open} open</span> : null}</h2>
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full text-sm">
            <thead className="bg-slab text-left text-[11px] uppercase tracking-wide text-mist">
              <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Coin</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Signals</th><th className="px-3 py-2">Opened</th><th className="px-3 py-2">Headline</th></tr>
            </thead>
            <tbody>
              {investigations.map((i) => (
                <tr key={i.id} className="border-t border-edge">
                  <td className="numerals px-3 py-2 text-mist">{i.id}</td>
                  <td className="px-3 py-2 font-medium">{i.symbol} <span className="text-mist">{i.coingecko_id}</span></td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${i.status === "done" ? "bg-life/15 text-life ring-life/30" : i.status === "failed" ? "bg-blood/15 text-blood ring-blood/30" : "bg-ember/15 text-ember ring-ember/30"}`}>{i.status}</span></td>
                  <td className="numerals px-3 py-2">{Number(i.score).toFixed(1)}</td>
                  <td className="numerals px-3 py-2">{i.signals}</td>
                  <td className="numerals px-3 py-2 text-mist">{ago(i.opened_at, at)}</td>
                  <td className="px-3 py-2 text-mist">{i.headline ?? "—"}</td>
                </tr>
              ))}
              {!investigations.length && <tr><td colSpan={7} className="px-3 py-4 text-mist">No investigation opened yet. One opens when a coin&apos;s signals in 30 minutes add up to a score of 5 (3.5 for demo coins).</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-mist">Latest signals</h2>
        <div className="overflow-x-auto rounded-xl border border-edge">
          <table className="w-full text-sm">
            <thead className="bg-slab text-left text-[11px] uppercase tracking-wide text-mist">
              <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Coin</th><th className="px-3 py-2">Signal</th><th className="px-3 py-2">What happened</th><th className="px-3 py-2">Inv.</th></tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id} className="border-t border-edge">
                  <td className="numerals whitespace-nowrap px-3 py-2 text-mist">{ago(s.event_ts, at)}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-medium">{s.symbol ?? "Market"}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${SEVERITY[s.severity]}`}>{DIRECTION[s.direction]} {KIND_LABEL[s.kind] ?? s.kind} <span className="text-xs opacity-70">{s.severity === 3 ? "high" : s.severity === 2 ? "medium" : "low"}</span></td>
                  <td className="px-3 py-2 text-bone">{describe(s)}</td>
                  <td className="numerals px-3 py-2 text-mist">{s.investigation_id ? `#${s.investigation_id}` : ""}</td>
                </tr>
              ))}
              {!signals.length && <tr><td colSpan={5} className="px-3 py-4 text-mist">No signals in the last 24 hours.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
