import { z } from "zod";
import { sql } from "../db";
import { resolveToken, type Token } from "../api/respond";
import { evaluate } from "../api/evaluate";
import { buildState } from "../api/state";
import { buildMarket } from "../api/market";
import { inspectAddress, type Chain } from "../api/inspect";
import { dexQuote } from "../security/jobs";
import { defineAgent, fmtPct, fmtUsd, get, n, tokenField, type Reason } from "./core";

// Trading-side agents: Trade Gatekeeper, Leverage Radar, Whale Watch, Opportunity Scout.

type Eval = Awaited<ReturnType<typeof evaluate>>;
const ratingsOf = (e: Eval) => Object.fromEntries(Object.entries(e.data.dimensions).map(([k, v]) => [k, (v as { rating: string }).rating]));
// The reason that actually decided an avoid verdict (worst dimension first, never an informational line).
const blockLead = (e: Eval): string | null => {
  const dims = e.data.dimensions as Record<string, { rating: string; reasons: { text: string; info?: boolean }[] }>;
  for (const name of ["contract", "liquidity", "supply", "leverage", "onchain", "momentum", "context", "policy"]) {
    const d = dims[name];
    if (d?.rating === "avoid") { const r = d.reasons.find((x) => !x.info); if (r) return `${name}: ${r.text}`; }
  }
  return null;
};
const cautionReasons = (e: Eval): Reason[] => (e.data.reasons as { dimension: string; text: string; source: string }[]).map((r) => ({ text: `${r.dimension}: ${r.text}`, source: r.source }));

async function latestBrief(id: string, hours = 12) {
  const [b] = await sql`select id, headline, finished_at from investigations where coingecko_id = ${id} and status = 'done' and finished_at > now() - ${hours} * interval '1 hour' order by finished_at desc limit 1`;
  return b ? { id: Number(b.id), headline: b.headline as string, at: b.finished_at as Date } : null;
}

