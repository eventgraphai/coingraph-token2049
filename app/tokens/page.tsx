import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { buildMarket } from "@/lib/api/market";
import { listTokens } from "@/lib/site/explorer";
import { ago, remember, SIGNAL_LABEL } from "@/lib/site/data";
import { SiteFooter, SiteHeader } from "../_site/chrome";
import { compactMoney, LineChart, pct, pctTone, Split, type Point } from "../_site/charts";
import { TokenTable } from "../_site/token-table";

export const metadata: Metadata = {
  title: "Tokens — CoinGraph",
  description: "The 100 largest crypto tokens with what no price site shows: CoinGraph's verdict, flagged dimensions, signals, funding, open interest, exchange flows and holder concentration.",
};

type R = Record<string, unknown>;
const get = (o: unknown, p: string): unknown => p.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as R)[k] : undefined), o);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const dedupe = <T,>(xs: T[], key: (x: T) => string): T[] => { const seen = new Set<string>(); return xs.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

export default async function TokensPage() {
  await connection();
  const loaded = await remember("tokens-page", 60_000, async () => {
    const [rows, market] = await Promise.all([listTokens(), buildMarket(["overview", "breadth", "sentiment", "flows", "rankings", "events"]).catch(() => null)]);
    return { rows, market };
  });
  const rows = loaded?.rows ?? [];
  const market = loaded?.market ?? null;
  const m = (market?.sections ?? {}) as R;
  const ov = m.overview as R | undefined, br = m.breadth as R | undefined, se = m.sentiment as R | undefined, fl = m.flows as R | undefined, rk = m.rankings as R | undefined, evs = m.events as R | undefined;
  const fgHist: Point[] = arr<[string, number]>(get(se, "fear_greed.history_30d")).map((p) => [Date.parse(p[0]), Number(p[1])] as Point).filter((p) => Number.isFinite(p[1]));
  const flagged = rows.filter((r) => r.verdict && r.verdict !== "proceed").length;
  const withSignals = rows.filter((r) => r.signals_24h > 0).length;
  const signals = arr<R>(evs?.signals).slice(0, 8);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="numerals text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">Tokens</p>
            <h1 className="mt-2 text-[clamp(26px,3.6vw,38px)] font-semibold leading-tight tracking-tight">The 100 largest tokens, <span className="text-brand">with the check attached.</span></h1>
            <p className="mt-2 max-w-2xl text-[14px] text-mist">Price and size like any tracker, then what no tracker shows: CoinGraph&apos;s verdict, which dimension flagged it, live signals, funding, open interest, exchange flows read on chain and holder concentration. Click a token for everything.</p>
          </div>
          <div className="numerals text-[12px] text-mist">{flagged} tokens rated caution or avoid · {withSignals} with signals in 24h</div>
        </div>

        {/* Market header */}
        <section className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Card label="Total market cap" value={compactMoney(num(ov?.total_market_cap_usd))} sub={<span className={pctTone(num(ov?.market_cap_change_24h_pct))}>{pct(num(ov?.market_cap_change_24h_pct), 2)} 24h</span>} />
          <Card label="24h volume" value={compactMoney(num(ov?.total_volume_24h_usd))} sub={`BTC ${num(ov?.btc_dominance_pct)?.toFixed(1) ?? "—"}% · ETH ${num(ov?.eth_dominance_pct)?.toFixed(1) ?? "—"}% dominance`} />
          <div className="rounded-2xl border border-edge bg-slab p-4">
            <p className="text-[10.5px] uppercase tracking-wider text-mist">Breadth, top 100</p>
            <div className="mt-2"><Split left={num(br?.up_24h) ?? 0} right={num(br?.down_24h) ?? 0} leftLabel="up 24h" rightLabel="down 24h" /></div>
            <p className="mt-2 text-[11px] text-mist">{num(br?.rising_open_interest_pct) != null ? `${num(br?.rising_open_interest_pct)!.toFixed(0)}% with rising open interest` : ""}</p>
          </div>
          <div className="rounded-2xl border border-edge bg-slab p-4">
            <p className="text-[10.5px] uppercase tracking-wider text-mist">Fear &amp; Greed · {String(get(se, "fear_greed.label") ?? "")}</p>
            <p className="numerals mt-1 text-[22px] font-semibold">{String(get(se, "fear_greed.value") ?? "—")}</p>
            {fgHist.length > 2 && <LineChart points={fgHist} h={56} unit="" color="var(--color-ember)" />}
          </div>
        </section>

        {/* Flows + rankings */}
        <section className="mt-3 grid gap-3 lg:grid-cols-4">
          <Card label="Stablecoins → exchanges, 24h" value={<span className={pctTone(num(get(fl, "stablecoins_to_exchanges.net_24h_usd")))}>{compactMoney(num(get(fl, "stablecoins_to_exchanges.net_24h_usd")))}</span>} sub="positive = buying power arriving on exchanges" />
          <Card label="All tokens → exchanges, 24h" value={<span className={pctTone(-(num(get(fl, "all_tokens_net_to_exchanges.net_24h_usd")) ?? 0))}>{compactMoney(num(get(fl, "all_tokens_net_to_exchanges.net_24h_usd")))}</span>} sub="positive = coins arriving, potential selling" />
          <Rank title="Biggest exchange inflows 24h" items={arr<R>(fl?.largest_inflows_24h).slice(0, 4).map((x) => ({ id: String(x.id), symbol: String(x.symbol), value: compactMoney(num(x.net_usd)), tone: "text-ember" }))} />
          <Rank title="Biggest exchange outflows 24h" items={arr<R>(fl?.largest_outflows_24h).slice(0, 4).map((x) => ({ id: String(x.id), symbol: String(x.symbol), value: compactMoney(Math.abs(num(x.net_usd) ?? 0)), tone: "text-life" }))} />
        </section>
        <section className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <Rank title="Gainers 24h" items={arr<R>(rk?.gainers_24h).slice(0, 4).map((x) => ({ id: String(x.id), symbol: String(x.symbol), value: pct(num(x.change_24h_pct), 1), tone: "text-life" }))} />
          <Rank title="Losers 24h" items={arr<R>(rk?.losers_24h).slice(0, 4).map((x) => ({ id: String(x.id), symbol: String(x.symbol), value: pct(num(x.change_24h_pct), 1), tone: "text-blood" }))} />
          <Rank title="Open-interest moves, 1h" items={dedupe(arr<R>(rk?.open_interest_moves), (x) => String(x.symbol)).slice(0, 4).map((x) => ({ id: String(x.id), symbol: String(x.symbol), value: pct(num(x.value), 1), tone: (num(x.value) ?? 0) >= 0 ? "text-life" : "text-blood" }))} />
          <div className="rounded-2xl border border-edge bg-slab p-4">
            <p className="text-[10.5px] uppercase tracking-wider text-mist">Latest signals, all tokens</p>
            <ul className="mt-2 space-y-1 text-[12px]">
              {signals.map((s, i) => <li key={i} className="flex justify-between gap-2"><span><Link href={`/tokens/${String(s.id ?? s.coingecko_id ?? "")}`} className="font-semibold text-bone hover:text-brand">{String(s.symbol ?? "").toUpperCase()}</Link> <span className="text-mist">{SIGNAL_LABEL[String(s.kind)] ?? String(s.kind)}</span></span><span className="numerals text-mist">{s.at ? ago(String(s.at)) : ""}</span></li>)}
              {!signals.length && <li className="text-mist">Quiet right now.</li>}
            </ul>
          </div>
        </section>

        <section className="mt-6"><TokenTable rows={rows} /></section>
        <p className="mt-3 text-[12px] text-mist">Prices from CoinGecko every minute; futures from Binance, OKX and Bybit every 5 minutes; exchange flows read on chain through NOWNodes every 15 minutes; checks refresh when requested and are cached briefly. Nothing here is advice; every number on a token page carries its source.</p>
      </main>
      <SiteFooter />
    </>
  );
}

function Card({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="rounded-2xl border border-edge bg-slab p-4"><p className="text-[10.5px] uppercase tracking-wider text-mist">{label}</p><p className="numerals mt-1 text-[22px] font-semibold">{value}</p>{sub && <p className="mt-0.5 text-[11px] text-mist">{sub}</p>}</div>;
}
function Rank({ title, items }: { title: string; items: { id: string; symbol: string; value: string; tone: string }[] }) {
  return (
    <div className="rounded-2xl border border-edge bg-slab p-4">
      <p className="text-[10.5px] uppercase tracking-wider text-mist">{title}</p>
      <ul className="mt-2 space-y-1 text-[12.5px]">
        {items.map((x) => <li key={x.id + x.symbol} className="flex justify-between"><Link href={`/tokens/${x.id}`} className="font-semibold text-bone hover:text-brand">{x.symbol}</Link><span className={`numerals ${x.tone}`}>{x.value}</span></li>)}
        {!items.length && <li className="text-mist">—</li>}
      </ul>
    </div>
  );
}
