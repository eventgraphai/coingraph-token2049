import type { Market as CcxtMarket, Ticker } from "ccxt";

type Market = NonNullable<CcxtMarket>;
import { sql, insertChunked } from "../db";
import { recordRowCount, withApiLog, withDeadline } from "../http";
import { int, num, ts } from "../coingecko/client";
import { exchange, fetchTickersFor, VENUES, type MarketType, type Venue } from "./exchanges";

const PRICE_TOLERANCE = 0.02;
const minuteNow = () => {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d;
};
const json = (v: unknown) => (v === undefined || v === null ? null : sql.json(v as never));

type MappedSymbol = {
  coingecko_id: string;
  venue: Venue;
  market_type: MarketType;
  symbol: string;
  market_id: string;
  is_primary: boolean;
};

async function mapped(filter: { venue?: Venue; type?: MarketType; primaryOnly?: boolean } = {}): Promise<MappedSymbol[]> {
  return sql<MappedSymbol[]>`
    select m.coingecko_id, m.venue, m.market_type, m.symbol, m.market_id, m.is_primary
    from symbol_map m join tokens t using (coingecko_id)
    where m.price_check_ok and t.in_universe
      ${filter.venue ? sql`and m.venue = ${filter.venue}` : sql``}
      ${filter.type ? sql`and m.market_type = ${filter.type}` : sql``}
      ${filter.primaryOnly ? sql`and m.is_primary` : sql``}
    order by t.market_cap_rank`;
}

