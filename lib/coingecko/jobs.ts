import { sql, insertChunked } from "../db";
import { env } from "../env";
import { recordRowCount } from "../http";
import { cg, int, json, num, ts } from "./client";
import type {
  AssetPlatform,
  Category,
  CoinDetail,
  CoinListItem,
  DerivativeTicker,
  GlobalData,
  KeyUsage,
  MarketChart,
  MarketCoin,
  OnchainNetworks,
  Trending,
  TrendingItem,
} from "./types";

// Snapshots are stamped with the minute they were taken so series align across sources.
const minuteNow = () => {
  const d = new Date();
  d.setUTCSeconds(0, 0);
  return d;
};

// CoinGecko returns {"": ""} for native coins (no contract); store {} instead.
const cleanPlatforms = (p: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(p ?? {}).filter(([chain, address]) => chain && address));

// "Stablecoins" / "USD Stablecoin" / "Fiat-backed Stablecoin" mark a stablecoin;
// "Stablecoin Issuer" (AAVE, ENA, SKY, WLFI) marks a project that issues one, which is not.
const isStablecoinCategory = (category: string) => /^stablecoins$|\sstablecoin$/i.test(category.trim());

async function universeIds(): Promise<string[]> {
  const rows = await sql<{ coingecko_id: string }[]>`
    select coingecko_id from tokens where in_universe order by market_cap_rank nulls last`;
  return rows.map((r) => r.coingecko_id);
}

async function mapConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (err) {
        console.warn(`[coingecko] ${String(item)}: ${(err as Error).message}`);
      }
    }
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// /coins/markets — top-N universe, every minute
// ---------------------------------------------------------------------------
// CoinGecko refreshes each coin roughly once a minute (around :20–:30s) and occasionally skips a
// minute; rows whose last_updated hasn't changed are skipped, so such a minute writes 0 rows.
export async function syncMarkets(): Promise<number> {
  const { data, apiCallId } = await cg<MarketCoin[]>("/coins/markets", {
    vs_currency: "usd",
    order: "market_cap_desc",
    per_page: env.universeSize,
    page: 1,
    sparkline: false,
    price_change_percentage: "1h,24h,7d,14d,30d,200d,1y",
  });
  const capturedAt = minuteNow();

  await sql.begin(async (tx) => {
    const tokens = data.map((c) => ({
      coingecko_id: c.id,
      symbol: c.symbol,
      name: c.name,
      image: c.image ? tx.json({ large: c.image }) : null,
      market_cap_rank: c.market_cap_rank,
      in_universe: true,
      last_in_universe_at: capturedAt,
      updated_at: capturedAt,
    }));
    await tx`
      insert into tokens ${tx(tokens as never)}
      on conflict (coingecko_id) do update set
        symbol = excluded.symbol, name = excluded.name,
        image = coalesce(tokens.image, excluded.image),
        market_cap_rank = excluded.market_cap_rank, in_universe = true,
        last_in_universe_at = excluded.last_in_universe_at, updated_at = excluded.updated_at`;
    await tx`
      update tokens set in_universe = false, updated_at = ${capturedAt}
      where in_universe and coingecko_id <> all(${data.map((c) => c.id)})`;
  });

  const snapshots = data.map((c) => ({
    coingecko_id: c.id,
    captured_at: capturedAt,
    api_call_id: apiCallId,
    current_price: num(c.current_price),
    market_cap: num(c.market_cap),
    market_cap_rank: int(c.market_cap_rank),
    fully_diluted_valuation: num(c.fully_diluted_valuation),
    total_volume: num(c.total_volume),
    high_24h: num(c.high_24h),
    low_24h: num(c.low_24h),
    price_change_24h: num(c.price_change_24h),
    price_change_percentage_24h: num(c.price_change_percentage_24h),
    market_cap_change_24h: num(c.market_cap_change_24h),
    market_cap_change_percentage_24h: num(c.market_cap_change_percentage_24h),
    circulating_supply: num(c.circulating_supply),
    total_supply: num(c.total_supply),
    max_supply: num(c.max_supply),
    ath: num(c.ath),
    ath_change_percentage: num(c.ath_change_percentage),
    ath_date: ts(c.ath_date),
    atl: num(c.atl),
    atl_change_percentage: num(c.atl_change_percentage),
    atl_date: ts(c.atl_date),
    roi: c.roi == null ? null : sql.json(c.roi as never),
    pct_change_1h: num(c.price_change_percentage_1h_in_currency),
    pct_change_24h: num(c.price_change_percentage_24h_in_currency),
    pct_change_7d: num(c.price_change_percentage_7d_in_currency),
    pct_change_14d: num(c.price_change_percentage_14d_in_currency),
    pct_change_30d: num(c.price_change_percentage_30d_in_currency),
    pct_change_200d: num(c.price_change_percentage_200d_in_currency),
    pct_change_1y: num(c.price_change_percentage_1y_in_currency),
    cg_last_updated: ts(c.last_updated),
  }));
  const written = await insertChunked("market_snapshots", snapshots, "on conflict (coingecko_id, cg_last_updated) do nothing");
  await recordRowCount(apiCallId, written);
  return written;
}

