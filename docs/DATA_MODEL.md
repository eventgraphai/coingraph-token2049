# CoinGraph — Data Sources & Database Model

Source of truth for what CoinGraph fetches, how often, and where every field is stored.
Rule: **every field an API returns is stored** — flat values as typed columns, nested objects as `JSONB`.
Static facts live in reference tables; changing values live in snapshot tables. Every request is logged in `api_calls`.

Conventions
- All snapshot rows carry `captured_at` (our poll time, minute-aligned) and `api_call_id` (→ `api_calls.id`, provenance).
- Money/price columns are `numeric`; times are `timestamptz`; `raw`/`info` columns hold the untouched provider payload where the provider returns exchange-native extras.
- Intervals are env settings (e.g. `CG_MARKETS_INTERVAL=60s`); a credit guard slows `/coins/markets` if monthly usage runs hot.

---

## 1. Fetch schedule

### CoinGecko (Pro API, Basic plan — `pro-api.coingecko.com`, header `x-cg-pro-api-key`)

| # | Endpoint | Params | Frequency | Credits/day | Writes to |
|---|---|---|---|---|---|
| 1 | `/coins/markets` | `vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=1h,24h,7d,14d,30d,200d,1y` | **1 min** | 1,440 | `tokens` (upsert), `market_snapshots` |
| 2 | `/global` | — | 10 min | 144 | `global_snapshots` |
| 3 | `/coins/categories` | `order=market_cap_desc` | 5 min | 288 | `categories` (upsert), `category_snapshots` |
| 4 | `/search/trending` | — | 10 min | 144 | `trending_snapshots` |
| 5 | `/derivatives` | `include_tickers=unexpired` | 15 min | 96 | `derivatives_tickers` (universe coins only) |
| 6 | `/coins/{id}` | `localization=false&tickers=false&market_data=true&community_data=true&developer_data=true&sentiment=true` | daily × 100 | 100 | `tokens` (upsert), `coin_detail_snapshots` |
| 7 | `/coins/list` | `include_platform=true` | daily | 1 | `coins` (upsert, all ~21.9k) |
| 8 | `/asset_platforms` | — | daily | 1 | `asset_platforms` (upsert) |
| 9 | `/onchain/networks` | paginated | daily | ~3 | `onchain_networks` (upsert) |
| 10 | `/coins/{id}/market_chart` | `vs_currency=usd&days=7` (hourly) | once + new entrants | ~100 once | `market_chart_points` |
| 11 | `/coins/{id}/market_chart` | `vs_currency=usd&days=1` (5-min) | per investigation | ~20 | `market_chart_points` |
| 12 | `/coins/{id}/tickers` | `order=volume_desc&depth=true` | per investigation | ~20 | `exchange_tickers` |
| 13 | `/onchain/networks/{net}/tokens/{addr}` | — | per investigation | ~20 | `onchain_tokens` |
| 14 | `/onchain/networks/{net}/tokens/{addr}/pools` | — | per investigation | ~20 | `dex_pools` |
| 15 | `/onchain/networks/{net}/pools/{pool}/trades` | top pools only | per investigation | ~40 | `dex_trades` |
| 16 | `/onchain/networks/{net}/pools/{pool}/ohlcv/minute` | `aggregate=1&limit=1000` | per investigation | ~20 | `dex_ohlcv` |
| 17 | `/key` | — | hourly | 0* | `api_calls` (credit guard) |

≈ **2,350 credits/day** (~58k through Nov 1 of 88k remaining; account-wide pool).
Locked on Basic (not used): `top_holders`, `holders_chart`, token `trades`, `top_traders`, `wallets/*`, `top_gainers_losers`, `news`, `supply_breakdown`, `global/market_cap_chart`.

### CCXT (free — Binance spot + USDⓈ-M futures, OKX, Coinbase)

