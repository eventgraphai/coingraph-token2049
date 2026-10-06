import { env } from "./env";

// Single source of truth for the worker's schedule: the worker attaches a run function to each entry,
// the /status dashboard uses the same entries to group jobs and compute when each should run next.

export type Category = "market" | "spot" | "futures" | "onchain" | "intelligence" | "maintenance";

export const CATEGORY_LABEL: Record<Category, string> = {
  market: "Market data · CoinGecko",
  spot: "Exchange spot · CCXT",
  futures: "Futures & leverage",
  onchain: "Onchain · NOWNodes",
  intelligence: "Signals & investigations",
  maintenance: "Maintenance",
};

export type JobMeta = {
  name: string;
  everySec: number;
  offsetSec?: number; // seconds into each slot the job starts
  endpoint?: string; // "provider|endpoint" in api_calls, used to resume the schedule after a restart
  category: Category;
  label: string;
};

export const JOB_SCHEDULE: JobMeta[] = [
  // CoinGecko. Markets at :40s, just after CoinGecko's usual :20–:30s refresh.
  { name: "cg:markets", everySec: env.intervals.markets, offsetSec: 40, endpoint: "coingecko|/coins/markets", category: "market", label: "Top-100 prices, volume, rank" },
  { name: "cg:global", everySec: env.intervals.global, endpoint: "coingecko|/global", category: "market", label: "Market-wide totals" },
  { name: "cg:categories", everySec: env.intervals.categories, endpoint: "coingecko|/coins/categories", category: "market", label: "Sector market data" },
  { name: "cg:trending", everySec: env.intervals.trending, endpoint: "coingecko|/search/trending", category: "market", label: "Trending searches" },
  { name: "cg:derivatives", everySec: env.intervals.derivatives, endpoint: "coingecko|/derivatives", category: "futures", label: "Futures across 100+ exchanges" },
  { name: "cg:dex-pools", everySec: 900, offsetSec: 20, endpoint: "coingecko|/onchain/networks/{network}/tokens/{address}/pools", category: "market", label: "Demo-coin DEX pools" },
  { name: "cg:exchange-tickers", everySec: 86400, offsetSec: 1800, endpoint: "coingecko|/coins/{id}/tickers", category: "market", label: "Volume by exchange (100+)" },
  { name: "cg:public-treasuries", everySec: 86400, offsetSec: 2400, endpoint: "coingecko|/{entity}/public_treasury/{coin_id}", category: "market", label: "Company & government holdings" },
  { name: "cg:daily-reference", everySec: env.intervals.daily, endpoint: "coingecko|/coins/{id}", category: "market", label: "Coin list, chains, coin details" },

  // CCXT exchanges. Candles at :05s so the previous minute's candle has closed; 5-minute jobs staggered.
  { name: "ccxt:candles", everySec: 60, offsetSec: 5, endpoint: "ccxt:binance|klines:1m", category: "spot", label: "1-minute candles (spot + perps)" },
  { name: "ccxt:tickers", everySec: 300, offsetSec: 10, endpoint: "ccxt:binance|fetchTickers:spot", category: "spot", label: "Tickers on 7 venues" },
  { name: "ccxt:demo-order-books", everySec: 300, offsetSec: 35, category: "spot", label: "Demo-coin order books" },
  { name: "ccxt:symbol-map", everySec: 86400, offsetSec: 600, endpoint: "ccxt:binance|loadMarkets", category: "spot", label: "Exchange markets + symbol map" },
  { name: "ccxt:funding", everySec: 300, offsetSec: 15, endpoint: "ccxt:binanceusdm|fetchFundingRates", category: "futures", label: "Funding rates" },
  { name: "ccxt:open-interest", everySec: 300, offsetSec: 20, endpoint: "ccxt:binanceusdm|openInterestHist:5m", category: "futures", label: "Open interest · Binance" },
  { name: "ccxt:okx-bybit-oi", everySec: 300, offsetSec: 25, endpoint: "ccxt:okx|openInterestHistory:5m", category: "futures", label: "Open interest · OKX, Bybit" },
  { name: "ccxt:sentiment", everySec: 300, offsetSec: 30, endpoint: "ccxt:binanceusdm|futuresSentiment:5m", category: "futures", label: "Positioning · Binance" },
  { name: "ccxt:okx-bybit-long-short", everySec: 300, offsetSec: 50, endpoint: "ccxt:okx|longShortRatio:5m", category: "futures", label: "Long/short · OKX, Bybit" },
  { name: "okx:liquidations", everySec: 300, offsetSec: 45, endpoint: "okx|/api/v5/public/liquidation-orders", category: "futures", label: "Liquidations · OKX" },

  // NOWNodes (mainnet). 15-minute scans staggered; each resumes from its last scanned block.
  { name: "nn:eth-flows", everySec: 900, offsetSec: 60, endpoint: "nownodes|eth:eth_getLogs", category: "onchain", label: "Ethereum token flows + large transfers" },
  { name: "nn:bsc-flows", everySec: 900, offsetSec: 100, endpoint: "nownodes|bsc:eth_getLogs", category: "onchain", label: "BNB Chain token flows + large transfers" },
  { name: "nn:fees", everySec: 900, offsetSec: 140, endpoint: "nownodes|eth:eth_feeHistory", category: "onchain", label: "Network fees · ETH, BSC" },
  { name: "nn:btc-blocks", everySec: 600, offsetSec: 170, endpoint: "nownodes|btc:/block/{height}", category: "onchain", label: "Bitcoin blocks + large transfers" },
  { name: "nn:btc-mempool", everySec: 900, offsetSec: 200, endpoint: "nownodes|btc:getmempoolinfo", category: "onchain", label: "Bitcoin mempool + fees" },
  { name: "nn:ada-transfers", everySec: 900, offsetSec: 230, endpoint: "nownodes|ada:graphql:transactions", category: "onchain", label: "Cardano large transfers" },
  { name: "nn:exchange-reserves", everySec: 3600, offsetSec: 400, endpoint: "nownodes|eth:/address/{wallet}", category: "onchain", label: "Exchange reserves · ETH, BSC" },
  { name: "nn:node-status", everySec: 300, offsetSec: 58, endpoint: "nownodes|watcher:/networks/status", category: "onchain", label: "NOWNodes node health" },
  { name: "nn:holders", everySec: 86400, offsetSec: 3000, endpoint: "nownodes|sol:getTokenLargestAccounts", category: "onchain", label: "Holder concentration · Solana" },
  { name: "nn:reference", everySec: 86400, offsetSec: 700, endpoint: "nownodes|eth:/address/{wallet}:basic", category: "onchain", label: "Contract map + wallet labels" },

  // Intelligence. Signals at :50s, after the minute's prices (:40s) and candles (:05s) have landed.
  { name: "signals:scan", everySec: 60, offsetSec: 50, category: "intelligence", label: "Signal rules over all 100 coins" },
  { name: "investigations:run", everySec: 60, offsetSec: 20, category: "intelligence", label: "Evidence + Claude brief for queued coins" },

  // Maintenance.
  { name: "ccxt:backfill", everySec: 3600, offsetSec: 120, category: "maintenance", label: "Candle history (missing only)" },
  { name: "cg:backfill", everySec: 3600, category: "maintenance", label: "30-day history (missing only)" },
  { name: "cg:gap-fill", everySec: 3600, offsetSec: 300, category: "maintenance", label: "Fill CoinGecko gaps (5-min)" },
  { name: "ccxt:futures-repair", everySec: 3600, offsetSec: 900, category: "maintenance", label: "Repair futures gaps (6h)" },
  { name: "cg:credit-guard", everySec: env.intervals.keyUsage, endpoint: "coingecko|/key", category: "maintenance", label: "Credit guard + system metrics" },
  { name: "ccxt:exchange-status", everySec: 300, offsetSec: 55, endpoint: "ccxt:binance|fetchStatus", category: "maintenance", label: "Exchange status" },
  { name: "maintenance:retention", everySec: 86400, category: "maintenance", label: "Daily cleanup" },
];

// Per-job time limit: frequent jobs normally finish in < 60s, daily jobs (100+ calls) in a few minutes.
export const jobTimeoutMs = (everySec: number) => (everySec <= 300 ? 240_000 : 1_200_000);

// Next wall-clock slot start for a job (slots are aligned to the epoch plus the job's offset).
export function nextRunAt(meta: Pick<JobMeta, "everySec" | "offsetSec">, now: number): number {
  const period = meta.everySec * 1000;
  const offset = (meta.offsetSec ?? 0) * 1000;
  return Math.floor((now - offset) / period) * period + period + offset;
}