// ---------------------------------------------------------------------------
// /global — market-wide totals, every 10 minutes
// ---------------------------------------------------------------------------
export async function syncGlobal(): Promise<number> {
  const { data, apiCallId } = await cg<GlobalData>("/global");
  const g = data.data;
  const result = await sql`
    insert into global_snapshots ${sql({
      captured_at: minuteNow(),
      api_call_id: apiCallId,
      active_cryptocurrencies: int(g.active_cryptocurrencies),
      markets: int(g.markets),
      upcoming_icos: int(g.upcoming_icos),
      ongoing_icos: int(g.ongoing_icos),
      ended_icos: int(g.ended_icos),
      total_market_cap_usd: num(g.total_market_cap?.usd),
      total_volume_usd: num(g.total_volume?.usd),
      total_market_cap: sql.json(g.total_market_cap),
      total_volume: sql.json(g.total_volume),
      market_cap_percentage: sql.json(g.market_cap_percentage),
      btc_dominance: num(g.market_cap_percentage?.btc),
      eth_dominance: num(g.market_cap_percentage?.eth),
      market_cap_change_percentage_24h_usd: num(g.market_cap_change_percentage_24h_usd),
      volume_change_percentage_24h_usd: num(g.volume_change_percentage_24h_usd),
      cg_updated_at: ts(g.updated_at),
    } as never)}
    on conflict (cg_updated_at) do nothing`;
  await recordRowCount(apiCallId, result.count);
  return result.count;
}

// ---------------------------------------------------------------------------
// /coins/categories — sector market data, every 5 minutes
// ---------------------------------------------------------------------------
export async function syncCategories(): Promise<number> {
  const { data, apiCallId } = await cg<Category[]>("/coins/categories", { order: "market_cap_desc" });
  const capturedAt = minuteNow();

  await insertChunked(
    "categories",
    data.map((c) => ({ id: c.id, name: c.name, content: c.content, updated_at: capturedAt })),
    "on conflict (id) do update set name = excluded.name, content = excluded.content, updated_at = excluded.updated_at",
  );

  const written = await insertChunked(
    "category_snapshots",
    data.map((c) => ({
      category_id: c.id,
      captured_at: capturedAt,
      api_call_id: apiCallId,
      market_cap: num(c.market_cap),
      market_cap_change_24h: num(c.market_cap_change_24h),
      volume_24h: num(c.volume_24h),
      top_3_coins_id: c.top_3_coins_id ?? null,
      top_3_coins: c.top_3_coins ? sql.json(c.top_3_coins) : null,
      cg_updated_at: ts(c.updated_at),
    })),
    "on conflict (category_id, cg_updated_at) do nothing",
  );
  await recordRowCount(apiCallId, written);
  return written;
}