// Run per-symbol calls sequentially (CCXT's rate limiter paces them); a failing symbol doesn't stop the batch.
async function eachSymbol<T>(items: T[], fn: (item: T) => Promise<void>): Promise<string[]> {
  const errors: string[] = [];
  for (const item of items) {
    try {
      await withDeadline(fn(item), 25_000, "symbol call");
    } catch (err) {
      errors.push(`${JSON.stringify(item).slice(0, 80)}: ${(err as Error).message.slice(0, 120)}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Daily: load markets, store them, and map universe tokens to exchange symbols (price-checked)
// ---------------------------------------------------------------------------
export async function syncMarketsAndSymbolMap(): Promise<number> {
  const tokens = await sql<{ coingecko_id: string; symbol: string; price: string }[]>`
    select t.coingecko_id, upper(t.symbol) as symbol, s.current_price as price
    from tokens t
    join lateral (
      select current_price from market_snapshots m where m.coingecko_id = t.coingecko_id order by captured_at desc limit 1
    ) s on true
    where t.in_universe and not t.is_stablecoin and s.current_price > 0`;

  const rows: Record<string, unknown>[] = [];
  const loaded = new Set<Venue>();

  for (const { venue, type, quotes } of VENUES) {
    const ex = exchange(venue);
    const { data: markets, apiCallId } = await withApiLog(`ccxt:${venue}`, "loadMarkets", null, async () => {
      await ex.loadMarkets(true);
      return (ex.markets ?? {}) as Record<string, Market>;
    });
    if (!loaded.has(venue)) {
      loaded.add(venue);
      const n = await insertChunked(
        "exchange_markets",
        Object.values(markets).map((m) => marketRow(venue, m)),
        `on conflict (venue, symbol) do update set
          market_id = excluded.market_id, base = excluded.base, quote = excluded.quote, settle = excluded.settle,
          type = excluded.type, active = excluded.active, contract_size = excluded.contract_size,
          expiry = excluded.expiry, taker = excluded.taker, maker = excluded.maker, precision = excluded.precision,
          limits = excluded.limits, info = excluded.info, updated_at = excluded.updated_at`,
        300,
      );
      await recordRowCount(apiCallId, n);
    }

    const { data: tickers } = await withApiLog(`ccxt:${venue}`, `fetchTickers:${type}`, { purpose: "symbol price check" }, () =>
      fetchTickersFor(venue, type),
    );
    const candidates = Object.values(markets).filter(
      (m): m is Market => !!m && m.type === type && m.active !== false && quotes.includes(m.quote) && (type === "spot" || !!m.linear),
    );

    for (const t of tokens) {
      const bases: [string, number][] = [[t.symbol, 1], [`1000${t.symbol}`, 1000], [`1000000${t.symbol}`, 1_000_000]];
      let best: Record<string, unknown> | null = null;
      for (const quote of quotes) {
        for (const [base, multiplier] of bases) {
          const m = candidates.find((c) => c.base === base && c.quote === quote);
          const last = m ? tickers[m.symbol]?.last : undefined;
          if (!m || !last) continue;
          const deviation = Math.abs(last / multiplier / Number(t.price) - 1);
          const row = {
            coingecko_id: t.coingecko_id,
            venue,
            market_type: type,
            symbol: m.symbol,
            market_id: m.id,
            base: m.base,
            quote: m.quote,
            price_multiplier: multiplier,
            exchange_price: last,
            coingecko_price: Number(t.price),
            price_deviation: deviation,
            price_check_ok: deviation <= PRICE_TOLERANCE,
            is_primary: false,
            verified_at: new Date(),
          };
          if (row.price_check_ok) { best = row; break; }
          best ??= row; // keep the failing candidate for visibility
        }
        if (best?.price_check_ok) break;
      }
      if (best) rows.push(best);
    }
  }

  // Primary venue per token and market type = first price-checked venue in VENUES order.
  for (const type of ["spot", "swap"] as const) {
    const order = VENUES.filter((v) => v.type === type).map((v) => v.venue);
    const byToken = new Map<string, Record<string, unknown>[]>();
    for (const r of rows.filter((r) => r.market_type === type && r.price_check_ok)) {
      byToken.set(r.coingecko_id as string, [...(byToken.get(r.coingecko_id as string) ?? []), r]);
    }
    for (const list of byToken.values()) {
      list.sort((a, b) => order.indexOf(a.venue as Venue) - order.indexOf(b.venue as Venue));
      list[0].is_primary = true;
    }
  }

  await sql.begin(async (tx) => {
    await tx`delete from symbol_map`;
    for (let i = 0; i < rows.length; i += 500) await tx`insert into symbol_map ${tx(rows.slice(i, i + 500) as never)}`;
  });
  return rows.length;
}

function marketRow(venue: Venue, m: Market) {
  return {
    venue,
    symbol: m.symbol,
    market_id: m.id ?? null,
    base: m.base ?? null,
    quote: m.quote ?? null,
    settle: m.settle ?? null,
    base_id: m.baseId ?? null,
    quote_id: m.quoteId ?? null,
    type: m.type ?? null,
    spot: m.spot ?? null,
    margin: m.margin ?? null,
    swap: m.swap ?? null,
    future: m.future ?? null,
    option: m.option ?? null,
    contract: m.contract ?? null,
    linear: m.linear ?? null,
    inverse: m.inverse ?? null,
    active: m.active ?? null,
    contract_size: num(m.contractSize),
    expiry: ts(m.expiry),
    strike: num(m.strike),
    taker: num(m.taker),
    maker: num(m.maker),
    precision: json(m.precision),
    limits: json(m.limits),
    info: json(m.info),
    updated_at: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Every minute: 1-minute candles for each token's primary spot venue and Binance perps
// ---------------------------------------------------------------------------
type Candle = {
  ts: Date;
  close_ts: Date | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  quote_volume: number | null;
  trade_count: number | null;
  taker_buy_base_volume: number | null;
  taker_buy_quote_volume: number | null;
};

// Raw exchange endpoints keep fields CCXT's unified OHLCV drops (quote volume, trades, taker-buy volume).
async function fetchCandles(s: MappedSymbol, limit: number, since?: number): Promise<{ raw: unknown; candles: Candle[] }> {
  const now = Date.now();
  if (s.venue === "binance" || s.venue === "binanceusdm") {
    const ex = exchange(s.venue) as unknown as Record<string, (p: object) => Promise<string[][]>>;
    const method = s.venue === "binance" ? "publicGetKlines" : "fapiPublicGetKlines";
    const raw = await ex[method]({ symbol: s.market_id, interval: "1m", limit, ...(since ? { startTime: since } : {}) });
    const candles = raw
      .filter((k) => Number(k[6]) < now) // closed candles only
      .map((k) => ({
        ts: new Date(Number(k[0])),
        close_ts: new Date(Number(k[6])),
        open: num(k[1]),
        high: num(k[2]),
        low: num(k[3]),
        close: num(k[4]),
        volume: num(k[5]),
        quote_volume: num(k[7]),
        trade_count: int(k[8]),
        taker_buy_base_volume: num(k[9]),
        taker_buy_quote_volume: num(k[10]),
      }));
    return { raw, candles };
  }
  if (s.venue === "okx") {
    const ex = exchange("okx") as unknown as Record<string, (p: object) => Promise<{ data: string[][] }>>;
    const raw = await ex.publicGetMarketCandles({ instId: s.market_id, bar: "1m", limit: String(Math.min(limit, 300)) });
    const candles = raw.data
      .filter((k) => k[8] === "1") // confirmed (closed)
      .map((k) => ({
        ts: new Date(Number(k[0])),
        close_ts: new Date(Number(k[0]) + 59_999),
        open: num(k[1]),
        high: num(k[2]),
        low: num(k[3]),
        close: num(k[4]),
        volume: num(k[5]),
        quote_volume: num(k[7]),
        trade_count: null,
        taker_buy_base_volume: null,
        taker_buy_quote_volume: null,
      }));
    return { raw, candles };
  }
  // coinbase: unified OHLCV only (no quote volume / trade count from this endpoint)
  const maxLimit = s.venue === "kraken" ? 720 : s.venue === "coinbase" ? 300 : 1000; // per-exchange page size
  const raw = await exchange(s.venue).fetchOHLCV(s.symbol, "1m", since, Math.min(limit, maxLimit));
  const candles = raw
    .filter((k) => Number(k[0]) + 60_000 <= now)
    .map((k) => ({
      ts: new Date(Number(k[0])),
      close_ts: new Date(Number(k[0]) + 59_999),
      open: num(k[1]),
      high: num(k[2]),
      low: num(k[3]),
      close: num(k[4]),
      volume: num(k[5]),
      quote_volume: null,
      trade_count: null,
      taker_buy_base_volume: null,
      taker_buy_quote_volume: null,
    }));
  return { raw, candles };
}

async function syncCandlesFor(symbols: MappedSymbol[], venue: Venue, limit = 3): Promise<number> {
  if (!symbols.length) return 0;
  // Self-healing: if a symbol's last stored candle is older than a few minutes (restart, outage),
  // fetch everything since then instead of just the latest candles.
  const lastRows = await sql<{ symbol: string; last: Date }[]>`
    select symbol, max(ts) as last from cex_ohlcv
    where venue = ${venue} and timeframe = '1m' and symbol = any(${symbols.map((s) => s.symbol)})
      and ts > now() - interval '1 day'
    group by symbol`;
  const lastBySymbol = new Map(lastRows.map((r) => [r.symbol, r.last.getTime()]));

  const raws: Record<string, unknown> = {};
  const rows: Record<string, unknown>[] = [];
  const { apiCallId } = await withApiLog(`ccxt:${venue}`, "klines:1m", { symbols: symbols.length, limit }, async () => {
    const errors = await eachSymbol(symbols, async (s) => {
      const last = lastBySymbol.get(s.symbol);
      const missing = last ? Math.floor((Date.now() - last) / 60_000) : 0;
      const { raw, candles } = missing > limit
        ? await fetchCandles(s, Math.min(missing + 1, 1000), last! + 60_000)
        : await fetchCandles(s, limit);
      raws[s.symbol] = raw;
      for (const c of candles) {
        rows.push({ venue, market_type: s.market_type, symbol: s.symbol, coingecko_id: s.coingecko_id, timeframe: "1m", ...c });
      }
    });
    if (errors.length) console.warn(`[ccxt:${venue}] klines errors (${errors.length}): ${errors.slice(0, 3).join(" | ")}`);
    return raws;
  });
  const withCall = rows.map((r) => ({ ...r, api_call_id: apiCallId }));
  const written = await insertChunked(
    "cex_ohlcv",
    withCall,
    `on conflict (venue, symbol, timeframe, ts) do update set
      high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume,
      quote_volume = excluded.quote_volume, trade_count = excluded.trade_count,
      taker_buy_base_volume = excluded.taker_buy_base_volume, taker_buy_quote_volume = excluded.taker_buy_quote_volume`,
  );
  await recordRowCount(apiCallId, written);
  return written;
}

export async function syncCandles(): Promise<number> {
  const spot = await mapped({ type: "spot", primaryOnly: true });
  const perps = await mapped({ type: "swap", primaryOnly: true });
  const byVenue = new Map<Venue, MappedSymbol[]>();
  for (const s of [...spot, ...perps]) byVenue.set(s.venue, [...(byVenue.get(s.venue) ?? []), s]);
  const results = await Promise.all([...byVenue].map(([venue, list]) => syncCandlesFor(list, venue)));
  return results.reduce((a, b) => a + b, 0);
}

// One-time: page back `days` of 1-minute candles for Binance spot + perps (1000 per call).
export async function backfillCandles(days = 7): Promise<number> {
  // Every primary candle source. OKX and Kraken only serve recent 1m history (~5h / ~12h), so they backfill partially.
  const targets = [...(await mapped({ type: "spot", primaryOnly: true })), ...(await mapped({ type: "swap", primaryOnly: true }))];
  let total = 0;
  for (const s of targets) {
    const [{ have }] = await sql<{ have: number }[]>`
      select count(*)::int as have from cex_ohlcv where venue = ${s.venue} and symbol = ${s.symbol}
        and ts > now() - ${days} * interval '1 day'`;
    if (have >= days * 1440 * 0.95) continue;

    const rows: Record<string, unknown>[] = [];
    // Gate rejects requests more than 10,000 candles back.
    const maxLookbackMs = s.venue === "gate" ? 9_900 * 60_000 : Infinity;
    const start = Date.now() - Math.min(days * 86_400_000, maxLookbackMs);
    let apiCallId: number;
    try {
      ({ apiCallId } = await withApiLog(`ccxt:${s.venue}`, "klines:1m:backfill", { symbol: s.symbol, days }, async () => {
      const raws: unknown[] = [];
      for (let since = start; since < Date.now() - 60_000; ) {
        const { raw, candles } = await fetchCandles(s, 1000, since);
        raws.push(raw);
        if (!candles.length) break;
        for (const c of candles) rows.push({ venue: s.venue, market_type: s.market_type, symbol: s.symbol, coingecko_id: s.coingecko_id, timeframe: "1m", ...c });
        const next = candles[candles.length - 1].ts.getTime() + 60_000;
        if (next <= since) break; // venue ignored `since` (returns latest only) — stop paging
        since = next;
      }
      return raws;
    }));
    } catch (err) {
      // One symbol failing (logged in api_calls) must not stop the rest of the backfill.
      console.warn(`[ccxt:${s.venue}] backfill ${s.symbol} failed: ${(err as Error).message.slice(0, 160)}`);
      continue;
    }
    const n = await insertChunked("cex_ohlcv", rows.map((r) => ({ ...r, api_call_id: apiCallId })), "on conflict (venue, symbol, timeframe, ts) do nothing", 1000);
    await recordRowCount(apiCallId, n);
    total += n;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Every 5 minutes: tickers on every mapped venue
// ---------------------------------------------------------------------------
export async function syncTickers(): Promise<number> {
  const symbols = await mapped();
  const capturedAt = minuteNow();
  let total = 0;
  for (const { venue, type } of VENUES) {
    const wanted = new Map(symbols.filter((s) => s.venue === venue && s.market_type === type).map((s) => [s.symbol, s.coingecko_id]));
    if (!wanted.size) continue;
    let data: Record<string, Ticker>, apiCallId: number;
    try {
      ({ data, apiCallId } = await withApiLog(`ccxt:${venue}`, `fetchTickers:${type}`, null, () => fetchTickersFor(venue, type), 45_000));
    } catch (err) {
      console.warn(`[ccxt:${venue}] tickers ${type} failed: ${(err as Error).message.slice(0, 120)}`); // logged in api_calls; other venues continue
      continue;
    }
    const rows = Object.values(data)
      .filter((t) => !!t.symbol && wanted.has(t.symbol))
      .map((t) => ({
        captured_at: capturedAt,
        api_call_id: apiCallId,
        venue,
        market_type: type,
        symbol: t.symbol,
        coingecko_id: wanted.get(t.symbol!)!,
        exchange_ts: ts(t.timestamp),
        last: num(t.last),
        open: num(t.open),
        close: num(t.close),
        previous_close: num(t.previousClose),
        high: num(t.high),
        low: num(t.low),
        bid: num(t.bid),
        bid_volume: num(t.bidVolume),
        ask: num(t.ask),
        ask_volume: num(t.askVolume),
        vwap: num(t.vwap),
        average: num(t.average),
        change: num(t.change),
        percentage: num(t.percentage),
        base_volume: num(t.baseVolume),
        quote_volume: num(t.quoteVolume),
        mark_price: num(t.markPrice),
        index_price: num(t.indexPrice),
        info: json(t.info),
      }));
    const n = await insertChunked("cex_ticker_snapshots", rows);
    await recordRowCount(apiCallId, n);
    total += n;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Every 5 minutes: funding rates (1 call per venue covers every perp)
// ---------------------------------------------------------------------------
export async function syncFundingRates(): Promise<number> {
  const capturedAt = minuteNow();
  let total = 0;
  for (const venue of ["binanceusdm", "okx", "bybit"] as const) {
    const wanted = new Map((await mapped({ venue, type: "swap" })).map((s) => [s.symbol, s.coingecko_id]));
    if (!wanted.size) continue;
    const { data, apiCallId } = await withApiLog(`ccxt:${venue}`, "fetchFundingRates", null, () => exchange(venue).fetchFundingRates());
    const rows = Object.values(data)
      .filter((f) => !!f.symbol && wanted.has(f.symbol))
      .map((f) => ({
        captured_at: capturedAt,
        api_call_id: apiCallId,
        venue,
        symbol: f.symbol,
        coingecko_id: wanted.get(f.symbol!)!,
        exchange_ts: ts(f.timestamp),
        mark_price: num(f.markPrice),
        index_price: num(f.indexPrice),
        interest_rate: num(f.interestRate),
        estimated_settle_price: num(f.estimatedSettlePrice),
        funding_rate: num(f.fundingRate),
        funding_ts: ts(f.fundingTimestamp),
        next_funding_rate: num(f.nextFundingRate),
        next_funding_ts: ts(f.nextFundingTimestamp),
        previous_funding_rate: num(f.previousFundingRate),
        previous_funding_ts: ts(f.previousFundingTimestamp),
        interval: f.interval ?? null,
        info: json(f.info),
      }));
    const n = await insertChunked("funding_rate_snapshots", rows);
    await recordRowCount(apiCallId, n);
    total += n;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Every 5 minutes: open interest (Binance per symbol with USD value; OKX all in one call)
// ---------------------------------------------------------------------------
export async function syncOpenInterest(limit = 6, since?: number): Promise<number> {
  const capturedAt = minuteNow();
  let total = 0;

  const binance = await mapped({ venue: "binanceusdm" });
  if (binance.length) {
    const rows: Record<string, unknown>[] = [];
    const fu = exchange("binanceusdm") as unknown as Record<string, (p: object) => Promise<Record<string, string>[]>>;
    const { apiCallId } = await withApiLog("ccxt:binanceusdm", "openInterestHist:5m", { symbols: binance.length, limit }, async () => {
      const raws: Record<string, unknown> = {};
      const errors = await eachSymbol(binance, async (s) => {
        const raw = await fu.fapiDataGetOpenInterestHist({ symbol: s.market_id, period: "5m", limit, ...(since ? { startTime: since } : {}) });
        raws[s.symbol] = raw;
        for (const r of raw) {
          rows.push({
            captured_at: capturedAt,
            venue: "binanceusdm",
            symbol: s.symbol,
            coingecko_id: s.coingecko_id,
            exchange_ts: ts(Number(r.timestamp)),
            open_interest_amount: num(r.sumOpenInterest),
            open_interest_value: num(r.sumOpenInterestValue),
            info: json(r),
          });
        }
      });
      if (errors.length) console.warn(`[ccxt:binanceusdm] OI errors (${errors.length}): ${errors.slice(0, 3).join(" | ")}`);
      return raws;
    });
    const n = await insertChunked("open_interest_snapshots", rows.map((r) => ({ ...r, api_call_id: apiCallId })), "on conflict (venue, symbol, exchange_ts) do nothing");
    await recordRowCount(apiCallId, n);
    total += n;
  }

  // OKX and Bybit open interest come from lib/extra syncOkxBybitOpenInterest (5m history, base-coin units).
  return total;
}

// ---------------------------------------------------------------------------
// Every 5 minutes: Binance futures positioning (crowd/top-trader long-short, taker buy/sell)
// ---------------------------------------------------------------------------
const SENTIMENT_ENDPOINTS = [
  ["fapiDataGetGlobalLongShortAccountRatio", "global"],
  ["fapiDataGetTopLongShortAccountRatio", "top_account"],
  ["fapiDataGetTopLongShortPositionRatio", "top_position"],
  ["fapiDataGetTakerlongshortRatio", "taker"],
] as const;

export async function syncFuturesSentiment(limit = 6, since?: number): Promise<number> {
  const symbols = await mapped({ venue: "binanceusdm" });
  if (!symbols.length) return 0;
  const fu = exchange("binanceusdm") as unknown as Record<string, (p: object) => Promise<Record<string, string>[]>>;
  const rows = new Map<string, Record<string, unknown>>();

  const { apiCallId } = await withApiLog("ccxt:binanceusdm", "futuresSentiment:5m", { symbols: symbols.length, limit }, async () => {
    const raws: Record<string, unknown> = {};
    const errors = await eachSymbol(symbols, async (s) => {
      for (const [method, kind] of SENTIMENT_ENDPOINTS) {
        const raw = await fu[method]({ symbol: s.market_id, period: "5m", limit, ...(since ? { startTime: since } : {}) });
        raws[`${s.symbol}:${kind}`] = raw;
        for (const r of raw) {
          const key = `${s.symbol}|${r.timestamp}`;
          const row = rows.get(key) ?? {
            venue: "binanceusdm",
            symbol: s.symbol,
            coingecko_id: s.coingecko_id,
            period: "5m",
            ts: ts(Number(r.timestamp)),
            info: {} as Record<string, unknown>,
            updated_at: new Date(),
          };
          (row.info as Record<string, unknown>)[kind] = r;
          if (kind === "taker") {
            row.taker_buy_sell_ratio = num(r.buySellRatio);
            row.taker_buy_volume = num(r.buyVol);
            row.taker_sell_volume = num(r.sellVol);
          } else {
            row[`${kind}_long_short_ratio`] = num(r.longShortRatio);
            row[`${kind}_long_account`] = num(r.longAccount);
            row[`${kind}_short_account`] = num(r.shortAccount);
          }
          rows.set(key, row);
        }
      }
    });
    if (errors.length) console.warn(`[ccxt:binanceusdm] sentiment errors (${errors.length}): ${errors.slice(0, 3).join(" | ")}`);
    return raws;
  });

  const columns = [
    "global_long_short_ratio", "global_long_account", "global_short_account",
    "top_account_long_short_ratio", "top_account_long_account", "top_account_short_account",
    "top_position_long_short_ratio", "top_position_long_account", "top_position_short_account",
    "taker_buy_sell_ratio", "taker_buy_volume", "taker_sell_volume",
  ];
  const full = [...rows.values()].map((r) => ({
    ...Object.fromEntries(columns.map((c) => [c, r[c] ?? null])),
    venue: r.venue, symbol: r.symbol, coingecko_id: r.coingecko_id, period: r.period, ts: r.ts,
    info: sql.json(r.info as never), updated_at: r.updated_at,
  }));
  const n = await insertChunked(
    "futures_sentiment_snapshots",
    full,
    `on conflict (venue, symbol, period, ts) do update set ${columns.map((c) => `${c} = coalesce(excluded.${c}, futures_sentiment_snapshots.${c})`).join(", ")},
      info = futures_sentiment_snapshots.info || excluded.info, updated_at = excluded.updated_at`,
  );
  await recordRowCount(apiCallId, n);
  return n;
}

// One-time: page back `days` of open interest + positioning (Binance keeps 30 days at 5m).
export async function backfillFutures(days = 2): Promise<number> {
  let total = 0;
  for (let since = Date.now() - days * 86_400_000; since < Date.now() - 300_000; since += 500 * 300_000) {
    total += await syncOpenInterest(500, since);
    total += await syncFuturesSentiment(500, since);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Investigation only: order book + recent trades for a token on its primary venues
// ---------------------------------------------------------------------------
export async function captureOrderBooks(coingeckoId: string, investigationId: number | null = null): Promise<number> {
  const symbols = (await mapped()).filter((s) => s.coingecko_id === coingeckoId);
  let n = 0;
  for (const s of symbols) {
    const { data: book, apiCallId } = await withApiLog(`ccxt:${s.venue}`, "fetchOrderBook", { symbol: s.symbol, limit: 100 }, () =>
      exchange(s.venue).fetchOrderBook(s.symbol, s.venue === "okx" || s.venue === "coinbase" ? undefined : 100),
    );
    const bestBid = Number(book.bids[0]?.[0] ?? NaN);
    const bestAsk = Number(book.asks[0]?.[0] ?? NaN);
    const mid = (bestBid + bestAsk) / 2;
    const depth = (levels: [number, number][], within: (p: number) => boolean) =>
      levels.filter(([p]) => within(Number(p))).reduce((sum, [p, q]) => sum + Number(p) * Number(q), 0);
    await sql`insert into order_book_snapshots ${sql({
      investigation_id: investigationId,
      captured_at: new Date(),
      api_call_id: apiCallId,
      venue: s.venue,
      symbol: s.symbol,
      coingecko_id: coingeckoId,
      exchange_ts: ts(book.timestamp),
      nonce: book.nonce ?? null,
      bids: sql.json(book.bids as never),
      asks: sql.json(book.asks as never),
      best_bid: num(bestBid),
      best_ask: num(bestAsk),
      spread_pct: Number.isFinite(mid) ? ((bestAsk - bestBid) / mid) * 100 : null,
      depth_bid_2pct_usd: depth(book.bids as [number, number][], (p) => p >= mid * 0.98),
      depth_ask_2pct_usd: depth(book.asks as [number, number][], (p) => p <= mid * 1.02),
    } as never)}`;
    n++;
  }
  return n;
}

export async function captureRecentTrades(coingeckoId: string, investigationId: number | null = null): Promise<number> {
  const symbols = (await mapped({ primaryOnly: true })).filter((s) => s.coingecko_id === coingeckoId);
  let n = 0;
  for (const s of symbols) {
    const { data: trades, apiCallId } = await withApiLog(`ccxt:${s.venue}`, "fetchTrades", { symbol: s.symbol, limit: 1000 }, () =>
      exchange(s.venue).fetchTrades(s.symbol, undefined, 1000),
    );
    const rows = trades.map((t) => ({
      venue: s.venue,
      symbol: s.symbol,
      trade_id: String(t.id),
      investigation_id: investigationId,
      coingecko_id: coingeckoId,
      ts: ts(t.timestamp),
      side: t.side ?? null,
      taker_or_maker: t.takerOrMaker ?? null,
      type: t.type ?? null,
      order_id: t.order ?? null,
      price: num(t.price),
      amount: num(t.amount),
      cost: num(t.cost),
      fee: json(t.fee),
      info: json(t.info),
      api_call_id: apiCallId,
    }));
    const written = await insertChunked("cex_trades", rows, "on conflict (venue, symbol, trade_id) do nothing");
    await recordRowCount(apiCallId, written);
    n += written;
  }
  return n;
}
