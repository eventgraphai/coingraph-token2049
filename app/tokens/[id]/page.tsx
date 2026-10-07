import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { evaluate } from "@/lib/api/evaluate";
import { buildHistory } from "@/lib/api/history";
import { buildRecord } from "@/lib/api/record";
import { ApiError, BASE_URL, resolveToken } from "@/lib/api/respond";
import { buildState } from "@/lib/api/state";
import { ago, SIGNAL_LABEL } from "@/lib/site/data";
import { TONE_CHIP, toneOf } from "@/lib/site/verdict";
import { SiteFooter, SiteHeader } from "../../_site/chrome";
import { BarChart, compactMoney, HBars, LineChart, money, pct, pctTone, type Point } from "../../_site/charts";
import { Snippet } from "../../_site/copy";

// One token, everything CoinGraph knows about it, rendered for a person: the verdict and its seven dimensions,
// then every section of the state (market, liquidity, futures, on-chain, supply, contract, context), the history
// as charts, the signals and briefs, this token's track record, and the API/MCP calls behind the page.

type R = Record<string, unknown>;
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as R)[k] : undefined), o);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isUn = (v: unknown): boolean => v === "unassessed" || Boolean(v && typeof v === "object" && (v as R).status === "unassessed");
const imageUrl = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" ? (str((v as R).large) ?? str((v as R).small)) : null);

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const t = await resolveToken(id).catch(() => null);
  return { title: t ? `${t.name} (${t.symbol.toUpperCase()}): the check before you act — CoinGraph` : "Token — CoinGraph", description: t ? `${t.name}: verdict, liquidity, futures, on-chain flows, contract risk, signals and briefs, every number sourced.` : undefined };
}