// ---------------------------------------------------------------------------
// /search/trending — attention signal, every 10 minutes
// ---------------------------------------------------------------------------
export async function syncTrending(): Promise<number> {
  const { data, apiCallId } = await cg<Trending>("/search/trending");
  const capturedAt = minuteNow();

  const toRow = (type: string, item: TrendingItem, position: number) => {
    const d = item.data ?? {};
    return {
      captured_at: capturedAt,
      api_call_id: apiCallId,
      item_type: type,
      position,
      item_id: item.id === undefined ? null : String(item.id),
      coingecko_id: type === "coin" && item.id !== undefined ? String(item.id) : null,
      name: item.name ?? null,
      symbol: item.symbol ?? null,
      slug: item.slug ?? null,
      market_cap_rank: int(item.market_cap_rank),
      score: int(item.score),
      price_btc: num(item.price_btc),
      price_usd: num(d.price),
      market_cap: num(d.market_cap),
      total_volume: num(d.total_volume),
      price_change_percentage_24h_usd: num(d.price_change_percentage_24h?.usd),
      market_cap_1h_change: num(item.market_cap_1h_change),
      coins_count: int(item.coins_count),
      images: sql.json({ thumb: item.thumb ?? null, small: item.small ?? null, large: item.large ?? null }),
      data: item.data ? sql.json(item.data as never) : null,
      item: sql.json(item as never),
    };
  };

  const rows = [
    ...data.coins.map((c, i) => toRow("coin", c.item, i + 1)),
    ...(data.categories ?? []).map((c, i) => toRow("category", c, i + 1)),
    ...(data.nfts ?? []).map((n, i) => toRow("nft", n, i + 1)),
    ...(data.rwas ?? []).map((r, i) => toRow("rwa", r, i + 1)),
  ];
  const written = await insertChunked("trending_snapshots", rows);
  await recordRowCount(apiCallId, written);
  return written;
}

// ---------------------------------------------------------------------------
// /derivatives — futures/perps across exchanges, every 15 minutes (universe coins only)
// ---------------------------------------------------------------------------
export async function syncDerivatives(): Promise<number> {
  const { data, apiCallId } = await cg<DerivativeTicker[]>("/derivatives", { include_tickers: "unexpired" });
  const capturedAt = minuteNow();

  // index_id is a ticker symbol (e.g. "AAVE"); map it to the highest-ranked universe token with that symbol.
  const universe = await sql<{ coingecko_id: string; symbol: string }[]>`
    select coingecko_id, symbol from tokens where in_universe order by market_cap_rank desc nulls first`;
  const bySymbol = new Map(universe.map((t) => [t.symbol.toUpperCase(), t.coingecko_id]));

  const rows = data
    .filter((d) => d.index_id && bySymbol.has(d.index_id.toUpperCase()))
    .map((d) => ({
      captured_at: capturedAt,
      api_call_id: apiCallId,
      coingecko_id: bySymbol.get(d.index_id.toUpperCase())!,
      market: d.market,
      symbol: d.symbol,
      index_id: d.index_id,
      price: num(d.price),
      price_percentage_change_24h: num(d.price_percentage_change_24h),
      contract_type: d.contract_type,
      index: num(d.index),
      basis: num(d.basis),
      spread: num(d.spread),
      funding_rate: num(d.funding_rate),
      open_interest: num(d.open_interest),
      volume_24h: num(d.volume_24h),
      last_traded_at: ts(d.last_traded_at),
      expired_at: ts(d.expired_at),
    }));
  const written = await insertChunked("derivatives_tickers", rows);
  await recordRowCount(apiCallId, written);
  return written;
}

// ---------------------------------------------------------------------------
// Daily reference data
// ---------------------------------------------------------------------------
export async function syncCoinsList(): Promise<number> {
  const { data, apiCallId } = await cg<CoinListItem[]>("/coins/list", { include_platform: true });
  const now = new Date();
  const written = await insertChunked(
    "coins",
    data.map((c) => ({
      coingecko_id: c.id,
      symbol: c.symbol,
      name: c.name,
      platforms: sql.json(cleanPlatforms(c.platforms) as never),
      updated_at: now,
    })),
    "on conflict (coingecko_id) do update set symbol = excluded.symbol, name = excluded.name, platforms = excluded.platforms, updated_at = excluded.updated_at",
    1000,
  );
  await recordRowCount(apiCallId, written);
  return written;
}