// ---------------------------------------------------------------------------------------------------
// 1. Trade Gatekeeper — the check every trade passes before it is placed.
// ---------------------------------------------------------------------------------------------------
export const tradeGatekeeper = defineAgent({
  id: "trade-gatekeeper",
  name: "Trade Gatekeeper",
  tagline: "The check every trade passes before it is placed.",
  persona: ["Trading-agent developers", "AI wallets"],
  description: "Give it a token, an order size and optionally your rules. It runs the CoinGraph check, measures the real on-chain price impact of your size (DEX aggregator quote) against order-book depth and daily volume, reads leverage, onchain flows and contract risk, and returns ALLOW, REDUCE (with the largest safe size) or BLOCK, with every reason sourced.",
  tier: "premium",
  masumi: true,
  verdicts: ["ALLOW", "REDUCE", "BLOCK"],
  input: z.object({
    token: tokenField,
    size_usd: z.number().positive().max(1e10).default(10_000).describe("Order size in USD"),
    side: z.enum(["buy", "sell"]).default("buy"),
    max_impact_pct: z.number().positive().max(50).optional().describe("Largest acceptable price impact; default 1% for top-20 tokens, 2% otherwise"),
    policy: z.object({
      min_depth_usd: z.number().optional(), max_top10_holder_pct: z.number().optional(), max_funding_pct: z.number().optional(),
      max_exchange_inflow_usd: z.number().optional(), allow_mint_authority: z.boolean().optional(),
    }).optional(),
  }),
  example: { token: "uniswap", size_usd: 250_000, side: "buy" },
  async run({ token: t, size_usd, side, max_impact_pct, policy }) {
    const token = await resolveToken(t);
    const ev = await evaluate(token, { size_usd, policy });
    const sc = (ev.data.size_check ?? {}) as Record<string, unknown>;
    const quote = side === "sell" ? await dexQuote(token.coingecko_id, size_usd, "sell") : (sc.dex_quote as Awaited<ReturnType<typeof dexQuote>> | undefined) ?? null;
    const cap = max_impact_pct ?? n(sc.impact_limit_pct) ?? ((token.market_cap_rank ?? 999) <= 20 ? 1 : 2);
    // Order-book impact on the side being traded: asks for a buy, bids for a sell.
    const bookDepth = n(get(sc, side === "buy" ? "depth_2pct_usd.ask" : "depth_2pct_usd.bid"));
    const cexImpact = bookDepth ? Math.round(Math.min((size_usd / bookDepth) * 2, 100) * 100) / 100 : n(sc.estimated_impact_pct);
    // Best route: an agent can execute on exchange order books or on-chain, so the decision uses the cheaper one.
    const routes = [
      ...(cexImpact !== null ? [{ route: "exchange order books", impact: cexImpact }] : []),
      ...(quote ? [{ route: `on-chain via ${quote.venue} (${quote.chain.toUpperCase()})`, impact: quote.price_impact_pct }] : []),
    ].sort((a, b) => a.impact - b.impact);
    const best = routes[0] ?? null;
    const impact = best ? best.impact : null;
    const volShare = n(sc.share_of_24h_volume_pct);
    const reasons: Reason[] = [];
    const warnings: string[] = [];
    let decision: "ALLOW" | "REDUCE" | "BLOCK" = "ALLOW";
    let maxSafe: number | null = size_usd;

    const fails = Object.entries((ev.data.policy_check ?? {}) as Record<string, { result: string; detail: string }>).filter(([, v]) => v.result === "fail");
    if (fails.length) { decision = "BLOCK"; reasons.push(...fails.map(([k, v]) => ({ text: `Your rule ${k} fails: ${v.detail}`, source: "coingraph:policy" }))); }
    if (ev.data.verdict === "avoid") { decision = "BLOCK"; const lead = blockLead(ev); reasons.push(...(lead ? [{ text: lead, source: "coingraph:evaluate" }] : []), ...cautionReasons(ev).filter((r) => r.text !== lead)); }
    if (impact !== null && impact > cap * 2) { decision = "BLOCK"; reasons.push({ text: `Even the best route (${best!.route}) would move the price about ${impact}% for ${fmtUsd(size_usd)} (limit ${cap}%)`, source: quote ? `${quote.venue}:quote + ccxt:fetchOrderBook` : "ccxt:fetchOrderBook" }); }
    if (decision !== "BLOCK" && ((impact !== null && impact > cap) || (volShare !== null && volShare > 1))) {
      decision = "REDUCE";
      // Largest safe size: within the impact limit on the best route, and at most 1% of daily volume.
      let candidate = impact !== null && impact > cap ? Math.floor((size_usd * cap) / impact) : size_usd;
      if (volShare !== null && volShare > 1) candidate = Math.min(candidate, Math.floor(size_usd / volShare));
      // Confirm with a live quote only when the on-chain route is the best one.
      if (best?.route.startsWith("on-chain")) {
        for (let i = 0; i < 3 && candidate > 100; i++) {
          const q = await dexQuote(token.coingecko_id, candidate, side).catch(() => null);
          if (!q || q.price_impact_pct <= cap) break;
          candidate = Math.floor(candidate / 2);
        }
      }
      maxSafe = candidate;
      const why = impact !== null && impact > cap ? `${impact}% price impact on the best route (limit ${cap}%)` : `${volShare}% of the token's daily volume (keep single orders under 1%)`;
      reasons.push({ text: `${fmtUsd(size_usd)} is too large: ${why}; about ${fmtUsd(maxSafe)} fits`, source: quote ? `${quote.venue}:quote + ccxt:fetchOrderBook` : "ccxt:fetchOrderBook" });
    }
    if (decision === "BLOCK") maxSafe = 0;
    if (ev.data.verdict === "caution") warnings.push(...cautionReasons(ev).map((r) => r.text));
    if (decision === "ALLOW") reasons.push({ text: `${fmtUsd(size_usd)} ${side}: ${impact === null ? "n/a" : impact < 0.01 ? "under 0.01" : impact}% impact on the best route (${best?.route ?? "n/a"}; limit ${cap}%), check verdict ${ev.data.verdict}`, source: quote ? `${quote.venue}:quote + ccxt:fetchOrderBook` : "coingraph:evaluate" });
    const brief = ev.data.verdict !== "proceed" ? await latestBrief(token.coingecko_id) : null;

    const sym = token.symbol.toUpperCase();
    const summary = decision === "ALLOW"
      ? `ALLOW: ${fmtUsd(size_usd)} ${side} of ${sym} fits current liquidity (${impact === null ? "n/a" : impact < 0.01 ? "under 0.01" : impact}% impact via ${best?.route ?? "n/a"}).${warnings.length ? ` Watch: ${warnings[0]}.` : ""}`
      : decision === "REDUCE"
        ? `REDUCE: cut the ${sym} ${side} to about ${fmtUsd(maxSafe)} — ${reasons[reasons.length - 1]?.text.split(": ")[1]?.split(";")[0] ?? "too large for current liquidity"}.`
        : `BLOCK: do not ${side} ${sym} now — ${blockLead(ev) ?? reasons[0]?.text ?? "the check failed"}.`;
    return {
      verdict: decision,
      summary,
      result: {
        token: { id: token.coingecko_id, symbol: sym }, side,
        size: { requested_usd: size_usd, max_safe_usd: maxSafe },
        impact: { best_route: best?.route ?? null, best_pct: impact, routes, limit_pct: cap, share_of_daily_volume_pct: volShare },
        check: { verdict: ev.data.verdict, confidence: ev.data.confidence, dimensions: ratingsOf(ev), evaluation_id: ev.id },
        policy: ev.data.policy_check ?? null,
        latest_brief: brief,
      },
      reasons, warnings,
      links: { proof: `/api/v1/verify/${ev.id}`, ...(brief ? { brief: `/investigations/${brief.id}` } : {}) },
      tokens: [token.coingecko_id],
    };
  },
});