Venues: `binance` (spot), `binanceusdm` (perps), `okx` (spot + perps), `coinbase` (spot). Primary spot venue per token: Binance → OKX → Coinbase; primary perp venue: Binance → OKX.
Coverage (Oct 2026): 64 of 83 non-stable top-100 tokens have a spot candle source, 68 a perp source. Not on these venues: tokenized RWAs and exchange-native tokens (CoinGecko only).
Batched per-symbol calls are logged as one `api_calls` row per batch (raw responses archived together).

| # | Method | Scope | Frequency | Writes to |
|---|---|---|---|---|
| 18 | `loadMarkets()` + `fetchTickers()` price check (±2% vs CoinGecko, handles `1000SHIB`-style contracts) | all venues | daily | `exchange_markets`, `symbol_map` |
| 19 | Binance raw klines (`publicGetKlines` / `fapiPublicGetKlines`), OKX raw candles, Coinbase `fetchOHLCV` — keeps quote volume, trade count, taker-buy volume | primary spot venue per token + Binance perps | **1 min** (:05s) | `cex_ohlcv` |
| 20 | `fetchTickers()` | 1 call per venue × type; keep mapped symbols | 5 min | `cex_ticker_snapshots` |
| 21 | `fetchFundingRates()` | Binance + OKX, 1 call each | 5 min | `funding_rate_snapshots` |
| 22 | Binance `openInterestHist` (5m, USD value) per symbol; OKX `fetchOpenInterests()` 1 call | perps | 5 min | `open_interest_snapshots` |
| 23 | Binance global / top-account / top-position long-short ratios + taker buy/sell volume (5m) | Binance perps | 5 min | `futures_sentiment_snapshots` |
| 24 | `fetchOrderBook(sym, 100)` | flagged coin | per investigation | `order_book_snapshots` |
| 25 | `fetchTrades(sym, 1000)` | flagged coin | per investigation | `cex_trades` |
| — | One-time backfill: 7 days of 1m klines, 2 days of OI + positioning | Binance | once (self-skipping hourly) | same tables |

Not used: liquidations (WebSocket only), deposit/withdraw status (needs exchange keys), options/greeks (BTC/ETH only).

### NOWNodes (all mainnet; header `api-key`; Start plan 100k requests/month)

Continuous feeds (`lib/nownodes/jobs.ts`, CLI `npm run nownodes -- <cmd>`). Every row keys on `coingecko_id`;
`onchain_contracts` maps coin → (chain, contract) from CoinGecko's platform data (56 ETH, 25 BSC, 22 SOL, 1 ADA of the top 100).

| # | Call | Chain | Every | Writes to |
|---|---|---|---|---|
| 25 | `eth_blockNumber`, `eth_getLogs` (Transfer topic, **all tracked contracts in one call**, block chunk), `eth_getBlockByNumber` (chunk edges, timestamps interpolated) | eth, bsc | 15 min | `onchain_flow_snapshots` (per coin per 15-min window), `onchain_transfers` (≥ $25k; stablecoins ≥ $250k) |
| 26 | `eth_feeHistory` (last ~15 min of blocks, 25/50/75 percentiles) | eth, bsc | 15 min | `chain_fee_snapshots` |
| 27 | Blockbook `GET /api/v2/address/{wallet}?details=tokenBalances` per active exchange wallet | eth, bsc | hourly | `exchange_reserve_snapshots` |
| 28 | Blockbook `GET /api/v2/` (best height), `GET /api/v2/block/{height}?page=n` (1,000 txs per page) | btc | each block | `btc_block_snapshots`, `onchain_transfers` (≥ $500k, outputs not returning to inputs), `onchain_flow_snapshots` |
| 29 | `getmempoolinfo`, `estimatesmartfee` (1, 3, 6 blocks) | btc | 15 min | `btc_mempool_snapshots` |
| 30 | GraphQL `transactions(where: {includedAt ≥ cursor, totalOutput ≥ $100k in lovelace})`; amount = outputs to addresses that were not inputs (change excluded) | ada | 15 min | `onchain_transfers` (≥ $100k), `onchain_flow_snapshots` |
| 31 | `getTokenSupply` + `getTokenLargestAccounts` per Solana token; Blockfrost `GET /assets/{asset}` | sol, ada | daily | `token_holder_snapshots` |
| 32 | `GET watcher.nownodes.io/api/v1.0/networks/status?tickers=eth,bsc,btc,sol,ada` (public) | all | 5 min | `nownodes_node_status` |
| 33 | Blockbook `GET /api/v2/address/{wallet}?details=basic` (verifies each seeded exchange wallet: tx count, balance; idle/invalid → inactive); `GET /api/v2/contract/{address}` for missing decimals | eth, bsc, btc | daily | `wallet_labels`, `onchain_contracts` |