export default async function TokenPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const token = await resolveToken(id).catch((e) => { if (e instanceof ApiError) return null; throw e; });
  if (!token) notFound();
  const [state, history, ev, record] = await Promise.all([
    buildState(token),
    buildHistory(token, null).catch(() => null),
    evaluate(token, { requester: "website" }).catch(() => null),
    buildRecord(token.coingecko_id, null, null).catch(() => null),
  ]);
  const s = state.sections as R;
  const idn = s.identity as R, m = s.market as R, liq = s.liquidity as R, der = s.derivatives as R, on = s.onchain as R, sup = s.supply as R, sec = s.security as R, ctx = s.context as R, sig = s.signals as R, brief = s.brief as R;
  const series = history?.series as R | undefined;
  const events = history?.events as R | undefined;
  const sym = token.symbol.toUpperCase();
  const verdict = str(get(ev, "data.verdict"));
  const dims = (get(ev, "data.dimensions") ?? {}) as Record<string, { rating: string; reasons: { text: string; source: string; info?: boolean }[] }>;
  const DIM_ORDER = ["momentum", "liquidity", "leverage", "onchain", "supply", "contract", "context"];

  const pricePts: Point[] = arr<[string, number, number, number]>(get(series, "price.points")).map((p) => [Date.parse(p[0]), p[1]] as Point);
  const mcapPts: Point[] = arr<[string, number, number, number]>(get(series, "price.points")).map((p) => [Date.parse(p[0]), p[2]] as Point).filter((p) => p[1] > 0);
  const flowPts: Point[] = arr<[string, number, number, number]>(get(series, "exchange_net_flow.points")).map((p) => [Date.parse(p[0]), p[3]] as Point);
  const oiVenues = (get(series, "open_interest.by_venue") ?? {}) as Record<string, [string, number][]>;
  const oiPts: Point[] = (oiVenues.binanceusdm ?? Object.values(oiVenues)[0] ?? []).map((p) => [Date.parse(p[0]), p[1]] as Point);
  const fundVenues = (get(series, "funding.by_venue") ?? {}) as Record<string, [string, number][]>;
  const fundPts: Point[] = (fundVenues.binanceusdm ?? Object.values(fundVenues)[0] ?? []).map((p) => [Date.parse(p[0]), p[1]] as Point);
  const lsVenues = (get(series, "long_short.by_venue") ?? {}) as Record<string, [string, number, number, number, number | null][]>;
  const lsPts: Point[] = (lsVenues.binanceusdm ?? Object.values(lsVenues)[0] ?? []).map((p) => [Date.parse(p[0]), p[2]] as Point).filter((p) => Number.isFinite(p[1]));
  const resVenues = (get(series, "reserves.by_exchange") ?? {}) as Record<string, [string, number, number][]>;
  const resTotal: Point[] = (() => { const byT = new Map<number, number>(); for (const pts of Object.values(resVenues)) for (const p of pts) { const t = Math.round(Date.parse(p[0]) / 3600_000) * 3600_000; byT.set(t, (byT.get(t) ?? 0) + p[2]); } return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => [t, v] as Point); })();
  const tvlProtocols = (get(series, "tvl.by_protocol") ?? {}) as Record<string, [string, number][]>;
  const tvlPts: Point[] = (() => { const byT = new Map<number, number>(); for (const pts of Object.values(tvlProtocols)) for (const p of pts) { const t = Date.parse(p[0]); byT.set(t, (byT.get(t) ?? 0) + p[1]); } return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => [t, v] as Point); })();
  const candles = arr<[string, number, number, number, number, number, number, number, number]>(get(series, "candles.points"));
  const vol24 = candles.reduce((a, c) => a + (c[6] ?? 0), 0);
  const takerBuy = candles.reduce((a, c) => a + (c[8] ?? 0), 0), takerAll = candles.reduce((a, c) => a + (c[5] ?? 0), 0);

  const transfers = arr<R>(get(events, "transfers")).slice(0, 12);
  const liqs = arr<R>(get(events, "liquidations"));
  const signals = arr<R>(get(events, "signals")).slice(0, 10);
  const briefs = arr<R>(get(events, "briefs")).slice(0, 6);
  const headlines = arr<R>(get(ctx, "news_24h")).slice(0, 8);
  const contracts = arr<R>(get(sec, "contracts"));
  const home = contracts.find((c) => c.home_chain) ?? contracts[0];
  const cal = (record?.calibration ?? null) as R | null;
  const change = (m?.change_pct ?? {}) as Record<string, number>;
  const links = (idn?.links ?? {}) as Record<string, string>;
  const chains = Object.keys((idn?.chains ?? {}) as R);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
        {/* ------------------------------------------------ Header */}
        <div className="text-[12px] text-mist"><Link href="/tokens" className="hover:text-bone">← All tokens</Link></div>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-center gap-4">
            {imageUrl(idn?.image) && <img src={imageUrl(idn?.image)!} alt="" width={44} height={44} className="rounded-full" />} {/* eslint-disable-line @next/next/no-img-element -- CoinGecko-hosted logo */}
            <div>
              <h1 className="text-[clamp(26px,3.6vw,38px)] font-semibold leading-tight tracking-tight">{token.name} <span className="text-mist">{sym}</span></h1>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-mist">
                {m?.rank != null && <span>Rank #{String(m.rank)}</span>}
                {arr<string>(idn?.categories).slice(0, 3).map((c) => <span key={c}>{c}</span>)}
                {chains.length > 0 && <span>{chains.length} chains</span>}
                {links.homepage && <a href={links.homepage} target="_blank" rel="noreferrer" className="hover:text-bone">Website ↗</a>}
                {links.twitter && <a href={`https://x.com/${links.twitter}`} target="_blank" rel="noreferrer" className="hover:text-bone">X ↗</a>}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="numerals text-[34px] font-semibold leading-none">{money(num(m?.price_usd), 4)}</p>
            <p className="numerals mt-1 text-[13px]">
              {(["1h", "24h", "7d", "30d"] as const).map((k) => <span key={k} className={`ml-3 ${pctTone(change[k])}`}>{k} {pct(change[k])}</span>)}
            </p>
          </div>
        </div>

        {/* ------------------------------------------------ Verdict */}
        <section className="mt-8 rounded-2xl border border-edge bg-slab p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="numerals text-[11px] uppercase tracking-[0.14em] text-mist">The check before you act · standard, no size</p>
              <p className="mt-1 text-[15px]">{verdict ? <>CoinGraph rates {sym} <span className={`numerals rounded-md border px-2 py-0.5 text-[14px] font-bold uppercase ${TONE_CHIP[toneOf(verdict)]}`}>{verdict}</span>{num(get(ev, "data.confidence")) != null && <span className="text-mist"> · confidence {Math.round(num(get(ev, "data.confidence"))! * 100)}%</span>}</> : <span className="text-mist">Check unavailable right now.</span>}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[13px]">
              <Link href={`/agents#trade-gatekeeper`} className="btn-glow rounded-lg bg-brand px-3.5 py-1.5 font-semibold text-brand-ink">Run Trade Gatekeeper</Link>
              <Link href={`/agents#due-diligence-analyst`} className="rounded-lg border border-edge px-3.5 py-1.5 text-bone hover:border-brand/40">Due diligence memo</Link>
              {str(get(ev, "id")) && <Link href={`/proof/${str(get(ev, "id"))}`} className="rounded-lg border border-edge px-3.5 py-1.5 text-mist hover:text-bone">Proof</Link>}
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
            {DIM_ORDER.filter((k) => dims[k]).map((k) => {
              const d = dims[k]; const r = d.reasons.find((x) => !x.info) ?? d.reasons[0];
              const tone = d.rating === "ok" ? "border-life/30" : d.rating === "caution" ? "border-ember/40" : d.rating === "avoid" ? "border-blood/40" : "border-edge";
              const mark = d.rating === "ok" ? "✓" : d.rating === "caution" ? "!" : d.rating === "avoid" ? "✕" : "–";
              const markTone = d.rating === "ok" ? "text-life" : d.rating === "caution" ? "text-ember" : d.rating === "avoid" ? "text-blood" : "text-mist";
              return (
                <div key={k} className={`rounded-xl border bg-ink p-3 ${tone}`}>
                  <p className="flex items-center justify-between text-[12px] font-semibold capitalize"><span>{k}</span><span className={markTone}>{mark}</span></p>
                  <p className="mt-1.5 text-[11.5px] leading-snug text-mist">{r?.text ?? "unassessed"}</p>
                  {r?.source && <p className="numerals mt-1.5 truncate text-[10px] text-mist/70">{r.source.split(":")[0]}</p>}
                </div>
              );
            })}
          </div>
        </section>

        {/* ------------------------------------------------ Market + charts */}
        <section className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl border border-edge bg-slab p-5">
            <LineChart points={pricePts} title={`${sym} price · 14 days (5-minute, then hourly)`} h={200} />
            <div className="mt-4 grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
              <Stat label="Market cap" value={compactMoney(num(m?.market_cap_usd))} />
              <Stat label="Fully diluted" value={compactMoney(num(m?.fully_diluted_valuation_usd))} />
              <Stat label="24h volume" value={compactMoney(num(m?.volume_24h_usd))} sub={num(m?.volume_to_market_cap) != null ? `${(num(m.volume_to_market_cap)! * 100).toFixed(1)}% of cap` : undefined} />
              <Stat label="24h range" value={`${money(num(m?.low_24h_usd), 3)} – ${money(num(m?.high_24h_usd), 3)}`} />
              <Stat label="From all-time high" value={pct(num(m?.from_ath_pct), 1)} sub={str(m?.ath_date) ? `ATH ${money(num(m.ath_usd), 2)} · ${String(m.ath_date).slice(0, 10)}` : undefined} />
              <Stat label="24h volatility" value={num(m?.volatility_24h_pct) != null ? `${num(m.volatility_24h_pct)!.toFixed(2)}%` : "—"} />
              <Stat label="Binance 1-min candles" value={candles.length ? `${candles.length} bars · $${(vol24 / 1e6).toFixed(1)}M traded` : "—"} sub={takerAll ? `taker buys ${Math.round((takerBuy / takerAll) * 100)}% of volume` : undefined} />
              <Stat label="Price dispersion across venues" value={num(liq?.price_dispersion_pct) != null ? `${num(liq.price_dispersion_pct)!.toFixed(3)}%` : "—"} />
            </div>
          </div>
          <div className="rounded-2xl border border-edge bg-slab p-5">
            <LineChart points={mcapPts} title="Market cap" h={120} />
            <p className="mt-4 numerals text-[11px] uppercase tracking-[0.14em] text-mist">Supply</p>
            <ul className="mt-2 space-y-1 text-[12.5px]">
              <Row k="Circulating" v={num(sup?.circulating) != null ? `${Intl.NumberFormat("en", { notation: "compact" }).format(num(sup.circulating)!)} ${sym}` : "—"} />
              <Row k="Issued of max" v={num(sup?.issued_pct_of_max) != null ? `${num(sup.issued_pct_of_max)!.toFixed(1)}%` : "no max"} />
              <Row k="FDV / market cap" v={num(sup?.fdv_to_market_cap)?.toFixed(2) ?? "—"} />
              <Row k="Held on exchanges" v={num(sup?.exchange_held_pct) != null ? `${num(sup.exchange_held_pct)!.toFixed(1)}%` : "—"} />
              <Row k="Top 10 holders" v={num(get(sup, "top_holders_pct.top10")) != null ? `${num(get(sup, "top_holders_pct.top10"))}%` : "unassessed"} />
              <Row k="Unlock schedule" v="unassessed (no free source)" muted />
            </ul>
          </div>
        </section>

        {/* ------------------------------------------------ Liquidity */}
        <Section title="Liquidity" sub={`Order books within 2% of the price, ${arr(liq?.order_books).length} venues read live`}>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[12px] text-mist">Depth within 2% (bid + ask)</p>
              <HBars rows={arr<R>(liq?.order_books).map((b) => ({ label: `${b.venue}`, hint: str(b.symbol) ?? undefined, value: (num(b.depth_2pct_bid_usd) ?? 0) + (num(b.depth_2pct_ask_usd) ?? 0) }))} />
              <p className="mt-3 text-[12px] text-mist">Total {compactMoney(num(get(liq, "depth_2pct_total_usd.bid")))} bid · {compactMoney(num(get(liq, "depth_2pct_total_usd.ask")))} ask · cost to move the price 2% {compactMoney(num(get(liq, "exchanges.cost_to_move_2pct_usd.up")))} up / {compactMoney(num(get(liq, "exchanges.cost_to_move_2pct_usd.down")))} down (CoinGecko, {String(get(liq, "exchanges.count") ?? "—")} exchanges)</p>
            </div>
            <div>
              <p className="mb-2 text-[12px] text-mist">DEX pools</p>
              {arr<R>(liq?.dex_pools).length ? (
                <table className="w-full text-[12px]"><tbody>
                  {arr<R>(liq.dex_pools).slice(0, 6).map((p, i) => <tr key={i} className="border-t border-edge"><td className="py-1.5 pr-2 text-bone/90">{String(p.pool)}<span className="ml-1 text-mist">{String(p.network)}</span></td><td className="numerals py-1.5 text-right text-mist">{compactMoney(num(p.liquidity_usd))} liq</td><td className="numerals py-1.5 text-right text-mist">{String(p.buys_1h ?? 0)}/{String(p.sells_1h ?? 0)} buys/sells 1h</td></tr>)}
                </tbody></table>
              ) : <p className="text-[12px] text-mist">No DEX pools tracked for this token.</p>}
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------ Futures */}
        <Section title="Futures and leverage" sub={isUn(der) ? "No perpetual futures market tracked" : `Open interest ${compactMoney(num(get(der, "open_interest.total_usd")))} · ${num(der?.leverage_ratio) != null ? `${(num(der.leverage_ratio)! * 100).toFixed(1)}% of market cap` : ""}`}>
          {!isUn(der) && (
            <div className="grid gap-5 lg:grid-cols-3">
              <LineChart points={oiPts} title="Open interest (Binance futures)" h={130} />
              <BarChart points={fundPts.slice(-96)} title="Funding rate per 8h (Binance)" h={130} unit="%" />
              <LineChart points={lsPts.slice(-300)} title="Top traders long/short (Binance)" h={130} unit="x" color="var(--color-ember)" />
              <div className="lg:col-span-3 grid gap-3 text-[12.5px] sm:grid-cols-4">
                {arr<R>(der?.funding).map((f) => <Stat key={String(f.venue)} label={`Funding · ${String(f.venue)}`} value={`${num(f.rate_pct)?.toFixed(4) ?? "—"}% / 8h`} sub={num(f.annualised_pct) != null ? `${num(f.annualised_pct)!.toFixed(1)}% annualised` : undefined} />)}
                <Stat label="OI change 1h / 4h / 24h" value={`${pct(num(get(der, "open_interest.change_pct.1h")), 1)} / ${pct(num(get(der, "open_interest.change_pct.4h")), 1)} / ${pct(num(get(der, "open_interest.change_pct.24h")), 1)}`} />
                <Stat label="Liquidations 24h" value={compactMoney(num(get(der, "liquidations.24h.usd")))} sub={`longs ${compactMoney(num(get(der, "liquidations.24h.longs_usd")))} · shorts ${compactMoney(num(get(der, "liquidations.24h.shorts_usd")))} · ${liqs.length} events listed`} />
                <Stat label="All derivative venues" value={`${String(get(der, "all_derivative_venues.venues") ?? "—")} venues`} sub={`OI ${compactMoney(num(get(der, "all_derivative_venues.open_interest_usd")))} · avg funding ${num(get(der, "all_derivative_venues.avg_funding_pct"))?.toFixed(4) ?? "—"}%`} />
              </div>
            </div>
          )}
        </Section>

        {/* ------------------------------------------------ On-chain */}
        <Section title="On-chain" sub={isUn(on) ? "This token's chain is not read on chain yet" : `Read live on ${String(on?.chain).toUpperCase()} through NOWNodes`}>
          {!isUn(on) && (
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <BarChart points={flowPts} title="Exchange net flow, 15-minute (positive = coins arriving on exchanges)" h={130} />
                <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                  {(["1h", "24h", "7d"] as const).map((k) => <Stat key={k} label={`Net ${k}`} value={<span className={pctTone(-(num(get(on, `exchange_flows.${k}.net_usd`)) ?? 0))}>{compactMoney(num(get(on, `exchange_flows.${k}.net_usd`)))}</span>} sub={`in ${compactMoney(num(get(on, `exchange_flows.${k}.inflow_usd`)))} · out ${compactMoney(num(get(on, `exchange_flows.${k}.outflow_usd`)))}`} />)}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
                  <Stat label="Transfers 24h" value={String(get(on, "activity.transfers_24h") ?? "—")} sub={`${String(get(on, "activity.senders_24h") ?? "—")} senders`} />
                  <Stat label="Volume 24h" value={compactMoney(num(get(on, "activity.volume_24h_usd")))} />
                  <Stat label="Minted / burned 24h" value={`${compactMoney(num(get(on, "activity.mint_24h_usd")))} / ${compactMoney(num(get(on, "activity.burn_24h_usd")))}`} />
                  <Stat label="Network fee" value={num(get(on, "network_fees.base_fee_gwei")) != null ? `${num(get(on, "network_fees.base_fee_gwei"))!.toFixed(2)} gwei` : "—"} sub={num(get(on, "network_fees.block_fullness_pct")) != null ? `${num(get(on, "network_fees.block_fullness_pct"))!.toFixed(0)}% block fullness` : undefined} />
                </div>
              </div>
              <div>
                <LineChart points={resTotal} title="Exchange reserves (USD, hourly)" h={130} color="var(--color-life)" />
                <HBarsOrNote rows={arr<R>(get(on, "exchange_reserves.by_exchange")).slice(0, 6).map((e) => ({ label: String(e.exchange), value: num(e.usd) ?? 0, hint: num(e.change_24h_pct) != null ? `${pct(num(e.change_24h_pct))} 24h` : undefined }))} />
              </div>
              <div className="lg:col-span-2">
                <p className="mb-2 text-[12px] text-mist">Largest transfers, last 24h</p>
                <div className="overflow-x-auto rounded-xl border border-edge"><table className="w-full min-w-[640px] text-[12px]">
                  <thead className="bg-ink text-[10px] uppercase tracking-wider text-mist"><tr><th className="px-3 py-2 text-left">When</th><th className="px-3 py-2 text-left">From</th><th className="px-3 py-2 text-left">To</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Direction</th></tr></thead>
                  <tbody>{transfers.map((t, i) => <tr key={i} className="border-t border-edge"><td className="numerals px-3 py-1.5 text-mist">{ago(String(t.at))}</td><td className="px-3 py-1.5">{String(t.from_entity ?? "") || <span className="numerals text-mist">{String(t.from).slice(0, 10)}…</span>}</td><td className="px-3 py-1.5">{String(t.to_entity ?? "") || <span className="numerals text-mist">{String(t.to).slice(0, 10)}…</span>}</td><td className="numerals px-3 py-1.5 text-right">{compactMoney(num(t.usd))}</td><td className="px-3 py-1.5 text-mist">{String(t.direction ?? "").replace(/_/g, " ")}</td></tr>)}
                  {!transfers.length && <tr><td colSpan={5} className="px-3 py-3 text-mist">No large transfers in the last 24 hours.</td></tr>}</tbody>
                </table></div>
              </div>
            </div>
          )}
        </Section>

        {/* ------------------------------------------------ Contract */}
        <Section title="Contract security" sub={isUn(sec) || !contracts.length ? "Native coin or no GoPlus report: nothing to scan, and nothing assumed" : `GoPlus · rated on ${String(sec?.rated_on ?? "")} · risk ${String(sec?.risk_level ?? "")}`}>
          {contracts.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {([["Honeypot test", home?.honeypot], ["Can mint", home?.mintable], ["Upgradeable (proxy)", home?.upgradeable], ["Blacklist", home?.blacklist], ["Pausable", home?.pausable], ["Hidden owner", home?.hidden_owner], ["Owner can change balances", home?.owner_can_change_balances], ["Source verified", home?.verified_source]] as [string, unknown][]).map(([k, v]) => (
                <div key={k} className="rounded-xl border border-edge bg-ink px-3 py-2 text-[12.5px]"><span className="text-mist">{k}: </span><span className={v === true ? (k === "Source verified" ? "text-life" : "text-ember") : v === false ? (k === "Source verified" ? "text-ember" : "text-life") : "text-mist"}>{v === true ? "yes" : v === false ? "no" : "unknown"}</span></div>
              ))}
              {arr<string>(home?.flags).length > 0 && <p className="sm:col-span-2 lg:col-span-4 text-[12.5px] text-bone/85"><span className="text-mist">Flags: </span>{arr<string>(home!.flags).join(" · ")}</p>}
              {contracts.length > 1 && <p className="sm:col-span-2 lg:col-span-4 text-[12px] text-mist">{contracts.length} contracts across chains; the home chain decides the rating. Bridged copies: {contracts.filter((c) => !c.home_chain).map((c) => `${String(c.chain).toUpperCase()} (${String(c.risk_level)})`).join(", ")}.</p>}
            </div>
          )}
        </Section>

        {/* ------------------------------------------------ Context */}
        <Section title="Context" sub="News, protocol TVL, development, mood">
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-[12px] text-mist">Headlines, last 24h</p>
              {headlines.length ? <ul className="space-y-1.5 text-[13px]">{headlines.map((h, i) => <li key={i}><a href={str(h.url) ?? "#"} target="_blank" rel="noreferrer" className="text-bone/90 hover:text-brand">{String(h.title ?? h.headline ?? "")}</a> <span className="numerals text-[11px] text-mist">{str(h.source) ?? ""}</span></li>)}</ul> : <p className="text-[12px] text-mist">No headlines mentioning {sym} in the last 24 hours.</p>}
              {tvlPts.length > 1 && <div className="mt-4"><LineChart points={tvlPts} title={`Protocol TVL · ${Object.keys(tvlProtocols).join(", ")}`} h={110} color="var(--color-life)" /></div>}
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12.5px]">
              <Stat label="Fear & Greed" value={`${String(get(ctx, "fear_greed.value") ?? "—")} · ${String(get(ctx, "fear_greed.label") ?? "")}`} />
              <Stat label="Developer activity" value={isUn(ctx?.development) ? "unassessed" : `${String(get(ctx, "development.commits_4w") ?? "—")} commits / 4w`} sub={!isUn(ctx?.development) ? `${String(get(ctx, "development.stars") ?? "—")} stars` : "not tracked by CoinGecko for this coin"} />
              <Stat label="Community" value={isUn(ctx?.community) ? "unassessed" : `${Intl.NumberFormat("en", { notation: "compact" }).format(num(get(ctx, "community.x_followers")) ?? 0)} on X`} />
              <Stat label="Trending" value={ctx?.trending ? `#${String(get(ctx, "trending.position") ?? "")}` : "not trending"} />
            </div>
          </div>
        </Section>

        {/* ------------------------------------------------ Signals, briefs, record */}
        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-edge bg-slab p-5">
            <p className="font-semibold">Signals, last 24h</p>
            <ul className="mt-2 divide-y divide-edge">
              {signals.map((x, i) => <li key={i} className="flex items-baseline justify-between gap-2 py-1.5 text-[12.5px]"><span><span className={Number(x.severity) >= 3 ? "text-blood" : "text-ember"}>{x.direction === "up" ? "▲" : x.direction === "down" ? "▼" : "•"}</span> {SIGNAL_LABEL[String(x.kind)] ?? String(x.kind)}{x.brief_id ? <Link href={`/briefs/${String(x.brief_id)}`} className="ml-1 text-brand">brief</Link> : null}</span><span className="numerals text-[11px] text-mist">{ago(String(x.at))}</span></li>)}
              {!signals.length && <li className="py-1.5 text-[12.5px] text-mist">Quiet.</li>}
            </ul>
            {arr<R>(sig?.open).length > 0 && <p className="mt-2 text-[11px] text-mist">{arr(sig.open).length} open right now</p>}
          </div>
          <div className="rounded-2xl border border-edge bg-slab p-5">
            <p className="font-semibold">Briefs: why it moved</p>
            {Boolean(brief) && !isUn(brief) && str(brief.headline) ? <Link href={`/briefs/${String(brief.id)}`} className="mt-2 block rounded-xl border border-edge bg-ink p-3 hover:border-brand/40"><p className="text-[13px] leading-snug text-bone">{str(brief.headline)}</p><p className="numerals mt-1 text-[11px] text-mist">{ago(String(brief.at))} · severity {String(brief.severity)} · confidence {Math.round((num(brief.confidence) ?? 0) * 100)}%</p></Link> : null}
            <ul className="mt-2 space-y-1 text-[12.5px]">{briefs.slice(1).map((b, i) => <li key={i}><Link href={`/briefs/${String(b.id)}`} className="text-bone/85 hover:text-brand">{String(b.headline).slice(0, 90)}</Link> <span className="numerals text-[11px] text-mist">{ago(String(b.at))}</span></li>)}</ul>
            {!briefs.length && (!brief || isUn(brief)) && <p className="mt-2 text-[12.5px] text-mist">No brief yet; one is written when a strong signal fires. <Link href="/docs/api/explain" className="text-brand">Run a fresh investigation →</Link></p>}
          </div>
          <div className="rounded-2xl border border-edge bg-slab p-5">
            <p className="font-semibold">CoinGraph&apos;s record on {sym}</p>
            {cal ? (
              <div className="mt-2 text-[12.5px] text-bone/85">
                <p>{String(cal.total_calls)} calls in 7 days, {String(cal.graded)} graded against the price.</p>
                <ul className="mt-1 space-y-0.5">{Object.entries((cal.by_kind ?? {}) as Record<string, R>).map(([k, v]) => <li key={k}>{k}s: {String(v.right)} of {String(v.graded)} right{num(v.hit_rate_pct) != null ? ` (${String(num(v.hit_rate_pct))}%)` : ""}</li>)}</ul>
                <p className="mt-2 text-[11px] text-mist">Misses stay on the record. <a href={`/api/v1/record/${token.coingecko_id}`} className="text-brand">Full ledger →</a></p>
              </div>
            ) : <p className="mt-2 text-[12.5px] text-mist">No graded calls yet.</p>}
          </div>
        </section>

        {/* ------------------------------------------------ For developers */}
        <section className="mt-6 rounded-2xl border border-edge bg-slab p-5">
          <p className="font-semibold">Everything on this page, as data</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <Snippet title="REST · state" code={`curl ${BASE_URL}/api/v1/state/${token.coingecko_id}`} />
            <Snippet title="REST · check" code={`curl ${BASE_URL}/api/v1/evaluate/${token.coingecko_id}`} />
            <Snippet title="MCP · in Claude" code={`"Check ${sym} before I buy $5K. Use CoinGraph."`} />
          </div>
          <p className="mt-3 text-[12px] text-mist">Sources on this page: {dedupe([...(arr<R>(m?.sources)), ...(arr<R>(liq?.sources)), ...(arr<R>(der?.sources)), ...(arr<R>(on?.sources)), ...(arr<R>(sec?.sources))].map((x) => String(x.provider))).join(", ")}. Anything not measured says unassessed. CoinGraph never trades, holds funds or gives financial advice.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

const dedupe = (xs: string[]) => [...new Set(xs)];

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-edge bg-slab p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2"><p className="font-semibold">{title}</p>{sub && <p className="text-[12px] text-mist">{sub}</p>}</div>
      {children}
    </section>
  );
}
function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return <div className="rounded-xl border border-edge bg-ink px-3 py-2"><p className="text-[10.5px] uppercase tracking-wider text-mist">{label}</p><p className="numerals mt-0.5 text-[13px] text-bone">{value}</p>{sub && <p className="text-[11px] text-mist">{sub}</p>}</div>;
}
function Row({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return <li className="flex justify-between gap-3"><span className="text-mist">{k}</span><span className={`numerals ${muted ? "text-mist" : "text-bone"}`}>{v}</span></li>;
}
function HBarsOrNote({ rows }: { rows: { label: string; value: number; hint?: string }[] }) {
  return rows.length ? <div className="mt-3"><HBars rows={rows} /></div> : <p className="mt-3 text-[12px] text-mist">No exchange wallets mapped for this token yet.</p>;
}