// ---------------------------------------------------------------------------------------------------
// 3. Leverage Radar — spots crowded futures trades before they unwind.
// ---------------------------------------------------------------------------------------------------
type Crowd = { id: string; symbol: string; score: number; side: string; regime: string; funding_pct: number | null; funding_pctile: number | null; oi_usd: number | null; oi_24h_pct: number | null; oi_to_mcap_pct: number | null; top_traders_ls: number | null; ls_vs_7d: number | null; liq_24h_usd: number | null; liq_long_share_pct: number | null; price_24h_pct: number | null; reasons: string[] };

export async function computeCrowding(ids: string[] | null, minOiUsd = 1_000_000): Promise<Crowd[]> {
  const rows = await sql`
    with u as (select coingecko_id, upper(symbol) as symbol from tokens where in_universe and not is_stablecoin ${ids ? sql`and coingecko_id = any(${ids})` : sql``}),
    f as (select distinct on (coingecko_id) coingecko_id, funding_rate from funding_rate_snapshots where venue = 'binanceusdm' and captured_at > now() - interval '30 minutes' order by coingecko_id, captured_at desc),
    fh as (select coingecko_id, array_agg(funding_rate order by funding_rate) as hist from funding_rate_snapshots where venue = 'binanceusdm' and captured_at > now() - interval '14 days' group by 1),
    oi as (select distinct on (coingecko_id) coingecko_id, open_interest_usd as now_oi, exchange_ts from open_interest_usd where venue = 'binanceusdm' and exchange_ts > now() - interval '30 minutes' order by coingecko_id, exchange_ts desc),
    oi24 as (select distinct on (coingecko_id) coingecko_id, open_interest_usd as oi_24 from open_interest_usd where venue = 'binanceusdm' and exchange_ts <= now() - interval '24 hours' and exchange_ts > now() - interval '26 hours' order by coingecko_id, exchange_ts desc),
    ls as (select distinct on (coingecko_id) coingecko_id, top_position_long_short_ratio as r from futures_sentiment_snapshots where venue = 'binanceusdm' and ts > now() - interval '40 minutes' and top_position_long_short_ratio is not null order by coingecko_id, ts desc),
    ls7 as (select coingecko_id, avg(top_position_long_short_ratio) as avg_r from futures_sentiment_snapshots where venue = 'binanceusdm' and ts > now() - interval '7 days' group by 1),
    lq as (select coingecko_id, sum(notional_usd) as usd, sum(notional_usd) filter (where side = 'SELL' or position_side = 'long') as longs from liquidations where event_ts > now() - interval '24 hours' group by 1),
    m as (select distinct on (coingecko_id) coingecko_id, market_cap, price_change_percentage_24h as ch from market_snapshots where captured_at > now() - interval '10 minutes' order by coingecko_id, captured_at desc)
    select u.coingecko_id, u.symbol, f.funding_rate, fh.hist, oi.now_oi, oi24.oi_24, ls.r, ls7.avg_r, lq.usd as liq, lq.longs, m.market_cap, m.ch
    from u join oi using (coingecko_id) left join f using (coingecko_id) left join fh using (coingecko_id) left join oi24 using (coingecko_id)
    left join ls using (coingecko_id) left join ls7 using (coingecko_id) left join lq using (coingecko_id) left join m using (coingecko_id)
    where oi.now_oi >= ${minOiUsd}`;
  return rows.map((r) => {
    const fr = n(r.funding_rate);
    const hist = (r.hist as string[] | null)?.map(Number) ?? [];
    const pctile = fr !== null && hist.length > 20 ? Math.round((hist.filter((h) => h <= fr).length / hist.length) * 100) : null;
    const oiNow = n(r.now_oi), oi24 = n(r.oi_24);
    const oiCh = oiNow && oi24 ? ((oiNow / oi24) - 1) * 100 : null;
    const oiMcap = oiNow && n(r.market_cap) ? (oiNow / n(r.market_cap)!) * 100 : null;
    const ls = n(r.r), lsAvg = n(r.avg_r);
    const lsSkew = ls && lsAvg ? ls / lsAvg : null;
    const price = n(r.ch);
    const liq = n(r.liq), longs = n(r.longs);
    const reasons: string[] = [];
    // Four components of 25 points each.
    const fScore = pctile !== null ? (Math.abs(pctile - 50) / 50) * 18 + (fr !== null && Math.abs(fr) >= 0.0005 ? 7 : 0) : fr !== null && Math.abs(fr) >= 0.0005 ? 15 : 0;
    if (fr !== null && (Math.abs(fr) >= 0.0005 || (pctile !== null && (pctile >= 90 || pctile <= 10)))) reasons.push(`Funding ${(fr * 100).toFixed(4)}%/8h${pctile !== null ? `, ${pctile}th percentile of 14 days` : ""}`);
    const oScore = oiCh !== null ? Math.min(Math.abs(oiCh) / 20, 1) * 18 + (oiCh > 10 && price !== null && Math.abs(price) < 3 ? 7 : 0) : 0;
    if (oiCh !== null && Math.abs(oiCh) >= 8) reasons.push(`Open interest ${fmtPct(oiCh, 1)} in 24h${price !== null && Math.abs(price) < 3 && oiCh > 10 ? " while price is flat — new leverage piling in" : ""}`);
    const pScore = lsSkew !== null ? Math.min(Math.abs(Math.log(lsSkew)) / Math.log(1.8), 1) * 25 : 0;
    if (lsSkew !== null && (lsSkew >= 1.3 || lsSkew <= 0.77)) reasons.push(`Top traders ${ls!.toFixed(2)} long per short vs ${lsAvg!.toFixed(2)} on average (7d)`);
    const lScore = oiMcap !== null ? Math.min(oiMcap / 12, 1) * 25 : 0;
    if (oiMcap !== null && oiMcap >= 6) reasons.push(`Open interest is ${oiMcap.toFixed(1)}% of market cap`);
    if (liq && liq >= 1_000_000) reasons.push(`${fmtUsd(liq)} liquidated in 24h (${Math.round(((longs ?? 0) / liq) * 100)}% longs)`);
    const score = Math.round(fScore + oScore + pScore + lScore);
    const longSignals = (fr ?? 0) > 0.0002 ? 1 : 0;
    const side = (fr ?? 0) < -0.0001 || (lsSkew !== null && lsSkew < 0.8) ? "shorts" : longSignals || (lsSkew !== null && lsSkew > 1.2) ? "longs" : "neither";
    const regime = oiCh !== null && oiCh < -12 ? "deleveraging" : score >= 65 ? `crowded ${side} — fragile` : score >= 45 ? `elevated, leaning ${side}` : "balanced";
    return { id: r.coingecko_id, symbol: r.symbol, score, side, regime, funding_pct: fr !== null ? Number((fr * 100).toFixed(4)) : null, funding_pctile: pctile,
      oi_usd: oiNow, oi_24h_pct: oiCh !== null ? Number(oiCh.toFixed(2)) : null, oi_to_mcap_pct: oiMcap !== null ? Number(oiMcap.toFixed(2)) : null,
      top_traders_ls: ls, ls_vs_7d: lsSkew !== null ? Number(lsSkew.toFixed(2)) : null, liq_24h_usd: liq, liq_long_share_pct: liq ? Math.round(((longs ?? 0) / liq) * 100) : null,
      price_24h_pct: price !== null ? Number(price.toFixed(2)) : null, reasons };
  }).sort((a, b) => b.score - a.score);
}