Scanners resume from `onchain_scan_cursors` (block height / unix seconds), so restarts leave no gaps. Transfers are tagged
`to_exchange` / `from_exchange` / `exchange_internal` / `mint` / `burn` / `other` using `wallet_labels` (public exchange labels,
verified on-chain). Budget ≈ 50k requests/month. Investigation-only calls (archive balances, `debug_traceTransaction`,
wallet history, Solana signatures) are added with the signal engine.

### Additional feeds (added after the core build)

| Feed | Source | Frequency | Writes to |
|---|---|---|---|
| Liquidations (OKX) | OKX REST `/api/v5/public/liquidation-orders` (last 100 per contract family) | 5 min | `liquidations` |
| Liquidations (Binance) | Binance WebSocket `!forceOrder@arr` (live) — needs a network that passes WebSocket data (works on Railway; filtered on some Wi-Fi) | live | `liquidations` |
| OKX + Bybit open interest history | CCXT `fetchOpenInterestHistory` (5m; OKX amount = base coins via `oiCcy`) | 5 min + 2-day backfill | `open_interest_snapshots` |
| OKX + Bybit long/short ratio | CCXT `fetchLongShortRatioHistory` (OKX) · Bybit `/v5/market/account-ratio` | 5 min + 2-day backfill | `futures_sentiment_snapshots` |
| Demo-coin order books | CCXT `fetchOrderBook` (primary spot + perp) | 5 min | `order_book_snapshots` |
| Exchange status | CCXT `fetchStatus` (Binance, Binance futures, OKX, Bybit, Kraken) | 5 min | `exchange_status` |
| Demo-coin DEX pools | CoinGecko `/onchain/networks/{network}/tokens/{address}/pools` (ETH uses WETH) | 15 min | `dex_pool_snapshots` |
| Exchange tickers, 100+ exchanges | CoinGecko `/coins/{id}/tickers?depth=true` | daily (top 100) + per investigation | `exchange_tickers` |
| Public treasuries | CoinGecko `/{companies|governments}/public_treasury/{bitcoin|ethereum|solana}` | daily | `public_treasury_snapshots` |
| 30-day hourly history | CoinGecko `/coins/{id}/market_chart?days=30` | once + new entrants | `market_chart_points` |

Demo coins (`DEMO_TOKENS`, default `ethereum,aave,chainlink,uniswap,pancakeswap-token`) are flagged `tokens.is_demo`.
Note: rank DEX pools by traded volume, not `reserve_in_usd` — scam pools can report huge liquidity with zero trading.

**`liquidations`** | venue | symbol (exchange-native) | coingecko_id | side (SELL = long liquidated) | position_side | order_type | time_in_force | status | price | avg_price | quantity (base) | filled_qty | notional_usd | event_ts | received_at | info jsonb | UNIQUE(venue, symbol, event_ts, side, quantity) |

**`dex_pool_snapshots`** | captured_at | api_call_id | investigation_id | coingecko_id | network | token_address | pool_address | name | dex_id | base/quote token ids | pool_created_at | base/quote token prices (usd, native, cross) | token_price_usd | fdv_usd | market_cap_usd | reserve_in_usd | price_change_percentage, volume_usd, transactions jsonb ({m5…h24}) | volume_usd_m15/h1/h24 | buys/sells_m15 | buys/sells/buyers/sellers_h1 | attributes, relationships jsonb |

**`exchange_status`** | captured_at | api_call_id | venue | status | updated | eta | url | info |

