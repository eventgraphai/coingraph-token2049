import ccxt, { type Exchange } from "ccxt";

// One shared, rate-limited client per venue. 'binance' = spot, 'binanceusdm' = USDⓈ-M perpetual futures.
export type Venue = "binance" | "binanceusdm" | "okx" | "coinbase" | "bybit" | "gate" | "kraken";
export type MarketType = "spot" | "swap";

const clients = new Map<Venue, Exchange>();

export function exchange(venue: Venue): Exchange {
  let ex = clients.get(venue);
  if (!ex) {
    const Ctor = (ccxt as unknown as Record<string, new (cfg: object) => Exchange>)[venue];
    ex = new Ctor({ enableRateLimit: true, timeout: 30_000 });
    clients.set(venue, ex);
  }
  return ex;
}

// Venues we map tokens on, in primary-preference order per market type, with accepted quote currencies.
// Bybit / Gate / Kraken come last: they become primary only for tokens the larger venues don't list
// (e.g. exchange tokens like MNT, GT, KCS, BGB, WBT).
export const VENUES: { venue: Venue; type: MarketType; quotes: string[] }[] = [
  { venue: "binance", type: "spot", quotes: ["USDT", "USDC", "FDUSD"] },
  { venue: "okx", type: "spot", quotes: ["USDT", "USDC"] },
  { venue: "coinbase", type: "spot", quotes: ["USD", "USDC"] },
  { venue: "bybit", type: "spot", quotes: ["USDT", "USDC"] },
  { venue: "gate", type: "spot", quotes: ["USDT", "USDC"] },
  { venue: "kraken", type: "spot", quotes: ["USD", "USDT", "USDC"] },
  { venue: "binanceusdm", type: "swap", quotes: ["USDT", "USDC"] },
  { venue: "okx", type: "swap", quotes: ["USDT", "USDC"] },
  { venue: "bybit", type: "swap", quotes: ["USDT", "USDC"] },
];

// fetchTickers for one market type on a venue (OKX and Bybit serve spot and swap from one client).
export function fetchTickersFor(venue: Venue, type: MarketType) {
  const ex = exchange(venue);
  return venue === "okx" || venue === "bybit" || venue === "gate" ? ex.fetchTickers(undefined, { type }) : ex.fetchTickers();
}