export const leverageRadar = defineAgent({
  id: "leverage-radar",
  name: "Leverage Radar",
  tagline: "Spots crowded futures trades before they unwind.",
  persona: ["Trading-agent developers", "Active traders", "Funds & market makers"],
  description: "Scores every token with a futures market from 0 to 100 for crowding, combining funding against its own 14-day history, open-interest growth (especially while price is flat), top traders' long/short versus their 7-day average, open interest as a share of market cap, and recent liquidations. Returns which side is crowded and how fragile the market is.",
  tier: "premium",
  masumi: false,
  verdicts: ["CROWDED", "ELEVATED", "BALANCED"],
  input: z.object({
    tokens: z.array(z.string()).max(50).optional().describe("Tokens to score; default every token with a futures market"),
    top: z.number().int().min(1).max(50).default(10),
  }),
  example: { top: 5 },
  async run({ tokens, top }) {
    const ids = tokens?.length ? (await Promise.all(tokens.map((t) => resolveToken(t)))).map((t) => t.coingecko_id) : null;
    const list = (await computeCrowding(ids)).slice(0, top);
    const worst = list[0];
    const verdict = !worst ? "BALANCED" : worst.score >= 65 ? "CROWDED" : worst.score >= 45 ? "ELEVATED" : "BALANCED";
    const crowded = list.filter((c) => c.score >= 65);
    return {
      verdict,
      summary: crowded.length
        ? `${crowded.length} crowded market${crowded.length > 1 ? "s" : ""}: ${crowded.slice(0, 3).map((c) => `${c.symbol} (${c.score}, ${c.side})`).join(", ")}. Squeeze risk is highest where leverage built up without price following.`
        : worst ? `No crowded markets. Most stretched: ${worst.symbol} at ${worst.score}/100 (${worst.regime}).` : "No futures data available.",
      result: { scored: list.length, markets: list },
      reasons: list.slice(0, 3).flatMap((c) => c.reasons.slice(0, 2).map((t) => ({ text: `${c.symbol}: ${t}`, source: "binanceusdm:funding+openInterest+positioning, okx+binance:liquidations" }))),
      tokens: list.map((c) => c.id),
    };
  },
});

