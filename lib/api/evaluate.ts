import { sql } from "../db";
import { buildState } from "./state";
import { canonical, newId, num, round, sha256, BASE_URL, type Source, type Token } from "./respond";

// Evaluate: "the check before you act". A deterministic verdict per dimension computed from the state,
// optionally scored against the caller's order size and policy. Every evaluation is stored with its id,
// the numbers it was computed from and a hash, so it can be verified and graded later.

export type Rating = "ok" | "caution" | "avoid" | "unassessed";
export type Policy = { max_unlock_pct?: number; min_depth_usd?: number; allow_mint_authority?: boolean; max_top10_holder_pct?: number; max_funding_pct?: number; max_exchange_inflow_usd?: number };
type Reason = { text: string; source: string };
type Dimension = { rating: Rating; reasons: Reason[] };

const n = (v: unknown): number | null => (typeof v === "number" ? v : v === null || v === undefined || v === "unassessed" ? null : num(v));
const get = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);
const usd = (v: number | null) => (v === null ? "n/a" : `$${Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`);
const worst = (ratings: Rating[]): Rating => (ratings.includes("avoid") ? "avoid" : ratings.includes("caution") ? "caution" : ratings.includes("ok") ? "ok" : "unassessed");

export async function evaluate(token: Token, opts: { size_usd?: number; policy?: Policy; requester?: string } = {}) {
  const state = await buildState(token, ["market", "liquidity", "derivatives", "onchain", "supply", "context", "signals"]);
  const s = state.sections as Record<string, Record<string, unknown>>;
  const dims: Record<string, Dimension> = {};
  const sources: Source[] = state.sources;

  // Momentum: how stretched the recent move is.
  {
    const ch = (get(s.market, "change_pct") ?? {}) as Record<string, number | null>;
    const vol = n(get(s.market, "volatility_24h_pct"));
    const r: Reason[] = [];
    let rating: Rating = ch["1h"] === undefined ? "unassessed" : "ok";
    if (ch["1h"] !== null && Math.abs(ch["1h"]) >= 5) { rating = "caution"; r.push({ text: `Moved ${ch["1h"] > 0 ? "+" : ""}${ch["1h"]}% in the last hour — a fast move that often retraces`, source: "coingecko:/coins/markets" }); }
    if (ch["24h"] !== null && Math.abs(ch["24h"]) >= 15) { rating = "caution"; r.push({ text: `${ch["24h"] > 0 ? "+" : ""}${ch["24h"]}% in 24h`, source: "coingecko:/coins/markets" }); }
    if (vol !== null && vol >= 8) { rating = worst([rating, "caution"]); r.push({ text: `Realised volatility ${vol}% per day`, source: "coingecko:/coins/markets" }); }
    if (rating === "ok") r.push({ text: `1h ${fmt(ch["1h"])}, 24h ${fmt(ch["24h"])}: nothing stretched`, source: "coingecko:/coins/markets" });
    dims.momentum = { rating, reasons: r };
  }

  // Liquidity: can the market absorb the order?
  let sizeCheck: Record<string, unknown> | null = null;
  {
    const depth = get(s.liquidity, "depth_2pct_total_usd") as { bid: number | null; ask: number | null } | "unassessed";
    const ctm = get(s.liquidity, "exchanges.cost_to_move_2pct_usd") as { up: number | null; down: number | null } | undefined;
    const vol24 = n(get(s.market, "volume_24h_usd"));
    const r: Reason[] = [];
    let rating: Rating = "unassessed";
    const askDepth = depth !== "unassessed" ? n(depth?.ask) : null;
    const bidDepth = depth !== "unassessed" ? n(depth?.bid) : null;
    const moveUp = n(ctm?.up), moveDown = n(ctm?.down);
    const available = askDepth ?? moveUp;
    if (available !== null) {
      rating = available < 10_000 ? "avoid" : available < 100_000 ? "caution" : "ok";
      r.push({ text: `${usd(available)} available within 2% of the price${askDepth !== null ? " on tracked order books" : " across exchanges (CoinGecko)"}`, source: askDepth !== null ? "ccxt:fetchOrderBook" : "coingecko:/coins/{id}/tickers" });
    }
    if (opts.size_usd && available !== null) {
      const impact = (opts.size_usd / available) * 2; // % move if the order consumed that share of 2% depth
      const volShare = vol24 ? (opts.size_usd / vol24) * 100 : null;
      sizeCheck = { order_usd: opts.size_usd, depth_2pct_usd: { bid: bidDepth ?? moveDown, ask: askDepth ?? moveUp }, estimated_impact_pct: round(Math.min(impact, 100)), share_of_24h_volume_pct: round(volShare, 3) };
      if (impact >= 2) { rating = "avoid"; r.push({ text: `A ${usd(opts.size_usd)} order would move the price about ${round(Math.min(impact, 100))}%`, source: "ccxt:fetchOrderBook" }); }
      else if (impact >= 0.5 || (volShare !== null && volShare >= 1)) { rating = worst([rating, "caution"]); r.push({ text: `A ${usd(opts.size_usd)} order is ${round(volShare, 2)}% of daily volume and would move the price ~${round(impact)}%`, source: "ccxt:fetchOrderBook" }); }
      else r.push({ text: `A ${usd(opts.size_usd)} order is ${round(volShare, 3)}% of daily volume with ~${round(impact, 3)}% impact`, source: "ccxt:fetchOrderBook" });
    }
    const disp = n(get(s.liquidity, "price_dispersion_pct"));
    if (disp !== null && disp >= 1) { rating = worst([rating, "caution"]); r.push({ text: `Prices differ by ${disp}% across venues`, source: "ccxt:fetchTickers" }); }
    dims.liquidity = { rating, reasons: r };
  }

  // Leverage: is the futures market crowded or fragile?
  {
    const funding = get(s.derivatives, "funding") as { venue: string; rate_pct: number | null }[] | "unassessed";
    const oiChange = (get(s.derivatives, "open_interest.change_pct") ?? {}) as Record<string, number | null>;
    const liq1h = n(get(s.derivatives, "liquidations.1h.usd"));
    const lev = n(get(s.derivatives, "leverage_ratio"));
    const r: Reason[] = [];
    let rating: Rating = funding === "unassessed" && !lev ? "unassessed" : "ok";
    if (Array.isArray(funding)) {
      const maxF = funding.reduce((m, f) => (f.rate_pct !== null && Math.abs(f.rate_pct) > Math.abs(m) ? f.rate_pct : m), 0);
      if (Math.abs(maxF) >= 0.1) { rating = "caution"; r.push({ text: `Funding ${maxF}% per 8h — ${maxF > 0 ? "longs" : "shorts"} are crowded and paying heavily`, source: "ccxt:fetchFundingRates" }); }
      else if (Math.abs(maxF) >= 0.05) { rating = "caution"; r.push({ text: `Funding ${maxF}% per 8h, above the ~0.01% norm`, source: "ccxt:fetchFundingRates" }); }
      else r.push({ text: `Funding ${maxF}% per 8h: leverage not crowded`, source: "ccxt:fetchFundingRates" });
    }
    if (oiChange["24h"] !== null && oiChange["24h"] !== undefined && Math.abs(oiChange["24h"]) >= 20) { rating = worst([rating, "caution"]); r.push({ text: `Open interest ${oiChange["24h"] > 0 ? "+" : ""}${oiChange["24h"]}% in 24h`, source: "binanceusdm:openInterestHist" }); }
    if (liq1h !== null && liq1h >= 5_000_000) { rating = worst([rating, "caution"]); r.push({ text: `${usd(liq1h)} liquidated in the last hour`, source: "okx+binance:liquidations" }); }
    if (lev !== null && lev >= 0.5) { rating = worst([rating, "caution"]); r.push({ text: `Open interest is ${round(lev * 100)}% of market cap`, source: "ccxt:openInterest" }); }
    dims.leverage = { rating, reasons: r };
  }

  // Onchain: is supply moving onto exchanges?
  {
    const net24 = n(get(s.onchain, "exchange_flows.24h.net_usd"));
    const typical = n(get(s.onchain, "exchange_flows.typical_15m_abs_net_usd"));
    const transfers = (get(s.onchain, "large_transfers_24h") ?? []) as { usd: number | null; direction: string; to_entity: string | null }[];
    const vol24 = n(get(s.market, "volume_24h_usd"));
    const r: Reason[] = [];
    let rating: Rating = net24 === null ? "unassessed" : "ok";
    if (net24 !== null) {
      const big = typical ? Math.abs(net24) > typical * 96 * 2 : false;
      const share = vol24 ? Math.abs(net24) / vol24 : 0;
      if (net24 > 0 && (big || share >= 0.02)) { rating = "caution"; r.push({ text: `Net ${usd(net24)} moved onto exchanges in 24h (${Math.round(share * 100 * 10) / 10}% of daily volume) — potential sell-side supply`, source: "nownodes:eth_getLogs" }); }
      else if (net24 < 0 && (big || share >= 0.02)) r.push({ text: `Net ${usd(Math.abs(net24))} withdrawn from exchanges in 24h — holders taking custody`, source: "nownodes:eth_getLogs" });
      else r.push({ text: `Exchange net flow ${usd(net24)} in 24h: normal`, source: "nownodes:eth_getLogs" });
    }
    const toEx = transfers.filter((t) => t.direction === "to_exchange" && (t.usd ?? 0) >= 5_000_000);
    if (toEx.length) { rating = worst([rating, "caution"]); r.push({ text: `${toEx.length} transfer(s) ≥ $5M to exchanges in 24h (largest ${usd(toEx[0].usd)} → ${toEx[0].to_entity})`, source: "nownodes:onchain_transfers" }); }
    dims.onchain = { rating, reasons: r };
  }

  // Supply: dilution and concentration.
  {
    const fdv = n(get(s.supply, "fdv_to_market_cap"));
    const top10 = n(get(s.supply, "top_holders_pct.top10"));
    const r: Reason[] = [];
    let rating: Rating = fdv === null && top10 === null ? "unassessed" : "ok";
    if (fdv !== null && fdv >= 3) { rating = "caution"; r.push({ text: `Fully diluted value is ${fdv}× market cap — most supply is not yet circulating`, source: "coingecko:/coins/markets" }); }
    else if (fdv !== null) r.push({ text: `FDV / market cap ${fdv}`, source: "coingecko:/coins/markets" });
    if (top10 !== null && top10 >= 80) { rating = "avoid"; r.push({ text: `Top 10 holders own ${top10}% of supply`, source: "nownodes:getTokenLargestAccounts" }); }
    else if (top10 !== null && top10 >= 50) { rating = worst([rating, "caution"]); r.push({ text: `Top 10 holders own ${top10}% of supply`, source: "nownodes:getTokenLargestAccounts" }); }
    r.push({ text: "Unlock schedule: unassessed (no free source)", source: "coingraph" });
    dims.supply = { rating, reasons: r };
  }

  // Context: fundamentals, development, mood.
  {
    const tvl = (get(s.context, "protocol_tvl") ?? []) as { name: string; change_1d_pct: number | null }[] | "unassessed";
    const dev = get(s.context, "development") as { commits_4w: number } | "unassessed";
    const fg = get(s.context, "fear_greed") as { value: number; label: string } | "unassessed";
    const news = (get(s.context, "news_24h") ?? []) as unknown[];
    const r: Reason[] = [];
    let rating: Rating = "ok";
    if (Array.isArray(tvl)) for (const t of tvl) if (t.change_1d_pct !== null && t.change_1d_pct <= -10) { rating = t.change_1d_pct <= -25 ? "avoid" : "caution"; r.push({ text: `${t.name} TVL ${t.change_1d_pct}% in a day`, source: "defillama:/protocols" }); }
    if (dev !== "unassessed" && dev && dev.commits_4w === 0) { rating = worst([rating, "caution"]); r.push({ text: "No code commits in the last 4 weeks", source: "coingecko:/coins/{id}" }); }
    if (fg !== "unassessed" && fg && (fg.value >= 85 || fg.value <= 15)) { rating = worst([rating, "caution"]); r.push({ text: `Market mood: ${fg.label} (${fg.value})`, source: "alternative.me:/fng" }); }
    if (news.length) r.push({ text: `${news.length} headline(s) in 24h`, source: "rss" });
    if (!r.length) r.push({ text: "No fundamental or mood flags", source: "coingraph" });
    dims.context = { rating, reasons: r };
  }

  dims.contract = { rating: "unassessed", reasons: [{ text: "Contract security (mint, freeze, owner powers): not yet assessed", source: "coingraph" }] };

  // Policy checks.
  let policyCheck: Record<string, unknown> | null = null;
  if (opts.policy && Object.keys(opts.policy).length) {
    const p = opts.policy;
    const depth = n((get(s.liquidity, "depth_2pct_total_usd") as { ask?: number } | "unassessed") !== "unassessed" ? get(s.liquidity, "depth_2pct_total_usd.ask") : get(s.liquidity, "exchanges.cost_to_move_2pct_usd.up"));
    const top10 = n(get(s.supply, "top_holders_pct.top10"));
    const funding = get(s.derivatives, "funding") as { rate_pct: number | null }[] | "unassessed";
    const maxF = Array.isArray(funding) ? funding.reduce((m, f) => Math.max(m, Math.abs(f.rate_pct ?? 0)), 0) : null;
    const net24 = n(get(s.onchain, "exchange_flows.24h.net_usd"));
    const check = (ok: boolean | null, detail: string) => ({ result: ok === null ? "unknown" : ok ? "pass" : "fail", detail });
    policyCheck = {
      ...(p.min_depth_usd !== undefined ? { min_depth_usd: check(depth === null ? null : depth >= p.min_depth_usd, `required ${usd(p.min_depth_usd)}, available ${usd(depth)}`) } : {}),
      ...(p.max_top10_holder_pct !== undefined ? { max_top10_holder_pct: check(top10 === null ? null : top10 <= p.max_top10_holder_pct, `limit ${p.max_top10_holder_pct}%, actual ${top10 ?? "unassessed"}%`) } : {}),
      ...(p.max_funding_pct !== undefined ? { max_funding_pct: check(maxF === null ? null : maxF <= p.max_funding_pct, `limit ${p.max_funding_pct}%, actual ${maxF ?? "unassessed"}%`) } : {}),
      ...(p.max_exchange_inflow_usd !== undefined ? { max_exchange_inflow_usd: check(net24 === null ? null : net24 <= p.max_exchange_inflow_usd, `limit ${usd(p.max_exchange_inflow_usd)}, actual net ${usd(net24)} in 24h`) } : {}),
      ...(p.max_unlock_pct !== undefined ? { max_unlock_pct: check(null, "unlock schedule unassessed") } : {}),
      ...(p.allow_mint_authority !== undefined ? { allow_mint_authority: check(null, "contract security unassessed") } : {}),
    };
    if (Object.values(policyCheck).some((c) => (c as { result: string }).result === "fail")) dims.policy = { rating: "avoid", reasons: [{ text: "One or more of your policy rules fail", source: "coingraph" }] };
  }

  const ratings = Object.values(dims).map((d) => d.rating);
  const verdict = ratings.includes("avoid") ? "avoid" : ratings.includes("caution") ? "caution" : "proceed";
  const assessed = ratings.filter((r) => r !== "unassessed").length;
  const confidence = round(Math.min(0.95, 0.35 + (assessed / Object.keys(dims).length) * 0.6));
  const reasons = Object.entries(dims).filter(([, d]) => d.rating === "avoid" || d.rating === "caution").flatMap(([dim, d]) => d.reasons.map((r) => ({ dimension: dim, ...r }))).slice(0, 6);
  if (!reasons.length) reasons.push(...Object.entries(dims).filter(([, d]) => d.rating === "ok").slice(0, 3).flatMap(([dim, d]) => d.reasons.slice(0, 1).map((r) => ({ dimension: dim, ...r }))));
  const watchNext = [
    dims.momentum.rating !== "ok" ? "Whether the move holds over the next hour or retraces" : null,
    dims.leverage.rating === "caution" ? "Funding and open interest: a reset would remove the crowding" : null,
    dims.onchain.rating === "caution" ? "Whether the coins sent to exchanges are sold or sit idle" : null,
    dims.liquidity.rating !== "ok" ? "Order-book depth recovering, or split the order over time" : null,
  ].filter(Boolean);

  const id = newId("eval");
  const data = {
    token: state.token, verdict, confidence, dimensions: dims, reasons, size_check: sizeCheck, policy_check: policyCheck, watch_next: watchNext,
    snapshot: { market: s.market, liquidity_depth: get(s.liquidity, "depth_2pct_total_usd"), derivatives: { funding: get(s.derivatives, "funding"), open_interest_change: get(s.derivatives, "open_interest.change_pct"), liquidations_1h: get(s.derivatives, "liquidations.1h") }, onchain_flows_24h: get(s.onchain, "exchange_flows.24h"), supply: { fdv_to_market_cap: get(s.supply, "fdv_to_market_cap"), top_holders: get(s.supply, "top_holders_pct") } },
    disclaimer: "CoinGraph never executes, custodies or advises. The caller decides.",
  };
  const hash = sha256(canonical(data));
  // `snapshot` stores the exact object that was hashed, so /verify can recompute the hash byte for byte.
  await sql`
    insert into evaluations (id, coingecko_id, verdict, confidence, dimensions, reasons, size_usd, policy, size_check, policy_check, watch_next, snapshot, sources, hash, requester)
    values (${id}, ${token.coingecko_id}, ${verdict}, ${confidence}, ${sql.json(dims as never)}, ${sql.json(reasons as never)}, ${opts.size_usd ?? null}, ${opts.policy ? sql.json(opts.policy as never) : null},
            ${sizeCheck ? sql.json(sizeCheck as never) : null}, ${policyCheck ? sql.json(policyCheck as never) : null}, ${sql.json(watchNext as never)}, ${sql.json(data as never)}, ${sql.json(sources as never)}, ${hash}, ${opts.requester ?? null})`;
  return { id, data: { ...data, hash, verify_url: `${BASE_URL}/api/v1/verify/${id}` }, sources, as_of: state.as_of ?? new Date() };
}

function fmt(v: number | null | undefined) {
  return v === null || v === undefined ? "n/a" : `${v > 0 ? "+" : ""}${v}%`;
}