**`public_treasury_snapshots`** | captured_at | api_call_id | entity_type | coingecko_id | total_holdings | total_value_usd | market_cap_dominance | holders_count | holders jsonb |

`exchange_tickers` (defined above) now also gets a daily scheduled snapshot for the top 100 (`investigation_id` null).

---

## 2. Tables

### 2.0 Provenance

**`api_calls`** — one row per HTTP/API request
| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| provider | text | `coingecko` / `ccxt:binance` / `nownodes:eth` … |
| endpoint | text | path or CCXT method |
| params | jsonb | query/body |
| status_code | int | |
| ok | boolean | |
| error | text | |
| started_at / finished_at | timestamptz | |
| latency_ms | int | |
| response_bytes | int | |
| row_count | int | rows written |
| credits_remaining | int | from `/key` when available |

---

### 2.1 Reference tables (upserted; current state)

**`coins`** ← `/coins/list?include_platform=true` (all ~21.9k coins — map any token later)
| Column | Type | API field |
|---|---|---|
| coingecko_id | text PK | id |
| symbol | text | symbol |
| name | text | name |
| platforms | jsonb | platforms (`{chain: contract}`) |
| updated_at | timestamptz | |

**`tokens`** ← `/coins/markets` (identity + rank) and `/coins/{id}` (static detail) — our universe
| Column | Type | API field |
|---|---|---|
| coingecko_id | text PK → coins | id |
| symbol, name | text | symbol, name |
| image | jsonb | markets.image / detail.image {thumb, small, large} |
| market_cap_rank | int | market_cap_rank (latest) |
| web_slug | text | web_slug |
| asset_platform_id | text | asset_platform_id |
| contract_address | text | contract_address |
| platforms | jsonb | platforms |
| detail_platforms | jsonb | detail_platforms (incl. decimal_place) |
| block_time_in_minutes | int | block_time_in_minutes |
| hashing_algorithm | text | hashing_algorithm |
| categories | text[] | categories |
| description | text | description.en |
| links | jsonb | links |
| country_origin | text | country_origin |
| genesis_date | date | genesis_date |
| listing_price, listing_currency, listing_timestamp, listing_source, listing_source_url | mixed | listing_* |
| preview_listing | boolean | preview_listing |
| has_supply_breakdown | boolean | has_supply_breakdown |
| public_notice | text | public_notice |
| additional_notices, status_updates | jsonb | additional_notices, status_updates |
| detail_last_updated | timestamptz | last_updated |
| is_stablecoin | boolean | derived (category `stablecoins`) — excluded from alerts |
| is_demo | boolean | ours (ETH, AAVE, LINK, UNI, CAKE) |
| in_universe | boolean | ours (currently top 100) |
| first_seen_at, last_in_universe_at | timestamptz | ours |

**`asset_platforms`** ← `/asset_platforms`
| id text PK | chain_identifier int (EVM chain id) | name | shortname | native_coin_id | image jsonb | updated_at |

**`onchain_networks`** ← `/onchain/networks`
| id text PK (`eth`, `bsc`…) | name | coingecko_asset_platform_id (→ asset_platforms) | updated_at |

**`categories`** ← `/coins/categories` (static part)
| id text PK | name | content (description) | updated_at |

**`exchange_markets`** ← CCXT `loadMarkets()`
| Column | Type |
|---|---|
| exchange, symbol | text (PK together) |
| market_id, base, quote, settle, base_id, quote_id | text |
| type | text (`spot`/`swap`/`future`) |
| spot, margin, swap, future, option, contract, linear, inverse, active | boolean |
| contract_size, strike | numeric |
| expiry | timestamptz |
| taker, maker | numeric |
| precision, limits | jsonb |
| info | jsonb (exchange raw) |
| updated_at | timestamptz |

**`symbol_map`** — ours: token ↔ exchange market, price-checked
| coingecko_id → tokens | venue | market_type (spot/swap) | symbol | market_id | base | quote | price_multiplier (1000 for 1000SHIB) | exchange_price | coingecko_price | price_deviation | price_check_ok (≤2%) | is_primary | verified_at | PK(coingecko_id, venue, market_type) |

