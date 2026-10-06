import WebSocket from "ws";
import { sql, insertChunked } from "../db";
import { env } from "../env";
import { recordRowCount, withApiLog, withDeadline } from "../http";
import { cg, int, num, ts } from "../coingecko/client";
import { exchange, type Venue } from "../ccxt/exchanges";
import * as cx from "../ccxt/jobs";

// Additional market data on top of the core CoinGecko + CCXT feeds:
// liquidations, OKX/Bybit long-short + open-interest history, demo-coin DEX pools and order books,
// scheduled exchange tickers, exchange status and public treasuries.

const minuteNow = () => {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d;
};
const json = (v: unknown) => (v === undefined || v === null ? null : sql.json(v as never));

type Swap = { coingecko_id: string; venue: Venue; symbol: string; market_id: string };

async function swaps(venue: Venue): Promise<Swap[]> {
  return sql<Swap[]>`
    select m.coingecko_id, m.venue, m.symbol, m.market_id from symbol_map m join tokens t using (coingecko_id)
    where m.venue = ${venue} and m.market_type = 'swap' and m.price_check_ok and t.in_universe order by t.market_cap_rank`;
}

async function each<T>(items: T[], label: string, fn: (item: T) => Promise<void>) {
  const errors: string[] = [];
  for (const item of items) {
    try {
      await withDeadline(fn(item), 25_000, label);
    } catch (err) {
      errors.push((err as Error).message.slice(0, 120));
    }
  }
  if (errors.length) console.warn(`[${label}] ${errors.length} errors: ${errors.slice(0, 3).join(" | ")}`);
}

// ---------------------------------------------------------------------------
// Demo tokens (env DEMO_TOKENS) — flagged on tokens so every job can find them.
// ---------------------------------------------------------------------------
export async function markDemoTokens(): Promise<number> {
  const result = await sql`update tokens set is_demo = (coingecko_id = any(${env.demoTokens})) where is_demo <> (coingecko_id = any(${env.demoTokens}))`;
  return result.count;
}