export async function syncAssetPlatforms(): Promise<number> {
  const { data, apiCallId } = await cg<AssetPlatform[]>("/asset_platforms");
  const now = new Date();
  const written = await insertChunked(
    "asset_platforms",
    data.map((p) => ({
      id: p.id,
      chain_identifier: p.chain_identifier ?? null,
      name: p.name,
      shortname: p.shortname || null,
      native_coin_id: p.native_coin_id || null,
      image: p.image ? sql.json(p.image as never) : null,
      updated_at: now,
    })),
    "on conflict (id) do update set chain_identifier = excluded.chain_identifier, name = excluded.name, shortname = excluded.shortname, native_coin_id = excluded.native_coin_id, image = excluded.image, updated_at = excluded.updated_at",
  );
  await recordRowCount(apiCallId, written);
  return written;
}

export async function syncOnchainNetworks(): Promise<number> {
  const now = new Date();
  let total = 0;
  for (let page = 1; page <= 20; page++) {
    const { data, apiCallId } = await cg<OnchainNetworks>("/onchain/networks", { page }, "/onchain/networks");
    if (!data.data?.length) break;
    const written = await insertChunked(
      "onchain_networks",
      data.data.map((n) => ({
        id: n.id,
        name: n.attributes.name,
        coingecko_asset_platform_id: n.attributes.coingecko_asset_platform_id,
        updated_at: now,
      })),
      "on conflict (id) do update set name = excluded.name, coingecko_asset_platform_id = excluded.coingecko_asset_platform_id, updated_at = excluded.updated_at",
    );
    await recordRowCount(apiCallId, written);
    total += written;
    if (!data.links?.next) break;
  }
  return total;
}

// /coins/{id} — full static detail + daily sentiment/market_data snapshot for each universe coin.
export async function syncCoinDetails(ids?: string[]): Promise<number> {
  const targets = ids ?? (await universeIds());
  let written = 0;

  await mapConcurrent(targets, 4, async (id) => {
    const { data: c, apiCallId } = await cg<CoinDetail>(
      `/coins/${id}`,
      { localization: false, tickers: false, market_data: true, community_data: true, developer_data: true, sentiment: true },
      "/coins/{id}",
    );
    const now = new Date();
    const categories = c.categories?.filter(Boolean) ?? [];

    await sql`
      update tokens set
        symbol = ${c.symbol}, name = ${c.name},
        image = ${c.image ? sql.json(c.image) : null},
        web_slug = ${c.web_slug ?? null},
        asset_platform_id = ${c.asset_platform_id ?? null},
        contract_address = ${c.contract_address || null},
        platforms = ${sql.json(cleanPlatforms(c.platforms))},
        detail_platforms = ${c.detail_platforms ? sql.json(c.detail_platforms as never) : null},
        block_time_in_minutes = ${int(c.block_time_in_minutes)},
        hashing_algorithm = ${c.hashing_algorithm ?? null},
        categories = ${categories},
        description = ${c.description?.en || null},
        links = ${c.links ? sql.json(c.links as never) : null},
        country_origin = ${c.country_origin || null},
        genesis_date = ${c.genesis_date || null},
        listing_price = ${num(c.listing_price)},
        listing_currency = ${c.listing_currency ?? null},
        listing_timestamp = ${ts(c.listing_timestamp)},
        listing_source = ${c.listing_source ?? null},
        listing_source_url = ${c.listing_source_url ?? null},
        preview_listing = ${c.preview_listing ?? null},
        has_supply_breakdown = ${c.has_supply_breakdown ?? null},
        public_notice = ${c.public_notice ?? null},
        additional_notices = ${c.additional_notices ? sql.json(c.additional_notices as never) : null},
        status_updates = ${c.status_updates ? sql.json(c.status_updates as never) : null},
        detail_last_updated = ${ts(c.last_updated)},
        is_stablecoin = ${categories.some(isStablecoinCategory)},
        updated_at = ${now}
      where coingecko_id = ${id}`;

    await sql`
      insert into coin_detail_snapshots ${sql({
        coingecko_id: id,
        captured_at: now,
        api_call_id: apiCallId,
        market_cap_rank: int(c.market_cap_rank),
        market_cap_rank_with_rehypothecated: int(c.market_cap_rank_with_rehypothecated),
        sentiment_votes_up_percentage: num(c.sentiment_votes_up_percentage),
        sentiment_votes_down_percentage: num(c.sentiment_votes_down_percentage),
        watchlist_portfolio_users: int(c.watchlist_portfolio_users),
        market_data: c.market_data ? sql.json(c.market_data as never) : null,
        community_data: c.community_data ? sql.json(c.community_data as never) : null,
        developer_data: c.developer_data ? sql.json(c.developer_data as never) : null,
        cg_last_updated: ts(c.last_updated),
      } as never)}`;
    await recordRowCount(apiCallId, 2);
    written++;
  });
  return written;
}