**`wallet_labels`** — ours: known exchange hot wallets, bridges, treasuries
| chain | address | label | entity | type (`exchange`/`bridge`/`treasury`/`whale`) | source | PK(chain,address) |

---

### 2.2 Snapshot tables (time series)

**`market_snapshots`** ← `/coins/markets` · every 1 min · 100 rows
| Column | Type | API field |
|---|---|---|
| id | bigserial PK | |
| coingecko_id | text → tokens | id |
| captured_at | timestamptz | ours |
| api_call_id | bigint → api_calls | ours |
| current_price | numeric | current_price |
| market_cap | numeric | market_cap |
| market_cap_rank | int | market_cap_rank |
| fully_diluted_valuation | numeric | fully_diluted_valuation |
| total_volume | numeric | total_volume |
| high_24h, low_24h | numeric | high_24h, low_24h |
| price_change_24h | numeric | price_change_24h |
| price_change_percentage_24h | numeric | price_change_percentage_24h |
| market_cap_change_24h | numeric | market_cap_change_24h |
| market_cap_change_percentage_24h | numeric | market_cap_change_percentage_24h |
| circulating_supply, total_supply, max_supply | numeric | same |
| ath, ath_change_percentage | numeric | same |
| ath_date | timestamptz | ath_date |
| atl, atl_change_percentage | numeric | same |
| atl_date | timestamptz | atl_date |
| roi | jsonb | roi |
| pct_change_1h, _24h, _7d, _14d, _30d, _200d, _1y | numeric | price_change_percentage_{period}_in_currency |
| cg_last_updated | timestamptz | last_updated |
| UNIQUE(coingecko_id, cg_last_updated) | | skip duplicates |

**`global_snapshots`** ← `/global` · every 10 min
| Column | Type | API field |
|---|---|---|
| id, captured_at, api_call_id | | |
| active_cryptocurrencies, markets | int | same |
| upcoming_icos, ongoing_icos, ended_icos | int | same |
| total_market_cap_usd, total_volume_usd | numeric | total_market_cap.usd, total_volume.usd |
| total_market_cap, total_volume | jsonb | all 63 currencies |
| market_cap_percentage | jsonb | dominance by coin |
| btc_dominance, eth_dominance | numeric | market_cap_percentage.btc/.eth |
| market_cap_change_percentage_24h_usd | numeric | same |
| volume_change_percentage_24h_usd | numeric | same |
| cg_updated_at | timestamptz | updated_at |

**`category_snapshots`** ← `/coins/categories` · every 5 min · ~771 rows
| id, captured_at, api_call_id | category_id → categories | market_cap numeric | market_cap_change_24h numeric | volume_24h numeric | top_3_coins_id text[] | top_3_coins jsonb (image URLs) | cg_updated_at |

**`trending_snapshots`** ← `/search/trending` · every 10 min · one row per item
| Column | Type | API field |
|---|---|---|
| id, captured_at, api_call_id | | |
| item_type | text | `coin` / `category` / `nft` / `rwa` |
| position | int | order in response |
| item_id | text | item.id |
| coingecko_id | text | item.coin_id / id (coins) |
| name, symbol, slug | text | |
| market_cap_rank | int | |
| score | int | |
| price_btc | numeric | |
| price_usd, market_cap, total_volume | numeric | data.price, data.market_cap, data.total_volume |
| price_change_percentage_24h_usd | numeric | data.price_change_percentage_24h.usd |
| market_cap_1h_change | numeric | (categories) |
| coins_count | int | (categories) |
| images | jsonb | thumb/small/large |
| data | jsonb | full `data` object (sparkline, btc values, content…) |

**`derivatives_tickers`** ← `/derivatives` · every 15 min · universe coins only (~4.3k rows)
| id, captured_at, api_call_id | market text | symbol text | index_id text | coingecko_id (mapped) | price numeric | price_percentage_change_24h numeric | contract_type text | index numeric | basis numeric | spread numeric | funding_rate numeric | open_interest numeric | volume_24h numeric | last_traded_at timestamptz | expired_at timestamptz |

