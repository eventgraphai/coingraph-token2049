import { sql } from "../db";
import { blockbook, rpc, toHex, fromUnits, type EvmChain } from "../nownodes/client";

// Evidence gathering for one investigation: everything comes from our own database (CoinGecko, 7 exchanges,
// NOWNodes feeds) plus a few fresh NOWNodes lookups on the wallets involved. Each item carries an id (E1, E2 …)
// that the brief cites, a source, a one-line summary and the underlying numbers.

export type EvidenceItem = { id: string; source: string; kind: string; summary: string; data: Record<string, unknown> };

export type Evidence = {
  coingecko_id: string;
  symbol: string;
  name: string;
  window_from: string;
  window_to: string;
  gathered_at: string;
  items: EvidenceItem[];
};

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const pct = (a: number | null, b: number | null) => (a !== null && b !== null && b !== 0 ? Math.round(((a / b - 1) * 10000)) / 100 : null);
const usd = (v: number | null) => (v === null ? "n/a" : `$${Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`);
const signed = (v: number | null, unit = "%") => (v === null ? "n/a" : `${v > 0 ? "+" : ""}${v}${unit}`);

export async function gatherEvidence(coingecko_id: string, windowFrom: Date, windowTo: Date, triggerSignalIds: number[] = []): Promise<Evidence> {
  const items: EvidenceItem[] = [];
  let seq = 0;
  const add = (source: string, kind: string, summary: string, data: Record<string, unknown>) => {
    items.push({ id: `E${++seq}`, source, kind, summary, data });
  };

  const [token] = await sql`select coingecko_id, symbol, name, market_cap_rank, categories, is_demo from tokens where coingecko_id = ${coingecko_id}`;
  if (!token) throw new Error(`unknown coin ${coingecko_id}`);
  const sym = String(token.symbol).toUpperCase();

  // --- Market (CoinGecko, 1-minute) -------------------------------------------------------------
  const [now] = await sql`
    select m.current_price, m.market_cap, m.market_cap_rank, m.total_volume, m.price_change_percentage_24h as ch24h, m.ath, m.captured_at,
           (m.current_price / nullif((select current_price from market_snapshots p where p.coingecko_id = m.coingecko_id and p.captured_at <= m.captured_at - interval '60 minutes' order by p.captured_at desc limit 1), 0) - 1) * 100 as ch1h,
           (m.current_price / nullif((select current_price from market_snapshots p where p.coingecko_id = m.coingecko_id and p.captured_at <= m.captured_at - interval '7 days' order by p.captured_at desc limit 1), 0) - 1) * 100 as ch7d
    from market_snapshots m where m.coingecko_id = ${coingecko_id} order by m.captured_at desc limit 1`;
  const path = await sql`
    select distinct on (date_trunc('hour', captured_at) + floor(extract(minute from captured_at) / 15) * interval '15 minutes')
           date_trunc('hour', captured_at) + floor(extract(minute from captured_at) / 15) * interval '15 minutes' as t, current_price as p, total_volume as v
    from market_snapshots where coingecko_id = ${coingecko_id} and captured_at between ${windowFrom} and ${windowTo}
    order by 1, captured_at`;
  if (now) {
    const prices = path.map((r) => Number(r.p));
    const hi = Math.max(...prices), lo = Math.min(...prices);
    const first = prices[0] ?? null, last = Number(now.current_price);
    add("coingecko:/coins/markets", "price", `${sym} ${usd(last)} now; ${signed(pct(last, first))} over the window (high ${usd(hi)}, low ${usd(lo)}); 1h ${signed(n(now.ch1h) !== null ? Math.round(Number(now.ch1h) * 100) / 100 : null)}, 24h ${signed(n(now.ch24h) !== null ? Math.round(Number(now.ch24h) * 100) / 100 : null)}, 7d ${signed(n(now.ch7d) !== null ? Math.round(Number(now.ch7d) * 100) / 100 : null)}; rank #${now.market_cap_rank}, market cap ${usd(n(now.market_cap))}, 24h volume ${usd(n(now.total_volume))}`,
      { price: last, window_return_pct: pct(last, first), high: hi, low: lo, change_1h_pct: n(now.ch1h), change_24h_pct: n(now.ch24h), change_7d_pct: n(now.ch7d), rank: now.market_cap_rank, market_cap: n(now.market_cap), volume_24h: n(now.total_volume), ath: n(now.ath), as_of: now.captured_at,
        path_15m: path.map((r) => ({ t: r.t, price: Number(r.p) })) });
  }

  // --- Spot volume (primary venue, 1-minute candles) ---------------------------------------------
  const [spot] = await sql`
    with ps as (select venue, symbol from symbol_map where coingecko_id = ${coingecko_id} and is_primary and market_type = 'spot' and price_check_ok limit 1),
    h as (select date_trunc('hour', ts) as h, sum(quote_volume_usd) as v from cex_ohlcv_usd c join ps using (venue, symbol) where timeframe = '1m' and ts > now() - interval '25 hours' group by 1)
    select (select venue from ps) as venue, (select symbol from ps) as symbol,
           (select sum(quote_volume_usd) from cex_ohlcv_usd c join ps using (venue, symbol) where timeframe = '1m' and ts > now() - interval '60 minutes') as vol_1h,
           (select percentile_cont(0.5) within group (order by v) from h where h < date_trunc('hour', now())) as median_1h_24h,
           (select sum(quote_volume_usd) from cex_ohlcv_usd c join ps using (venue, symbol) where timeframe = '1m' and ts between ${windowFrom} and ${windowTo}) as vol_window`;
  if (spot?.venue) {
    const v1 = n(spot.vol_1h), med = n(spot.median_1h_24h);
    const topMinutes = await sql`
      select ts, close, quote_volume_usd as v, round((close / nullif(open, 0) - 1) * 100, 3) as ret from cex_ohlcv_usd
      where venue = ${spot.venue} and symbol = ${spot.symbol} and timeframe = '1m' and ts between ${windowFrom} and ${windowTo} order by quote_volume_usd desc nulls last limit 5`;
    add(`${spot.venue}:klines:1m`, "spot_volume", `${spot.venue} ${spot.symbol}: ${usd(v1)} traded in the last hour vs a typical hour of ${usd(med)} (${v1 !== null && med ? (v1 / med).toFixed(1) : "n/a"}×); busiest minutes: ${topMinutes.map((m) => `${new Date(m.ts).toISOString().slice(11, 16)} ${usd(n(m.v))} (${signed(n(m.ret))})`).join(", ")}`,
      { venue: spot.venue, symbol: spot.symbol, volume_1h_usd: v1, median_hourly_24h_usd: med, ratio: v1 !== null && med ? v1 / med : null, volume_window_usd: n(spot.vol_window), busiest_minutes: topMinutes });
  }

  // --- Futures (open interest, funding, positioning) ----------------------------------------------
  const oi = await sql`
    select exchange_ts, open_interest_usd from open_interest_usd where coingecko_id = ${coingecko_id} and venue = 'binanceusdm' and exchange_ts > now() - interval '5 hours' order by exchange_ts desc`;
  if (oi.length) {
    const at = (h: number) => oi.find((r) => new Date(r.exchange_ts).getTime() <= Date.now() - h * 3600_000);
    const cur = n(oi[0].open_interest_usd), h1 = n(at(1)?.open_interest_usd), h4 = n(at(4)?.open_interest_usd);
    add("binanceusdm:openInterestHist:5m", "open_interest", `Binance futures open interest ${usd(cur)}: ${signed(pct(cur, h1))} vs 1h ago, ${signed(pct(cur, h4))} vs 4h ago`,
      { open_interest_usd: cur, change_1h_pct: pct(cur, h1), change_4h_pct: pct(cur, h4), as_of: oi[0].exchange_ts });
  }
  const funding = await sql`
    select distinct on (venue) venue, symbol, funding_rate, captured_at from funding_rate_snapshots where coingecko_id = ${coingecko_id} and captured_at > now() - interval '30 minutes' order by venue, captured_at desc`;
  if (funding.length) {
    add("ccxt:fetchFundingRates", "funding", `Funding per 8h: ${funding.map((f) => `${f.venue} ${(Number(f.funding_rate) * 100).toFixed(4)}%`).join(", ")} (positive = longs pay; ~0.01% is normal)`,
      { rates: funding.map((f) => ({ venue: f.venue, symbol: f.symbol, funding_rate_pct: Number(f.funding_rate) * 100 })) });
  }
  const [sent] = await sql`
    select ts, global_long_short_ratio, top_account_long_short_ratio, top_position_long_short_ratio, taker_buy_sell_ratio from futures_sentiment_snapshots
    where coingecko_id = ${coingecko_id} and venue = 'binanceusdm' and ts > now() - interval '40 minutes' order by ts desc limit 1`;
  if (sent) {
    add("binanceusdm:futuresSentiment:5m", "positioning", `Binance positioning: all accounts long/short ${n(sent.global_long_short_ratio)?.toFixed(2)}, top traders by position ${n(sent.top_position_long_short_ratio)?.toFixed(2)}, taker buy/sell ${n(sent.taker_buy_sell_ratio)?.toFixed(2)} (>1 = net buying)`,
      { global_long_short: n(sent.global_long_short_ratio), top_account_long_short: n(sent.top_account_long_short_ratio), top_position_long_short: n(sent.top_position_long_short_ratio), taker_buy_sell: n(sent.taker_buy_sell_ratio), as_of: sent.ts });
  }

  // --- Liquidations --------------------------------------------------------------------------------
  const [liq] = await sql`
    select count(*)::int as count, coalesce(sum(notional_usd), 0) as total, coalesce(sum(notional_usd) filter (where side = 'SELL' or position_side = 'long'), 0) as longs,
           max(notional_usd) as largest
    from liquidations where coingecko_id = ${coingecko_id} and event_ts between ${windowFrom} and ${windowTo}`;
  if (liq && Number(liq.count) > 0) {
    const total = Number(liq.total), longs = Number(liq.longs);
    add("okx+binance:liquidations", "liquidations", `${liq.count} forced liquidations worth ${usd(total)} in the window: ${usd(longs)} longs, ${usd(total - longs)} shorts; largest ${usd(n(liq.largest))}`,
      { count: liq.count, total_usd: total, longs_usd: longs, shorts_usd: total - longs, largest_usd: n(liq.largest) });
  }

  // --- Order book (demo coins) ---------------------------------------------------------------------
  const [book] = await sql`
    select venue, symbol, best_bid, best_ask, depth_bid_2pct_usd, depth_ask_2pct_usd, captured_at from order_book_snapshots
    where coingecko_id = ${coingecko_id} order by captured_at desc limit 1`;
  if (book && new Date(book.captured_at).getTime() > Date.now() - 20 * 60_000) {
    const b = n(book.depth_bid_2pct_usd), a = n(book.depth_ask_2pct_usd);
    add(`${book.venue}:fetchOrderBook`, "order_book", `${book.venue} order book: ${usd(b)} of bids vs ${usd(a)} of asks within 2% (${b !== null && a ? (b / a).toFixed(2) : "n/a"} bid/ask depth ratio)`,
      { venue: book.venue, best_bid: n(book.best_bid), best_ask: n(book.best_ask), depth_bid_2pct_usd: b, depth_ask_2pct_usd: a, as_of: book.captured_at });
  }

  // --- Onchain flows (NOWNodes feeds) ---------------------------------------------------------------
  const [flow] = await sql`
    select count(*)::int as windows, sum(transfer_count)::int as transfers, sum(volume_usd) as volume_usd, sum(exchange_inflow_usd) as inflow, sum(exchange_outflow_usd) as outflow,
           sum(exchange_net_usd) as net, sum(large_transfer_count)::int as large, max(chain) as chain
    from onchain_flow_snapshots where coingecko_id = ${coingecko_id} and window_start >= ${windowFrom} - interval '15 minutes' and window_start <= ${windowTo}`;
  const [flowBase] = await sql`
    select percentile_cont(0.5) within group (order by abs(exchange_net_usd)) as med_abs_net, percentile_cont(0.5) within group (order by volume_usd) as med_volume
    from onchain_flow_snapshots where coingecko_id = ${coingecko_id} and window_start > now() - interval '7 days'`;
  if (flow && Number(flow.windows) > 0) {
    const net = n(flow.net);
    add(`nownodes:${flow.chain}:eth_getLogs`, "exchange_flows", `Onchain (${String(flow.chain).toUpperCase()}): ${flow.transfers} transfers worth ${usd(n(flow.volume_usd))} in the window; ${usd(n(flow.inflow))} moved onto exchanges, ${usd(n(flow.outflow))} left exchanges → net ${net !== null && net > 0 ? "inflow" : "outflow"} of ${usd(net !== null ? Math.abs(net) : null)} (typical 15-min |net| ${usd(n(flowBase?.med_abs_net))})`,
      { chain: flow.chain, transfers: flow.transfers, volume_usd: n(flow.volume_usd), exchange_inflow_usd: n(flow.inflow), exchange_outflow_usd: n(flow.outflow), exchange_net_usd: net, large_transfers: flow.large, median_abs_net_15m_7d: n(flowBase?.med_abs_net), median_volume_15m_7d: n(flowBase?.med_volume) });
  }
  const transfers = await sql`
    select chain, tx_hash, block_number, block_ts, from_address, to_address, amount, amount_usd, from_entity, to_entity, direction
    from onchain_transfers where coingecko_id = ${coingecko_id} and block_ts between ${windowFrom} - interval '15 minutes' and ${windowTo}
    order by amount_usd desc nulls last limit 12`;
  if (transfers.length) {
    add("nownodes:onchain_transfers", "large_transfers", `${transfers.length} largest transfers in the window: ${transfers.slice(0, 5).map((t) => `${usd(n(t.amount_usd))} ${t.direction === "to_exchange" ? `→ ${t.to_entity}` : t.direction === "from_exchange" ? `← ${t.from_entity}` : t.direction === "exchange_internal" ? `${t.from_entity} internal` : t.direction} at ${new Date(t.block_ts).toISOString().slice(11, 16)}`).join("; ")}`,
      { transfers: transfers.map((t) => ({ chain: t.chain, tx_hash: t.tx_hash, block: Number(t.block_number), ts: t.block_ts, from: t.from_address, to: t.to_address, amount: Number(t.amount), amount_usd: n(t.amount_usd), from_entity: t.from_entity, to_entity: t.to_entity, direction: t.direction })) });
  }
  const reserves = await sql`
    with latest as (select max(captured_at) as t from exchange_reserve_snapshots where coingecko_id = ${coingecko_id}),
    cur as (select entity, sum(balance) as bal, sum(balance_usd) as usd from exchange_reserve_snapshots, latest where coingecko_id = ${coingecko_id} and captured_at = latest.t group by 1),
    prev as (select entity, sum(balance) as bal from exchange_reserve_snapshots, latest where coingecko_id = ${coingecko_id}
             and captured_at = (select max(captured_at) from exchange_reserve_snapshots, latest where coingecko_id = ${coingecko_id} and captured_at <= latest.t - interval '23 hours') group by 1)
    select c.entity, c.bal, c.usd, p.bal as bal_24h_ago from cur c left join prev p using (entity) order by c.usd desc nulls last limit 8`;
  if (reserves.length) {
    const total = reserves.reduce((s, r) => s + Number(r.bal), 0);
    add("nownodes:eth-blockbook:/address/{wallet}", "exchange_reserves", `Known exchange wallets hold ${Intl.NumberFormat("en", { notation: "compact" }).format(total)} ${sym} (${usd(reserves.reduce((s, r) => s + Number(r.usd ?? 0), 0))}): ${reserves.slice(0, 4).map((r) => `${r.entity} ${Intl.NumberFormat("en", { notation: "compact" }).format(Number(r.bal))}${r.bal_24h_ago ? ` (${signed(pct(Number(r.bal), Number(r.bal_24h_ago)))} vs 24h ago)` : ""}`).join(", ")}`,
      { by_exchange: reserves.map((r) => ({ entity: r.entity, balance: Number(r.bal), balance_usd: n(r.usd), change_24h_pct: r.bal_24h_ago ? pct(Number(r.bal), Number(r.bal_24h_ago)) : null })) });
  }
  const [holders] = await sql`select chain, captured_at, top10_pct, top20_pct from token_holder_snapshots where coingecko_id = ${coingecko_id} order by captured_at desc limit 1`;
  if (holders) add(`nownodes:${holders.chain}:getTokenLargestAccounts`, "holder_concentration", `Top 10 holders own ${n(holders.top10_pct)?.toFixed(1)}% of supply, top 20 ${n(holders.top20_pct)?.toFixed(1)}% (${String(holders.chain).toUpperCase()}, as of ${new Date(holders.captured_at).toISOString().slice(0, 16)})`,
    { chain: holders.chain, top10_pct: n(holders.top10_pct), top20_pct: n(holders.top20_pct), as_of: holders.captured_at });

  // --- Fresh NOWNodes lookups: who are the untagged wallets behind the biggest transfers? ------------
  const [contract] = await sql`select chain, address, decimals from onchain_contracts where coingecko_id = ${coingecko_id} and chain in ('eth', 'bsc') order by case chain when 'eth' then 0 else 1 end limit 1`;
  if (contract) {
    const chain = contract.chain as EvmChain;
    const bb = chain === "eth" ? "eth-blockbook" : "bsc-blockbook";
    const counterparties: { address: string; role: string; usd: number }[] = [];
    for (const t of transfers) {
      if (t.chain !== chain) continue;
      if (!t.from_entity && t.direction !== "mint") counterparties.push({ address: t.from_address, role: "sender", usd: Number(t.amount_usd) });
      if (!t.to_entity && t.direction !== "burn") counterparties.push({ address: t.to_address, role: "receiver", usd: Number(t.amount_usd) });
    }
    const seen = new Set<string>();
    const picked = counterparties.filter((c) => (seen.has(c.address) ? false : (seen.add(c.address), true))).slice(0, 3);
    const [blockRow] = await sql`select min(from_block) as b from onchain_flow_snapshots where coingecko_id = ${coingecko_id} and chain = ${chain} and window_start >= ${windowFrom}`;
    const startBlock = blockRow?.b ? Number(blockRow.b) : null;
    for (const c of picked) {
      try {
        const { data } = await blockbook<{ balance: string; txs: number; tokens?: { contract: string; balance?: string; decimals?: number }[] }>(
          bb, `/address/${c.address}?details=tokenBalances`, `${chain}:/address/{wallet}:investigation`, { wallet: c.address, coin: coingecko_id });
        const tok = data.tokens?.find((t) => t.contract?.toLowerCase() === contract.address);
        const nowBal = tok?.balance ? fromUnits(BigInt(tok.balance), tok.decimals ?? contract.decimals) : 0;
        let beforeBal: number | null = null;
        if (chain === "eth" && startBlock) {
          try {
            const { data: hex } = await rpc<string>("eth-archive", "eth_call", [{ to: contract.address, data: `0x70a08231000000000000000000000000${c.address.slice(2)}` }, toHex(startBlock)],
              { logical: "eth-archive:eth_call:balanceOf", params: { wallet: c.address, block: startBlock, coin: coingecko_id } });
            beforeBal = fromUnits(BigInt(hex === "0x" ? "0x0" : hex), contract.decimals);
          } catch (err) {
            console.warn(`[evidence] archive balance ${c.address}: ${(err as Error).message.slice(0, 100)}`);
          }
        }
        const native = Number(BigInt(data.balance ?? "0")) / 1e18;
        const profile = data.txs < 50 ? "new or rarely used wallet" : data.txs > 100_000 ? "very active (exchange, contract or bot)" : "established wallet";
        add(`nownodes:${bb}:/address/{wallet}`, "wallet_profile", `${c.role} ${c.address.slice(0, 10)}… (${usd(c.usd)} transfer): ${profile}, ${data.txs.toLocaleString()} transactions, holds ${Intl.NumberFormat("en", { notation: "compact" }).format(nowBal)} ${sym} now${beforeBal !== null ? ` vs ${Intl.NumberFormat("en", { notation: "compact" }).format(beforeBal)} at the start of the window (${signed(pct(nowBal, beforeBal))})` : ""}, ${native.toFixed(2)} ${chain === "eth" ? "ETH" : "BNB"}`,
          { address: c.address, role: c.role, transfer_usd: c.usd, tx_count: data.txs, native_balance: native, token_balance_now: nowBal, token_balance_window_start: beforeBal, window_start_block: startBlock, profile });
      } catch (err) {
        console.warn(`[evidence] wallet ${c.address}: ${(err as Error).message.slice(0, 100)}`);
      }
    }
  }

  // Bitcoin: profile the untagged wallets behind the biggest transfers via Blockbook.
  if (coingecko_id === "bitcoin") {
    const seen = new Set<string>();
    const picked: { address: string; role: string; usd: number }[] = [];
    for (const t of transfers) {
      if (t.chain !== "btc") continue;
      for (const [addr, role, entity] of [[t.from_address, "sender", t.from_entity], [t.to_address, "receiver", t.to_entity]] as const) {
        if (addr && !entity && !seen.has(addr) && picked.length < 3) {
          seen.add(addr);
          picked.push({ address: addr, role, usd: Number(t.amount_usd) });
        }
      }
    }
    for (const c of picked) {
      try {
        const { data } = await blockbook<{ balance: string; txs: number; totalReceived?: string; totalSent?: string }>(
          "btcbook", `/address/${c.address}?details=basic`, "btc:/address/{wallet}:investigation", { wallet: c.address, coin: coingecko_id });
        const bal = Number(data.balance ?? 0) / 1e8, received = Number(data.totalReceived ?? 0) / 1e8;
        const profile = data.txs < 5 ? "new or rarely used address" : data.txs > 10_000 ? "very active (exchange or service)" : "established address";
        add("nownodes:btcbook:/address/{wallet}", "wallet_profile", `${c.role} ${c.address.slice(0, 12)}… (${usd(c.usd)} transfer): ${profile}, ${data.txs.toLocaleString()} transactions, holds ${bal.toLocaleString("en", { maximumFractionDigits: 2 })} BTC now (${received.toLocaleString("en", { maximumFractionDigits: 0 })} BTC received over its lifetime)`,
          { address: c.address, role: c.role, transfer_usd: c.usd, tx_count: data.txs, balance_btc: bal, total_received_btc: received, profile });
      } catch (err) {
        console.warn(`[evidence] btc wallet ${c.address}: ${(err as Error).message.slice(0, 100)}`);
      }
    }
  }

  // --- Chain context ---------------------------------------------------------------------------------
  const [fee] = await sql`
    select chain, base_fee_gwei, priority_fee_p50_gwei, gas_used_ratio, captured_at,
           (select avg(base_fee_gwei) from chain_fee_snapshots f2 where f2.chain = f.chain and f2.captured_at > now() - interval '24 hours') as avg_base_24h
    from chain_fee_snapshots f where chain = ${contract?.chain ?? "eth"} order by captured_at desc limit 1`;
  if (fee) add(`nownodes:${fee.chain}:eth_feeHistory`, "network_fees", `${String(fee.chain).toUpperCase()} base fee ${n(fee.base_fee_gwei)?.toFixed(2)} gwei (24h average ${n(fee.avg_base_24h)?.toFixed(2)}), blocks ${Math.round(Number(fee.gas_used_ratio) * 100)}% full`,
    { chain: fee.chain, base_fee_gwei: n(fee.base_fee_gwei), avg_base_fee_24h_gwei: n(fee.avg_base_24h), priority_fee_p50_gwei: n(fee.priority_fee_p50_gwei), gas_used_ratio: n(fee.gas_used_ratio), as_of: fee.captured_at });

  // --- Market context --------------------------------------------------------------------------------
  const ctx = await sql`
    select coingecko_id, (select current_price from market_snapshots m where m.coingecko_id = x.coingecko_id order by captured_at desc limit 1) as p_now,
           (select current_price from market_snapshots m where m.coingecko_id = x.coingecko_id and captured_at <= ${windowFrom} order by captured_at desc limit 1) as p_from,
           (select price_change_percentage_24h from market_snapshots m where m.coingecko_id = x.coingecko_id order by captured_at desc limit 1) as ch24h
    from (values ('bitcoin'), ('ethereum')) x(coingecko_id)`;
  const [glob] = await sql`select market_cap_change_percentage_24h_usd as mc24h, captured_at from global_snapshots order by captured_at desc limit 1`;
  const trending = await sql`select max(captured_at) as at from trending_snapshots where coingecko_id = ${coingecko_id} and captured_at > now() - interval '2 hours'`;
  add("coingecko:/coins/markets+/global", "market_context", `Market: BTC ${signed(pct(n(ctx[0]?.p_now), n(ctx[0]?.p_from)))} and ETH ${signed(pct(n(ctx[1]?.p_now), n(ctx[1]?.p_from)))} over the same window; total crypto market cap ${signed(n(glob?.mc24h) !== null ? Math.round(Number(glob.mc24h) * 100) / 100 : null)} in 24h${trending[0]?.at ? `; ${sym} is in CoinGecko's trending searches` : ""}; categories: ${(token.categories as string[] | null)?.slice(0, 4).join(", ") ?? "n/a"}`,
    { btc_window_return_pct: pct(n(ctx[0]?.p_now), n(ctx[0]?.p_from)), eth_window_return_pct: pct(n(ctx[1]?.p_now), n(ctx[1]?.p_from)), btc_change_24h_pct: n(ctx[0]?.ch24h), global_market_cap_change_24h_pct: n(glob?.mc24h), trending: Boolean(trending[0]?.at), categories: token.categories });

  // --- News, market mood, fundamentals -------------------------------------------------------------------
  const news = await sql`
    select source, title, url, published_at from news_items where ${coingecko_id} = any(coins) and published_at > ${windowFrom} - interval '24 hours'
    order by published_at desc limit 8`;
  if (news.length) {
    add("rss:coindesk+cointelegraph+decrypt+theblock", "news", `${news.length} headlines mentioning ${sym} in the last day: ${news.slice(0, 4).map((h) => `"${h.title}" (${h.source}, ${new Date(h.published_at).toISOString().slice(5, 16).replace("T", " ")})`).join("; ")}`,
      { headlines: news.map((h) => ({ source: h.source, title: h.title, url: h.url, published_at: h.published_at })) });
  }
  const [fng] = await sql`select day, value, classification, (select value from market_sentiment_snapshots s2 where s2.day <= s.day - 7 order by day desc limit 1) as week_ago from market_sentiment_snapshots s order by day desc limit 1`;
  if (fng) add("alternative.me:/fng", "market_mood", `Crypto Fear & Greed index ${fng.value} (${fng.classification}) today${fng.week_ago !== null ? `, ${fng.week_ago} a week ago` : ""}`,
    { value: fng.value, classification: fng.classification, week_ago: fng.week_ago, day: fng.day });
  const tvl = await sql`
    select protocol, name, category, tvl_usd, change_1d_pct, change_7d_pct from protocol_tvl_snapshots
    where coingecko_id = ${coingecko_id} and captured_at = (select max(captured_at) from protocol_tvl_snapshots where coingecko_id = ${coingecko_id})
    order by tvl_usd desc limit 4`;
  if (tvl.length) add("defillama:/protocols", "protocol_tvl", `Protocol TVL (DefiLlama): ${tvl.map((t) => `${t.name} ${usd(n(t.tvl_usd))} (${signed(n(t.change_1d_pct) !== null ? Math.round(Number(t.change_1d_pct) * 100) / 100 : null)} 1d, ${signed(n(t.change_7d_pct) !== null ? Math.round(Number(t.change_7d_pct) * 100) / 100 : null)} 7d)`).join("; ")}`,
    { protocols: tvl.map((t) => ({ protocol: t.protocol, name: t.name, category: t.category, tvl_usd: n(t.tvl_usd), change_1d_pct: n(t.change_1d_pct), change_7d_pct: n(t.change_7d_pct) })) });
  const [detail] = await sql`
    select captured_at, developer_data, community_data, sentiment_votes_up_percentage, sentiment_votes_down_percentage from coin_detail_snapshots
    where coingecko_id = ${coingecko_id} order by captured_at desc limit 1`;
  if (detail) {
    const dev = (detail.developer_data ?? {}) as Record<string, unknown>;
    const com = (detail.community_data ?? {}) as Record<string, unknown>;
    const parts = [
      dev.commit_count_4_weeks != null ? `developer activity (4 weeks): ${dev.commit_count_4_weeks} commits, ${dev.pull_requests_merged ?? 0} PRs merged, ${dev.stars ?? 0} stars` : "developer activity: not tracked by CoinGecko for this coin",
      com.twitter_followers != null || com.reddit_subscribers != null ? `community: ${com.twitter_followers ?? "n/a"} X followers, ${com.reddit_subscribers ?? "n/a"} Reddit subscribers` : null,
      n(detail.sentiment_votes_up_percentage) !== null ? `CoinGecko sentiment ${n(detail.sentiment_votes_up_percentage)?.toFixed(0)}% positive` : null,
    ].filter(Boolean);
    add("coingecko:/coins/{id}", "dev_and_community", `${parts.join("; ")} (as of ${new Date(detail.captured_at).toISOString().slice(0, 10)})`,
      { commits_4w: dev.commit_count_4_weeks ?? null, prs_merged: dev.pull_requests_merged ?? null, stars: dev.stars ?? null, forks: dev.forks ?? null, twitter_followers: com.twitter_followers ?? null, reddit_subscribers: com.reddit_subscribers ?? null, sentiment_up_pct: n(detail.sentiment_votes_up_percentage), as_of: detail.captured_at });
  }

  // --- Triggering signals ----------------------------------------------------------------------------
  if (triggerSignalIds.length) {
    const sigs = await sql`select id, kind, direction, severity, value, baseline, ratio, event_ts, details from signals where id = any(${triggerSignalIds}) order by severity desc`;
    add("coingraph:signals", "signals", `Triggered by: ${sigs.map((s) => `${s.kind} (${s.direction}, ${s.severity === 3 ? "high" : "medium"}) at ${new Date(s.event_ts).toISOString().slice(11, 16)}`).join("; ")}`,
      { signals: sigs.map((s) => ({ id: s.id, kind: s.kind, direction: s.direction, severity: s.severity, value: n(s.value), baseline: n(s.baseline), ratio: n(s.ratio), event_ts: s.event_ts, details: s.details })) });
  }

  return { coingecko_id, symbol: sym, name: token.name, window_from: windowFrom.toISOString(), window_to: windowTo.toISOString(), gathered_at: new Date().toISOString(), items };
}