// /coins/{id}/market_chart — hourly history so baselines exist from day one.
export async function backfillMarketCharts(days = 7, ids?: string[]): Promise<number> {
  const granularity = days <= 1 ? "5m" : days <= 90 ? "hourly" : "daily";
  let targets = ids ?? (await universeIds());
  if (!ids) {
    // Skip tokens that already have this history.
    const have = await sql<{ coingecko_id: string }[]>`
      select coingecko_id from market_chart_points
      where granularity = ${granularity} and ts > now() - make_interval(days => ${days - 1})
      group by coingecko_id having count(*) >= ${days * 20}`;
    const done = new Set(have.map((h) => h.coingecko_id));
    targets = targets.filter((id) => !done.has(id));
  }

  let written = 0;
  await mapConcurrent(targets, 4, async (id) => {
    const { data, apiCallId } = await cg<MarketChart>(
      `/coins/${id}/market_chart`,
      { vs_currency: "usd", days },
      "/coins/{id}/market_chart",
    );
    const caps = new Map(data.market_caps.map(([t, v]) => [t, v]));
    const vols = new Map(data.total_volumes.map(([t, v]) => [t, v]));
    const rows = data.prices.map(([t, price]) => ({
      coingecko_id: id,
      granularity,
      ts: new Date(t),
      price: num(price),
      market_cap: num(caps.get(t)),
      total_volume: num(vols.get(t)),
      api_call_id: apiCallId,
    }));
    const n = await insertChunked("market_chart_points", rows, "on conflict (coingecko_id, granularity, ts) do nothing");
    await recordRowCount(apiCallId, n);
    written += n;
  });
  return written;
}

// /key — plan usage, used by the worker's credit guard.
export async function fetchKeyUsage(): Promise<KeyUsage> {
  const { data, apiCallId } = await cg<KeyUsage>("/key");
  await sql`update api_calls set credits_remaining = ${data.current_remaining_monthly_calls} where id = ${apiCallId}`;
  return data;
}

// Gap-fill: after an outage the per-minute /coins/markets history can't be re-fetched, so fill any
// 5-minute bucket of the last 24h that has no snapshot with CoinGecko's 5-minute chart (days=1).
// Only coins with gaps are fetched (1 credit each); buckets already filled are skipped.
export async function fillMarketGaps(): Promise<number> {
  const gaps = await sql<{ coingecko_id: string; missing: number }[]>`
    with buckets as (
      select generate_series(date_bin('5 minutes', now() - interval '24 hours', 'epoch'), now() - interval '15 minutes', interval '5 minutes') as b
    ),
    universe as (select coingecko_id, first_seen_at from tokens where in_universe),
    covered as (
      select coingecko_id, date_bin('5 minutes', captured_at, 'epoch') as b from market_snapshots
      where captured_at > now() - interval '25 hours' group by 1, 2
    ),
    filled as (
      select coingecko_id, date_bin('5 minutes', ts, 'epoch') as b from market_chart_points
      where granularity = '5m' and ts > now() - interval '25 hours' group by 1, 2
    )
    select u.coingecko_id, count(*)::int as missing
    from universe u cross join buckets k
    left join covered c on c.coingecko_id = u.coingecko_id and c.b = k.b
    left join filled f on f.coingecko_id = u.coingecko_id and f.b = k.b
    where c.b is null and f.b is null and k.b >= u.first_seen_at - interval '1 day'
    group by u.coingecko_id
    having count(*) >= 2`;
  if (!gaps.length) return 0;
  console.log(`[gap-fill] ${gaps.length} coins with missing 5-min buckets (max ${Math.max(...gaps.map((g) => g.missing))})`);
  return backfillMarketCharts(1, gaps.map((g) => g.coingecko_id));
}