// ---------------------------------------------------------------------------------------------------
// 4. Whale Watch — what the big wallets are doing with a token.
// ---------------------------------------------------------------------------------------------------
export const whaleWatch = defineAgent({
  id: "whale-watch",
  name: "Whale Watch",
  tagline: "Shows what the big wallets are doing with a token.",
  persona: ["Trading-agent developers", "Funds & market makers"],
  description: "Reads onchain flows through NOWNodes: large transfers tagged with exchange names, net flows onto or off exchanges compared with the token's own 7-day pattern, exchange reserve trends and, live from the chain, who the biggest unlabelled wallets are. Returns ACCUMULATING, DISTRIBUTING or NEUTRAL with the moves behind it.",
  tier: "premium",
  masumi: false,
  verdicts: ["ACCUMULATING", "DISTRIBUTING", "NEUTRAL", "NO_DATA"],
  input: z.object({ token: tokenField }),
  example: { token: "aave" },
  async run({ token: t }) {
    const token = await resolveToken(t);
    const st = await buildState(token, ["onchain", "market"]);
    const on = st.sections.onchain as Record<string, unknown>;
    if ((on as { status?: string }).status === "unassessed") {
      return { verdict: "NO_DATA", summary: `${token.symbol.toUpperCase()} has no onchain coverage (its chain is not reachable through NOWNodes); whale flows cannot be assessed.`, result: { token: token.coingecko_id }, reasons: [], tokens: [token.coingecko_id] };
    }
    // Daily net exchange flow for the last 7 days → z-score of the latest 24h.
    const days = await sql`select date_trunc('day', window_start) as d, sum(exchange_net_usd) as net from onchain_flow_snapshots where coingecko_id = ${token.coingecko_id} and window_start > now() - interval '8 days' group by 1 order by 1`;
    const series = days.map((d) => Number(d.net));
    const net24 = n(get(on, "exchange_flows.24h.net_usd"));
    const mean = series.length ? series.reduce((a, b) => a + b, 0) / series.length : 0;
    const sd = series.length > 2 ? Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / (series.length - 1)) : 0;
    const z24 = net24 !== null && sd > 0 ? (net24 - mean) / sd : null;
    const reserves = get(on, "exchange_reserves") as { total: number; by_exchange: { exchange: string; change_24h_pct: number | null; change_7d_pct: number | null; usd: number | null }[] } | string;
    const resCh = typeof reserves === "object" && reserves?.by_exchange?.length
      ? reserves.by_exchange.reduce((s, e) => s + (e.usd ?? 0) * ((e.change_7d_pct ?? 0) / 100), 0) / Math.max(1, reserves.by_exchange.reduce((s, e) => s + (e.usd ?? 0), 0)) * 100 : null;
    const transfers = (get(on, "large_transfers_24h") ?? []) as { usd: number | null; direction: string; from: string; to: string; from_entity: string | null; to_entity: string | null; chain: string; at: string; tx: string }[];
    const toEx = transfers.filter((x) => x.direction === "to_exchange"), fromEx = transfers.filter((x) => x.direction === "from_exchange");
    const vol24 = n(get(st.sections.market, "volume_24h_usd"));
    const material = net24 !== null && vol24 ? Math.abs(net24) / vol24 >= 0.005 : false;

    let verdict = "NEUTRAL";
    if (net24 !== null && net24 > 0 && ((z24 !== null && z24 >= 1.5) || material) && (resCh === null || resCh >= 0)) verdict = "DISTRIBUTING";
    else if (net24 !== null && net24 < 0 && ((z24 !== null && z24 <= -1.5) || material) && (resCh === null || resCh <= 0)) verdict = "ACCUMULATING";

    // Who are the biggest unlabelled counterparties? (live lookups, at most two)
    const chainOf = (c: string) => (["eth", "bsc", "btc", "sol", "ada"].includes(c) ? (c as Chain) : null);
    const unknown = transfers.filter((x) => !x.from_entity || !x.to_entity).slice(0, 2);
    const profiles = (await Promise.all(unknown.map(async (x) => {
      const addr = !x.from_entity ? x.from : x.to;
      const ch = chainOf(x.chain);
      if (!ch || !addr) return null;
      const p = await Promise.race([inspectAddress(ch, addr), new Promise<null>((r) => setTimeout(() => r(null), 20_000))]).catch(() => null);
      return p ? { address: addr, chain: ch, role: !x.from_entity ? "sender" : "receiver", type: (p.data as { type?: string }).type, tx_count: (p.data as { tx_count?: number }).tx_count ?? null, label: (p.data as { label?: unknown }).label } : null;
    }))).filter(Boolean);

    const sym = token.symbol.toUpperCase();
    const reasons: Reason[] = [];
    if (net24 !== null) reasons.push({ text: `Net ${fmtUsd(Math.abs(net24))} ${net24 >= 0 ? "moved onto" : "withdrawn from"} exchanges in 24h${z24 !== null ? ` (${z24 >= 0 ? "+" : ""}${z24.toFixed(1)}σ vs the 7-day pattern)` : ""}`, source: "nownodes:eth_getLogs" });
    if (resCh !== null) reasons.push({ text: `Exchange reserves ${fmtPct(resCh, 1)} over 7 days`, source: "nownodes:blockbook:/address" });
    if (toEx[0]) reasons.push({ text: `Largest deposit: ${fmtUsd(toEx[0].usd)} → ${toEx[0].to_entity}`, source: "nownodes:onchain_transfers" });
    if (fromEx[0]) reasons.push({ text: `Largest withdrawal: ${fmtUsd(fromEx[0].usd)} ← ${fromEx[0].from_entity}`, source: "nownodes:onchain_transfers" });
    return {
      verdict,
      summary: verdict === "DISTRIBUTING" ? `${sym}: whales are moving coins onto exchanges (${fmtUsd(net24)} net in 24h) — possible selling ahead.`
        : verdict === "ACCUMULATING" ? `${sym}: coins are leaving exchanges (${fmtUsd(Math.abs(net24 ?? 0))} net in 24h) — holders taking custody.`
        : `${sym}: no unusual whale behaviour; exchange flows are within the normal range.`,
      result: {
        token: { id: token.coingecko_id, symbol: sym },
        exchange_flows: get(on, "exchange_flows"), net_24h_zscore: z24 !== null ? Number(z24.toFixed(2)) : null, daily_net_7d: days.map((d) => ({ day: d.d, net_usd: Number(d.net) })),
        reserves_7d_change_pct: resCh !== null ? Number(resCh.toFixed(2)) : null, deposits: toEx.slice(0, 5), withdrawals: fromEx.slice(0, 5),
        other_large_moves: transfers.filter((x) => x.direction === "other").slice(0, 5), wallet_profiles: profiles,
      },
      reasons,
      tokens: [token.coingecko_id],
    };
  },
});