**`coin_detail_snapshots`** ← `/coins/{id}` · daily · 100 rows
| id, captured_at, api_call_id | coingecko_id | market_cap_rank int | market_cap_rank_with_rehypothecated int | sentiment_votes_up_percentage numeric | sentiment_votes_down_percentage numeric | watchlist_portfolio_users int | market_data jsonb (all 47 keys) | community_data jsonb | developer_data jsonb | cg_last_updated |

**`market_chart_points`** ← `/coins/{id}/market_chart` · backfill + investigations
| coingecko_id | ts timestamptz | granularity text (`hourly`/`5m`) | price numeric | market_cap numeric | total_volume numeric | api_call_id | PK(coingecko_id, granularity, ts) |

**`cex_ticker_snapshots`** ← CCXT `fetchTickers()` · every 1 min · universe × 3 exchanges
| Column | Type |
|---|---|
| id, captured_at, api_call_id | |
| exchange, symbol | text |
| coingecko_id | text (via symbol_map) |
| exchange_ts | timestamptz (ticker.timestamp) |
| last, open, close, previous_close, high, low | numeric |
| bid, bid_volume, ask, ask_volume | numeric |
| vwap, average | numeric |
| change, percentage | numeric |
| base_volume, quote_volume | numeric |
| mark_price, index_price | numeric |
| info | jsonb (exchange raw) |

**`cex_ohlcv`** ← CCXT `fetchOHLCV('1m')` · every 1 min
| venue | market_type | symbol | coingecko_id | timeframe (`1m`) | ts | close_ts | open | high | low | close | volume (base) | quote_volume | trade_count | taker_buy_base_volume | taker_buy_quote_volume | api_call_id | PK(venue, symbol, timeframe, ts) |

**`open_interest_snapshots`** ← Binance `openInterestHist` / OKX `fetchOpenInterests()` · every 5 min
| id, captured_at, api_call_id | venue | symbol | coingecko_id | exchange_ts | open_interest_amount numeric | open_interest_value numeric (USD) | info jsonb | UNIQUE(venue, symbol, exchange_ts) |

**`funding_rate_snapshots`** ← CCXT `fetchFundingRates()` · every 15 min
| id, captured_at, api_call_id | exchange | symbol | coingecko_id | exchange_ts | mark_price | index_price | interest_rate | estimated_settle_price | funding_rate | funding_ts | next_funding_rate | next_funding_ts | previous_funding_rate | previous_funding_ts | interval text | info jsonb |

**`futures_sentiment_snapshots`** ← Binance futures data endpoints · every 5 min (5m buckets)
| venue | symbol | coingecko_id | period | ts | global_long_short_ratio / _long_account / _short_account | top_account_long_short_ratio / _long_account / _short_account | top_position_long_short_ratio / _long_account / _short_account | taker_buy_sell_ratio | taker_buy_volume | taker_sell_volume | info jsonb (raw row per endpoint) | PK(venue, symbol, period, ts) |

**`wallet_balance_snapshots`** ← NOWNodes · investigations
| id, captured_at | chain | address | token_contract (null = native) | balance_raw numeric | decimals int | balance numeric | value_usd numeric | block_number bigint |

---

### 2.3 Investigation evidence tables (on demand)

**`exchange_tickers`** ← `/coins/{id}/tickers`
| Column | Type |
|---|---|
| id, investigation_id, captured_at, api_call_id | |
| coingecko_id | text |
| base, target | text |
| market_name, market_identifier | text |
| has_trading_incentive | boolean |
| last, volume | numeric |
| converted_last, converted_volume | jsonb ({btc, eth, usd}) |
| converted_volume_usd | numeric |
| cost_to_move_up_usd, cost_to_move_down_usd | numeric (±2% depth) |
| trust_score | text |
| bid_ask_spread_percentage | numeric |
| ticker_ts, last_traded_at, last_fetch_at | timestamptz |
| is_anomaly, is_stale | boolean |
| trade_url, token_info_url | text |
| coin_id, target_coin_id | text |
| coin_mcap_usd | numeric |