// ---------------------------------------------------------------------------
// Liquidations
// ---------------------------------------------------------------------------
// OKX REST: last 100 filled liquidations per contract family. Polled every 5 min; duplicates skipped.
export async function syncOkxLiquidations(): Promise<number> {
  const list = await swaps("okx");
  const contractSize = new Map<string, number>();
  const ex = exchange("okx");
  await ex.loadMarkets();
  for (const s of list) contractSize.set(s.market_id, Number(ex.markets?.[s.symbol]?.contractSize ?? 1));

  const rows: Record<string, unknown>[] = [];
  const { apiCallId } = await withApiLog("okx", "/api/v5/public/liquidation-orders", { swaps: list.length }, async () => {
    const raws: Record<string, unknown> = {};
    await each(list, "okx:liquidations", async (s) => {
      const family = s.market_id.replace(/-SWAP$/, "");
      const res = await fetch(`https://www.okx.com/api/v5/public/liquidation-orders?instType=SWAP&instFamily=${family}&state=filled`, {
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json()) as { code: string; msg: string; data?: { instId?: string; details?: Record<string, string>[] }[] };
      if (body.code !== "0") throw new Error(`${family}: ${body.msg}`);
      raws[family] = body.data;
      for (const group of body.data ?? []) {
        const instId = group.instId ?? s.market_id;
        if (instId !== s.market_id) continue; // keep the USDT-margined perp we map
        for (const d of group.details ?? []) {
          const qty = Number(d.sz) * (contractSize.get(instId) ?? 1);
          const px = num(d.bkPx);
          rows.push({
            venue: "okx",
            symbol: instId,
            coingecko_id: s.coingecko_id,
            side: d.side ?? null,
            position_side: d.posSide ?? null,
            order_type: null,
            time_in_force: null,
            status: "filled",
            price: px,
            avg_price: px,
            quantity: qty,
            filled_qty: qty,
            notional_usd: px === null ? null : px * qty,
            event_ts: ts(Number(d.ts)),
            info: sql.json(d as never),
          });
        }
      }
    });
    return raws;
  });
  const n = await insertChunked("liquidations", rows, "on conflict (venue, symbol, event_ts, side, quantity) do nothing");
  await recordRowCount(apiCallId, n);
  return n;
}

// Binance live stream (!forceOrder@arr). Starts with the worker, reconnects on drop,
// and warns if no messages arrive (some networks filter WebSocket data).
export function startBinanceLiquidationStream(): void {
  let received = 0;
  let symbolMap = new Map<string, string>();
  const refreshMap = async () => {
    const rows = await sql<{ market_id: string; coingecko_id: string }[]>`
      select market_id, coingecko_id from symbol_map where venue = 'binanceusdm' and price_check_ok`;
    symbolMap = new Map(rows.map((r) => [r.market_id, r.coingecko_id]));
  };

  const connect = () => {
    const ws = new WebSocket("wss://fstream.binance.com/ws/!forceOrder@arr");
    ws.on("open", () => console.log("[liquidations:binance] stream connected"));
    ws.on("message", async (msg) => {
      received++;
      try {
        const o = JSON.parse(String(msg)).o as Record<string, string | number>;
        const avg = num(o.ap) ?? num(o.p);
        const qty = num(o.z) ?? num(o.q);
        await sql`insert into liquidations ${sql({
          venue: "binanceusdm",
          symbol: String(o.s),
          coingecko_id: symbolMap.get(String(o.s)) ?? null,
          side: o.S ?? null,
          position_side: o.S === "SELL" ? "long" : o.S === "BUY" ? "short" : null,
          order_type: o.o ?? null,
          time_in_force: o.f ?? null,
          status: o.X ?? null,
          price: num(o.p),
          avg_price: num(o.ap),
          quantity: num(o.q),
          filled_qty: num(o.z),
          notional_usd: avg !== null && qty !== null ? avg * qty : null,
          event_ts: ts(Number(o.T)),
          info: sql.json(o as never),
        } as never)} on conflict (venue, symbol, event_ts, side, quantity) do nothing`;
      } catch (err) {
        console.warn("[liquidations:binance] insert failed:", (err as Error).message.slice(0, 120));
      }
    });
    ws.on("close", () => setTimeout(connect, 5_000));
    ws.on("error", (err) => console.warn("[liquidations:binance] stream error:", err.message));
  };

  void refreshMap().then(connect);
  setInterval(() => void refreshMap(), 3_600_000);
  setInterval(() => {
    if (received === 0) console.warn("[liquidations:binance] no messages in the last 10 min — WebSocket data may be blocked on this network");
    received = 0;
  }, 600_000);
}

// ---------------------------------------------------------------------------
// OKX + Bybit long/short ratio history (Binance has its own richer job)
// ---------------------------------------------------------------------------
export async function syncOkxBybitLongShort(limit = 6, since?: number): Promise<number> {
  let total = 0;
  for (const venue of ["okx", "bybit"] as const) {
    const list = await swaps(venue);
    const rows: Record<string, unknown>[] = [];
    const { apiCallId } = await withApiLog(`ccxt:${venue}`, "longShortRatio:5m", { symbols: list.length, limit }, async () => {
      const raws: Record<string, unknown> = {};
      await each(list, `${venue}:long-short`, async (s) => {
        if (venue === "okx") {
          const hist = await exchange("okx").fetchLongShortRatioHistory(s.symbol, "5m", since, limit);
          raws[s.symbol] = hist.map((h) => h.info);
          for (const h of hist) {
            rows.push({
              venue, symbol: s.symbol, coingecko_id: s.coingecko_id, period: "5m", ts: ts(h.timestamp),
              global_long_short_ratio: num(h.longShortRatio), info: sql.json({ global: h.info } as never), updated_at: new Date(),
            });
          }
        } else {
          const by = exchange("bybit") as unknown as Record<string, (p: object) => Promise<{ result?: { list?: Record<string, string>[] } }>>;
          const res = await by.publicGetV5MarketAccountRatio({
            category: "linear", symbol: s.market_id, period: "5min", limit: String(limit), ...(since ? { startTime: String(since) } : {}),
          });
          const list2 = res.result?.list ?? [];
          raws[s.symbol] = list2;
          for (const r of list2) {
            const buy = num(r.buyRatio), sell = num(r.sellRatio);
            rows.push({
              venue, symbol: s.symbol, coingecko_id: s.coingecko_id, period: "5m", ts: ts(Number(r.timestamp)),
              global_long_short_ratio: buy !== null && sell ? buy / sell : null,
              global_long_account: buy, global_short_account: sell,
              info: sql.json({ global: r } as never), updated_at: new Date(),
            });
          }
        }
      });
      return raws;
    });
    const n = await insertChunked(
      "futures_sentiment_snapshots",
      rows,
      `on conflict (venue, symbol, period, ts) do update set
        global_long_short_ratio = excluded.global_long_short_ratio,
        global_long_account = coalesce(excluded.global_long_account, futures_sentiment_snapshots.global_long_account),
        global_short_account = coalesce(excluded.global_short_account, futures_sentiment_snapshots.global_short_account),
        info = futures_sentiment_snapshots.info || excluded.info, updated_at = excluded.updated_at`,
    );
    await recordRowCount(apiCallId, n);
    total += n;
  }
  return total;
}

// ---------------------------------------------------------------------------
// OKX + Bybit open-interest history (5m). Amounts in base coins; OKX also gives USD value.
// ---------------------------------------------------------------------------
export async function syncOkxBybitOpenInterest(limit = 6, since?: number): Promise<number> {
  const capturedAt = minuteNow();
  let total = 0;
  for (const venue of ["okx", "bybit"] as const) {
    const list = await swaps(venue);
    const rows: Record<string, unknown>[] = [];
    const { apiCallId } = await withApiLog(`ccxt:${venue}`, "openInterestHistory:5m", { symbols: list.length, limit }, async () => {
      const raws: Record<string, unknown> = {};
      await each(list, `${venue}:open-interest`, async (s) => {
        const hist = await exchange(venue).fetchOpenInterestHistory(s.symbol, "5m", since, limit);
        raws[s.symbol] = hist.map((h) => h.info);
        for (const h of hist) {
          rows.push({
            captured_at: capturedAt, venue, symbol: s.symbol, coingecko_id: s.coingecko_id,
            // OKX: openInterestAmount is contracts; baseVolume carries the base-coin amount (oiCcy).
            exchange_ts: ts(h.timestamp), open_interest_amount: venue === "okx" ? num(h.baseVolume) : num(h.openInterestAmount),
            open_interest_value: num(h.openInterestValue), info: json(h.info),
          });
        }
      });
      return raws;
    });
    const n = await insertChunked("open_interest_snapshots", rows.map((r) => ({ ...r, api_call_id: apiCallId })), "on conflict (venue, symbol, exchange_ts) do nothing");
    await recordRowCount(apiCallId, n);
    total += n;
  }
  return total;
}

export async function backfillOkxBybit(days = 2): Promise<number> {
  let total = 0;
  for (let since = Date.now() - days * 86_400_000; since < Date.now() - 300_000; since += 100 * 300_000) {
    total += await syncOkxBybitOpenInterest(100, since);
    total += await syncOkxBybitLongShort(100, since);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Order books for demo coins on their primary spot + perp venues
// ---------------------------------------------------------------------------
export async function syncDemoOrderBooks(): Promise<number> {
  const targets = await sql<{ coingecko_id: string; venue: Venue; symbol: string }[]>`
    select m.coingecko_id, m.venue, m.symbol from symbol_map m join tokens t using (coingecko_id)
    where t.is_demo and m.is_primary and m.price_check_ok`;
  let n = 0;
  await each(targets, "order-books", async (s) => {
    const { data: book, apiCallId } = await withApiLog(`ccxt:${s.venue}`, "fetchOrderBook", { symbol: s.symbol, limit: 100, scheduled: true }, () =>
      exchange(s.venue).fetchOrderBook(s.symbol, ["okx", "coinbase", "kraken"].includes(s.venue) ? undefined : 100),
    );
    const bestBid = Number(book.bids[0]?.[0] ?? NaN);
    const bestAsk = Number(book.asks[0]?.[0] ?? NaN);
    const mid = (bestBid + bestAsk) / 2;
    const depth = (levels: [number, number][], within: (p: number) => boolean) =>
      levels.filter(([p]) => within(Number(p))).reduce((sum, [p, q]) => sum + Number(p) * Number(q), 0);
    await sql`insert into order_book_snapshots ${sql({
      investigation_id: null, captured_at: minuteNow(), api_call_id: apiCallId, venue: s.venue, symbol: s.symbol,
      coingecko_id: s.coingecko_id, exchange_ts: ts(book.timestamp), nonce: book.nonce ?? null,
      bids: sql.json(book.bids as never), asks: sql.json(book.asks as never),
      best_bid: num(bestBid), best_ask: num(bestAsk),
      spread_pct: Number.isFinite(mid) ? ((bestAsk - bestBid) / mid) * 100 : null,
      depth_bid_2pct_usd: depth(book.bids as [number, number][], (p) => p >= mid * 0.98),
      depth_ask_2pct_usd: depth(book.asks as [number, number][], (p) => p <= mid * 1.02),
    } as never)}`;
    await recordRowCount(apiCallId, 1);
    n++;
  });
  return n;
}

// ---------------------------------------------------------------------------
// Exchange status (maintenance) — venues whose API exposes it
// ---------------------------------------------------------------------------
export async function syncExchangeStatus(): Promise<number> {
  const venues: Venue[] = ["binance", "binanceusdm", "okx", "bybit", "kraken"];
  const capturedAt = minuteNow();
  let n = 0;
  await each(venues, "exchange-status", async (venue) => {
    const { data, apiCallId } = await withApiLog(`ccxt:${venue}`, "fetchStatus", null, () => exchange(venue).fetchStatus());
    await sql`insert into exchange_status ${sql({
      captured_at: capturedAt, api_call_id: apiCallId, venue, status: data.status ?? null,
      updated: ts(data.updated), eta: ts(data.eta), url: data.url ?? null, info: json(data.info),
    } as never)}`;
    n++;
  });
  return n;
}

// ---------------------------------------------------------------------------
// CoinGecko: DEX pools for demo coins (every 15 min) and for investigations
// ---------------------------------------------------------------------------
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

async function onchainTargets(ids?: string[]) {
  return sql<{ coingecko_id: string; network: string; address: string }[]>`
    select t.coingecko_id,
           coalesce(n.id, 'eth') as network,
           case when t.coingecko_id = 'ethereum' then ${WETH} else lower(t.contract_address) end as address
    from tokens t
    left join onchain_networks n on n.coingecko_asset_platform_id = coalesce(t.asset_platform_id, 'ethereum')
    where ${ids ? sql`t.coingecko_id = any(${ids})` : sql`t.is_demo`}
      and (t.coingecko_id = 'ethereum' or (t.contract_address is not null and t.contract_address <> ''))`;
}

type PoolResponse = { data: { attributes: Record<string, unknown>; relationships: Record<string, { data?: { id?: string } }> }[] };

export async function syncDexPools(ids?: string[], investigationId: number | null = null): Promise<number> {
  const targets = await onchainTargets(ids);
  let total = 0;
  await each(targets, "dex-pools", async (t) => {
    const { data, apiCallId } = await cg<PoolResponse>(`/onchain/networks/${t.network}/tokens/${t.address}/pools`, {}, "/onchain/networks/{network}/tokens/{address}/pools");
    const capturedAt = minuteNow();
    const rows = data.data.map((p) => {
      const a = p.attributes as Record<string, any>;
      const tx = (a.transactions ?? {}) as Record<string, { buys?: number; sells?: number; buyers?: number; sellers?: number }>;
      const vol = (a.volume_usd ?? {}) as Record<string, string>;
      return {
        captured_at: capturedAt, api_call_id: apiCallId, investigation_id: investigationId, coingecko_id: t.coingecko_id,
        network: t.network, token_address: t.address, pool_address: a.address, name: a.name ?? null,
        dex_id: p.relationships?.dex?.data?.id ?? null,
        base_token_id: p.relationships?.base_token?.data?.id ?? null,
        quote_token_id: p.relationships?.quote_token?.data?.id ?? null,
        pool_created_at: ts(a.pool_created_at),
        base_token_price_usd: num(a.base_token_price_usd), base_token_price_native_currency: num(a.base_token_price_native_currency),
        quote_token_price_usd: num(a.quote_token_price_usd), quote_token_price_native_currency: num(a.quote_token_price_native_currency),
        base_token_price_quote_token: num(a.base_token_price_quote_token), quote_token_price_base_token: num(a.quote_token_price_base_token),
        token_price_usd: num(a.token_price_usd), fdv_usd: num(a.fdv_usd), market_cap_usd: num(a.market_cap_usd), reserve_in_usd: num(a.reserve_in_usd),
        price_change_percentage: json(a.price_change_percentage), volume_usd: json(a.volume_usd), transactions: json(a.transactions),
        volume_usd_m15: num(vol.m15), volume_usd_h1: num(vol.h1), volume_usd_h24: num(vol.h24),
        buys_m15: int(tx.m15?.buys), sells_m15: int(tx.m15?.sells),
        buys_h1: int(tx.h1?.buys), sells_h1: int(tx.h1?.sells), buyers_h1: int(tx.h1?.buyers), sellers_h1: int(tx.h1?.sellers),
        attributes: json(a), relationships: json(p.relationships),
      };
    });
    const n = await insertChunked("dex_pool_snapshots", rows);
    await recordRowCount(apiCallId, n);
    total += n;
  });
  return total;
}

// ---------------------------------------------------------------------------
// CoinGecko: tickers across 100+ exchanges (daily for the universe; also per investigation)
// ---------------------------------------------------------------------------
type TickersResponse = { tickers: Record<string, any>[] };

export async function syncExchangeTickers(ids?: string[], investigationId: number | null = null): Promise<number> {
  const targets = ids ?? (await sql<{ coingecko_id: string }[]>`select coingecko_id from tokens where in_universe order by market_cap_rank`).map((r) => r.coingecko_id);
  let total = 0;
  await each(targets, "exchange-tickers", async (id) => {
    const { data, apiCallId } = await cg<TickersResponse>(`/coins/${id}/tickers`, { order: "volume_desc", depth: true }, "/coins/{id}/tickers");
    const capturedAt = new Date();
    const rows = data.tickers.map((t) => ({
      captured_at: capturedAt, api_call_id: apiCallId, investigation_id: investigationId, coingecko_id: id,
      base: t.base ?? null, target: t.target ?? null,
      market_name: t.market?.name ?? null, market_identifier: t.market?.identifier ?? null,
      has_trading_incentive: t.market?.has_trading_incentive ?? null,
      last: num(t.last), volume: num(t.volume),
      converted_last: json(t.converted_last), converted_volume: json(t.converted_volume), converted_volume_usd: num(t.converted_volume?.usd),
      cost_to_move_up_usd: num(t.cost_to_move_up_usd), cost_to_move_down_usd: num(t.cost_to_move_down_usd),
      trust_score: t.trust_score ?? null, bid_ask_spread_percentage: num(t.bid_ask_spread_percentage),
      ticker_ts: ts(t.timestamp), last_traded_at: ts(t.last_traded_at), last_fetch_at: ts(t.last_fetch_at),
      is_anomaly: t.is_anomaly ?? null, is_stale: t.is_stale ?? null,
      trade_url: t.trade_url ?? null, token_info_url: t.token_info_url ?? null,
      coin_id: t.coin_id ?? null, target_coin_id: t.target_coin_id ?? null, coin_mcap_usd: num(t.coin_mcap_usd),
    }));
    const n = await insertChunked("exchange_tickers", rows);
    await recordRowCount(apiCallId, n);
    total += n;
  });
  return total;
}

// ---------------------------------------------------------------------------
// CoinGecko: public treasuries (companies + governments) for the main treasury coins
// ---------------------------------------------------------------------------
const TREASURY_COINS = ["bitcoin", "ethereum", "solana"];

export async function syncPublicTreasuries(): Promise<number> {
  let n = 0;
  for (const entity of ["companies", "governments"] as const) {
    for (const coin of TREASURY_COINS) {
      try {
        const { data, apiCallId } = await cg<Record<string, any>>(`/${entity}/public_treasury/${coin}`, {}, "/{entity}/public_treasury/{coin_id}");
        const holders = (data.companies ?? data.governments ?? []) as unknown[];
        await sql`insert into public_treasury_snapshots ${sql({
          captured_at: new Date(), api_call_id: apiCallId, entity_type: entity, coingecko_id: coin,
          total_holdings: num(data.total_holdings), total_value_usd: num(data.total_value_usd),
          market_cap_dominance: num(data.market_cap_dominance), holders_count: holders.length, holders: sql.json(holders as never),
        } as never)}`;
        await recordRowCount(apiCallId, 1);
        n++;
      } catch (err) {
        console.warn(`[treasury] ${entity}/${coin}: ${(err as Error).message.slice(0, 120)}`);
      }
    }
  }
  return n;
}


// Hourly repair: after an outage longer than the 5-minute jobs' 30-minute look-back, re-fetch open
// interest and positioning history for any venue with missing 5-minute periods in the last 6 hours.
export async function repairFuturesGaps(): Promise<number> {
  const gaps = await sql<{ venue: string; missing: number }[]>`
    with b as (select generate_series(date_bin('5 minutes', now() - interval '6 hours', 'epoch'), now() - interval '15 minutes', interval '5 minutes') as b)
    select m.venue,
      (count(*) filter (where not exists (select 1 from open_interest_snapshots o where o.venue = m.venue and o.symbol = m.symbol and o.exchange_ts = b.b))
     + count(*) filter (where not exists (select 1 from futures_sentiment_snapshots s where s.venue = m.venue and s.symbol = m.symbol and s.ts = b.b)))::int as missing
    from symbol_map m cross join b
    where m.market_type = 'swap' and m.price_check_ok and m.venue in ('binanceusdm', 'okx', 'bybit')
    group by m.venue`;
  // Ignore isolated misses (a symbol briefly delisted, an exchange skipping one bucket).
  const needs = new Set(gaps.filter((g) => g.missing > 10).map((g) => g.venue));
  if (!needs.size) return 0;
  console.log(`[futures-repair] gaps: ${gaps.map((g) => `${g.venue}=${g.missing}`).join(", ")}`);
  const since = Date.now() - 6 * 3_600_000;
  let total = 0;
  if (needs.has("binanceusdm")) {
    total += await cx.syncOpenInterest(100, since);
    total += await cx.syncFuturesSentiment(100, since);
  }
  if (needs.has("okx") || needs.has("bybit")) {
    total += await syncOkxBybitOpenInterest(100, since);
    total += await syncOkxBybitLongShort(100, since);
  }
  return total;
}