// ---------------------------------------------------------------------------------------------------
// 2. Opportunity Scout — finds what's moving, keeps only what's safe to act on.
// ---------------------------------------------------------------------------------------------------
export const opportunityScout = defineAgent({
  id: "opportunity-scout",
  name: "Opportunity Scout",
  tagline: "Finds what's moving, keeps only what's safe to act on.",
  persona: ["Trading-agent developers", "Active traders"],
  description: "Scans the 100 tracked tokens for momentum, volume spikes, coins leaving exchanges and fresh signals, runs the full CoinGraph check on each candidate and drops anything rated avoid. Returns a ranked shortlist; each setup has why it is interesting, what could go wrong, an invalidation price and a time horizon. Every setup is recorded and graded later.",
  tier: "pro",
  masumi: false,
  verdicts: ["SETUPS_FOUND", "NOTHING_CLEAN"],
  input: z.object({ limit: z.number().int().min(1).max(10).default(5) }),
  example: { limit: 5 },
  async run({ limit }) {
    const m = await buildMarket(["rankings"]);
    const rk = m.sections.rankings as Record<string, { id: string; symbol: string; change_1h_pct?: number; kind?: string; direction?: string }[]>;
    const score = new Map<string, { symbol: string; points: number; why: string[] }>();
    const add = (id: string, symbol: string, pts: number, why: string) => {
      const e = score.get(id) ?? { symbol, points: 0, why: [] };
      e.points += pts; e.why.push(why); score.set(id, e);
    };
    for (const r of rk.gainers_1h ?? []) if ((r.change_1h_pct ?? 0) > 0.5) add(r.id, r.symbol, 2, `up ${fmtPct(r.change_1h_pct ?? null)} in 1h`);
    for (const r of rk.volume_spikes ?? []) add(r.id, r.symbol, 2, "volume spike");
    for (const r of rk.exchange_outflows ?? []) add(r.id, r.symbol, 2, "coins leaving exchanges");
    const sigs = await sql`select s.coingecko_id, upper(t.symbol) as symbol, s.kind, s.direction from signals s join tokens t using (coingecko_id)
      where s.detected_at > now() - interval '3 hours' and s.direction = 'up' and not t.is_stablecoin`;
    for (const s of sigs) add(s.coingecko_id, s.symbol, 1, s.kind.replace(/_/g, " "));
    for (const v of score.values()) v.why = [...new Set(v.why)];
    const candidates = [...score.entries()].sort((a, b) => b[1].points - a[1].points).slice(0, 10);
    const toks = (await sql<Token[]>`select coingecko_id, symbol, name, market_cap_rank, is_stablecoin, is_demo from tokens where coingecko_id = any(${candidates.map(([id]) => id)}) and not is_stablecoin`);
    const byId = new Map(toks.map((t) => [t.coingecko_id, t]));
    const checked: { id: string; symbol: string; points: number; why: string[]; ev: Eval }[] = [];
    for (let i = 0; i < candidates.length; i += 4) {
      const batch = await Promise.all(candidates.slice(i, i + 4).map(async ([id, c]) => {
        const tk = byId.get(id);
        if (!tk) return null;
        const ev = await evaluate(tk).catch(() => null);
        return ev ? { id, symbol: c.symbol, points: c.points, why: c.why, ev } : null;
      }));
      checked.push(...(batch.filter(Boolean) as typeof checked));
    }
    const clean = checked.filter((c) => c.ev.data.verdict !== "avoid")
      .map((c) => ({ ...c, rank: c.points + (c.ev.data.verdict === "proceed" ? 2 : 0) }))
      .sort((a, b) => b.rank - a.rank).slice(0, limit);
    const setups = await Promise.all(clean.map(async (c) => {
      const [lo] = await sql`select min(current_price) as low, (select current_price from market_snapshots where coingecko_id = ${c.id} order by captured_at desc limit 1) as price from market_snapshots where coingecko_id = ${c.id} and captured_at > now() - interval '4 hours'`;
      const price = n(lo?.price), low = n(lo?.low);
      return {
        token: { id: c.id, symbol: c.symbol }, price_usd: price,
        why: c.why.slice(0, 4), check: c.ev.data.verdict, evaluation_id: c.ev.id,
        risks: cautionReasons(c.ev).map((r) => r.text).slice(0, 3),
        invalidation_usd: low !== null && price !== null ? Number(Math.min(low, price * 0.97).toPrecision(6)) : null,
        horizon: "4–24 hours", direction: "long",
      };
    }));
    const dropped = checked.filter((c) => c.ev.data.verdict === "avoid").map((c) => ({ token: c.symbol, why: cautionReasons(c.ev)[0]?.text ?? "failed the check" }));
    return {
      verdict: setups.length ? "SETUPS_FOUND" : "NOTHING_CLEAN",
      summary: setups.length ? `${setups.length} setup${setups.length > 1 ? "s" : ""} passed the check: ${setups.map((s) => s.token.symbol).join(", ")}.${dropped.length ? ` ${dropped.length} mover${dropped.length > 1 ? "s" : ""} dropped for failing it.` : ""}` : "Nothing moving passed the check right now.",
      result: { setups, dropped, scanned: candidates.length },
      reasons: setups.map((s) => ({ text: `${s.token.symbol}: ${s.why.join(", ")}`, source: "coingecko+ccxt+nownodes signals, coingraph:evaluate" })),
      links: Object.fromEntries(setups.map((s) => [`proof_${s.token.symbol}`, `/api/v1/verify/${s.evaluation_id}`])),
      tokens: setups.map((s) => s.token.id),
    };
  },
});