**`onchain_tokens`** ← `/onchain/networks/{net}/tokens/{addr}`
| id, investigation_id, captured_at, api_call_id | network | address | name | symbol | decimals int | image_url | coingecko_coin_id | total_supply numeric | normalized_total_supply numeric | price_usd | fdv_usd | total_reserve_in_usd | volume_usd jsonb | market_cap_usd |

**`dex_pools`** ← `/onchain/.../tokens/{addr}/pools`
| Column | Type |
|---|---|
| id, investigation_id, captured_at, api_call_id | |
| network, pool_address, name | text |
| dex_id, base_token_id, quote_token_id | text (relationships) |
| pool_created_at | timestamptz |
| base_token_price_usd, base_token_price_native_currency | numeric |
| quote_token_price_usd, quote_token_price_native_currency | numeric |
| base_token_price_quote_token, quote_token_price_base_token | numeric |
| token_price_usd, fdv_usd, market_cap_usd, reserve_in_usd | numeric |
| price_change_percentage | jsonb {m5,m15,m30,h1,h6,h24} |
| volume_usd | jsonb {m5…h24} |
| transactions | jsonb {m5…h24: buys, sells, buyers, sellers} |
| volume_usd_h1, volume_usd_h24, buys_h1, sells_h1, buyers_h1, sellers_h1 | numeric/int (flattened for fast queries) |

**`dex_trades`** ← `/onchain/.../pools/{pool}/trades`
| id, investigation_id, captured_at, api_call_id | network | pool_address | tx_hash | block_number bigint | block_timestamp timestamptz | kind (`buy`/`sell`) | tx_from_address | from_token_address | to_token_address | from_token_amount numeric | to_token_amount numeric | price_from_in_currency_token | price_from_in_usd | price_to_in_currency_token | price_to_in_usd | volume_in_usd numeric | UNIQUE(network, tx_hash, pool_address) |

**`dex_ohlcv`** ← `/onchain/.../pools/{pool}/ohlcv/minute`
| network | pool_address | timeframe | ts | open | high | low | close | volume_usd | investigation_id | PK(network, pool_address, timeframe, ts) |

**`order_book_snapshots`** ← CCXT `fetchOrderBook()`
| id, investigation_id, captured_at | exchange | symbol | exchange_ts | bids jsonb | asks jsonb | nonce bigint | best_bid | best_ask | spread_pct | depth_bid_2pct_usd | depth_ask_2pct_usd |

**`cex_trades`** ← CCXT `fetchTrades()`
| exchange | trade_id | symbol | investigation_id | ts | side | taker_or_maker | price | amount | cost numeric | type | order_id | fee jsonb | info jsonb | PK(exchange, symbol, trade_id) |

**`onchain_transfers`** ← NOWNodes
| id, investigation_id, captured_at, api_call_id | chain | tx_hash | log_index int | block_number bigint | block_ts timestamptz | token_contract (null = native) | from_address | to_address | amount_raw numeric | decimals int | amount numeric | value_usd numeric | from_label | to_label (via wallet_labels) | direction (`to_exchange`/`from_exchange`/`wallet_to_wallet`) | raw jsonb |

---

### 2.4 Intelligence tables (from BRIEF §8; built in Phase 2)

**`signals`** | id | coingecko_id | type (`price_velocity`, `volume_zscore`, `oi_spike`, `funding_extreme`, `large_transfer`, `whale_netflow`, `exchange_flow`…) | score | value | baseline | window | details jsonb | detected_at |

**`investigations`** | id | coingecko_id | trigger (`anomaly`/`agent_request`) | status | confidence | summary | explanation | model | signals jsonb | started_at | completed_at |

**`evidence`** | id | investigation_id | source (`coingecko`/`ccxt`/`nownodes`) | type | data jsonb | tx_hash | observed_at | api_call_id |

**`intelligence_receipts`** | id | investigation_id | result_hash | cre_status | cre_tx_hash (Sepolia) | chainlink_price_check jsonb | payment jsonb (x402/Masumi: network, tx, amount, payer) | created_at |

