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

| # | Method | Scope | Frequency | Writes to |
|---|---|---|---|---|
| 18 | `loadMarkets()` | all markets per exchange | daily | `exchange_markets` (upsert), `symbol_map` |
| 19 | `fetchTickers()` | 1 call per exchange; keep universe symbols | **1 min** | `cex_ticker_snapshots` |
| 20 | `fetchOHLCV(sym, '1m')` | universe symbols on primary exchange (Binance; fallback OKX → Coinbase) | **1 min** | `cex_ohlcv` |
| 21 | `fetchOpenInterest(sym)` | universe perps on Binance futures | 5 min | `open_interest_snapshots` |
| 22 | `fetchFundingRates()` | 1 call, all perps; keep universe | 15 min | `funding_rate_snapshots` |
| 23 | `fetchOrderBook(sym, 100)` | flagged coin | per investigation | `order_book_snapshots` |
| 24 | `fetchTrades(sym, limit=1000)` | flagged coin | per investigation | `cex_trades` |

### NOWNodes (investigation only — never polled for all 100)

| # | Call | Chains | Writes to |
|---|---|---|---|
| 25 | `eth_getLogs` (ERC-20 `Transfer` topic, token contract, last N blocks) | eth, bsc | `onchain_transfers` |
| 26 | `eth_getTransactionByHash` / `eth_getTransactionReceipt` (DEX trader + large tx lookups) | eth, bsc | `onchain_transfers`, `evidence` |
| 27 | `eth_getBalance` / ERC-20 `balanceOf` (`eth_call`) for whale / exchange wallets | eth, bsc | `wallet_balance_snapshots` |
| 28 | Blockbook address/tx API | btc | `onchain_transfers` |
| 29 | Koios (`ada-testnet` / mainnet) address & tx endpoints | ada | `onchain_transfers` |

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

**`symbol_map`** — ours: one coin ↔ its exchange symbols and onchain contracts
| coingecko_id → tokens | exchange | spot_symbol | perp_symbol | is_primary boolean | price_check_ok boolean (exchange price within ~2% of CoinGecko) | verified_at |

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
| exchange | symbol | coingecko_id | timeframe text (`1m`) | ts timestamptz | open | high | low | close | volume numeric | PK(exchange, symbol, timeframe, ts) |

**`open_interest_snapshots`** ← CCXT `fetchOpenInterest()` · every 5 min
| id, captured_at, api_call_id | exchange | symbol | coingecko_id | exchange_ts | open_interest_amount numeric | open_interest_value numeric | base_volume numeric | quote_volume numeric | info jsonb |

**`funding_rate_snapshots`** ← CCXT `fetchFundingRates()` · every 15 min
| id, captured_at, api_call_id | exchange | symbol | coingecko_id | exchange_ts | mark_price | index_price | interest_rate | estimated_settle_price | funding_rate | funding_ts | next_funding_rate | next_funding_ts | previous_funding_rate | previous_funding_ts | interval text | info jsonb |

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

| Data | Keep |
|---|---|
| `market_snapshots`, `global_snapshots`, `cex_ticker_snapshots`, `cex_ohlcv`, `category_snapshots` | 14 days full → then 1 row/hour forever |
| `derivatives_tickers`, `open_interest_snapshots`, `funding_rate_snapshots` | 14 days full → hourly forever |
| `api_calls` | 30 days |
| Reference tables, `trending_snapshots`, `coin_detail_snapshots`, `market_chart_points` | forever |
| All investigation evidence + intelligence tables | forever (receipts depend on them) |