---

## 3. Retention

Runs daily in the worker (`maintenance:retention`, or `npm run retention`). Settings: `RETENTION_MINUTE_DAYS` (default 14), `RAW_ARCHIVE_DAYS` (default 90).

| Data | Keep |
|---|---|
| `market_snapshots`, `category_snapshots`, `derivatives_tickers` (later also `cex_ticker_snapshots`, `cex_ohlcv`, `open_interest_snapshots`, `funding_rate_snapshots`) | Every row for 14 days → then the first row per series per hour, forever |
| Rows inside a `retention_holds` window (e.g. an investigation's time range) | Every row, forever |
| `global_snapshots`, `trending_snapshots`, `coin_detail_snapshots`, `market_chart_points` | Forever (already low frequency) |
| `api_calls` | Forever — retained rows reference it for provenance; ~0.5 MB/day |
| Raw archive objects (Supabase Storage `raw-api`) | 90 days |
| Reference tables, investigation evidence + intelligence tables | Forever (receipts depend on them) |

**`retention_holds`** | id | coingecko_id (null = all coins) | from_ts | to_ts | reason (`investigation:<id>`, `demo-case`) | created_at |

---

## 4. Operations: tracking and the /status dashboard

The worker (`npm run worker:supervised`) records every job run and a heartbeat; the web app shows them at **`/status`**
(live, auto-refreshes every 30s; set `STATUS_TOKEN` to require `/status?token=…`).

| Object | What it holds |
|---|---|
| `job_runs` | One row per job run: worker_id, job, started_at, finished_at, status (`running`/`ok`/`failed`/`timeout`), rows, duration_ms, error. Kept 14 days. |
| `worker_heartbeats` | One row per worker process, `last_beat` updated every 30s, jobs currently running, memory, pool mode. Exited workers kept 2 days. |
| `job_health` (view) | Per job: last result and error, last success, runs / failures in the last hour and 24h, avg / max duration. |
| `ingestion_health` (view) | Per external feed: status vs expected cadence (`ok` ≤ 2×, `late` ≤ 5×, else `down`), calls, failures, rows, latency. |
| `open_interest_usd` (view) | Open interest in USD for every venue: reported value, else amount × latest mark price (Bybit). |
| `cex_ohlcv_usd` (view) | 1m candles with USD volume for every venue: reported quote volume, else base volume × close. |
| `system_metrics` | Hourly snapshot (credit-guard job): database size, CoinGecko credits remaining/monthly, connections, largest tables. Drives growth/day and burn rate. |

The schedule (job name, interval, offset, category, label) lives in `lib/jobs-meta.ts`; the worker attaches run functions to it
and the dashboard uses it for grouping and "next run". Dashboard sections: summary tiles, **coverage** (top-100 freshness and
minute coverage, primary candle series complete for the last hour, futures symbols reporting per venue, demo-coin data-age grid),
one section per **category** (market data, exchange spot, futures & leverage, onchain, maintenance) with jobs — status, next run,
24h success rate, typical/slow duration, time-limit use, rows last vs normal — and feeds — venue, status, calls/failures, latency,
CoinGecko credits per feed — then **exchange & API health** per provider, **budget & capacity** (credits used, burn/day, days left,
month-end projection; DB size, growth/day, connections, largest tables), a 60-minute run timeline, data freshness and recent failures.
The browser tab title carries the overall status (`✓ Pipeline status` / `! n down · n late`).

Reliability safeguards in the worker: session pooler (port 5432) for all DB connections, a hard deadline on every external call
(150s per logged call, 45s for tickers, 25s per symbol), per-job time limits (4 min frequent / 20 min daily), restart on a hung job,
a 10-minute no-progress watchdog, and a local supervisor (`scripts/run-worker.sh`) that restarts the process. 1-minute candles
self-heal gaps from the exchange; CoinGecko gaps are back-filled hourly from `/coins/{id}/market_chart?days=1` (5-minute points).
