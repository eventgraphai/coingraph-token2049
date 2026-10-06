// Response shapes for the CoinGecko endpoints we ingest (only what our code reads directly;
// everything else is preserved in JSONB columns and the raw archive).

export type MarketCoin = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  fully_diluted_valuation: number | null;
  total_volume: number | null;
  high_24h: number | null;
  low_24h: number | null;
  price_change_24h: number | null;
  price_change_percentage_24h: number | null;
  market_cap_change_24h: number | null;
  market_cap_change_percentage_24h: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  ath: number | null;
  ath_change_percentage: number | null;
  ath_date: string | null;
  atl: number | null;
  atl_change_percentage: number | null;
  atl_date: string | null;
  roi: unknown;
  last_updated: string | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_14d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  price_change_percentage_200d_in_currency?: number | null;
  price_change_percentage_1y_in_currency?: number | null;
};

export type GlobalData = {
  data: {
    active_cryptocurrencies: number;
    upcoming_icos: number;
    ongoing_icos: number;
    ended_icos: number;
    markets: number;
    total_market_cap: Record<string, number>;
    total_volume: Record<string, number>;
    market_cap_percentage: Record<string, number>;
    market_cap_change_percentage_24h_usd: number;
    volume_change_percentage_24h_usd: number;
    updated_at: number;
  };
};

export type Category = {
  id: string;
  name: string;
  market_cap: number | null;
  market_cap_change_24h: number | null;
  content: string | null;
  top_3_coins_id: string[] | null;
  top_3_coins: string[] | null;
  volume_24h: number | null;
  updated_at: string | null;
};

export type TrendingItem = Record<string, unknown> & {
  id?: string | number;
  coin_id?: number;
  name?: string;
  symbol?: string;
  slug?: string;
  market_cap_rank?: number;
  score?: number;
  price_btc?: number;
  thumb?: string;
  small?: string;
  large?: string;
  market_cap_1h_change?: number;
  coins_count?: number;
  data?: Record<string, unknown> & {
    price?: number | string;
    market_cap?: number | string;
    total_volume?: number | string;
    price_change_percentage_24h?: Record<string, number>;
  };
};

export type Trending = {
  coins: { item: TrendingItem }[];
  nfts: TrendingItem[];
  categories: TrendingItem[];
  rwas?: TrendingItem[];
};

export type DerivativeTicker = {
  market: string;
  symbol: string;
  index_id: string;
  price: string | number | null;
  price_percentage_change_24h: number | null;
  contract_type: string | null;
  index: number | null;
  basis: number | null;
  spread: number | null;
  funding_rate: number | null;
  open_interest: number | null;
  volume_24h: number | null;
  last_traded_at: number | null;
  expired_at: number | string | null;
};

export type CoinListItem = { id: string; symbol: string; name: string; platforms?: Record<string, string> };

export type AssetPlatform = {
  id: string;
  chain_identifier: number | null;
  name: string;
  shortname: string;
  native_coin_id: string | null;
  image?: Record<string, string | null>;
};

export type OnchainNetworks = {
  data: { id: string; attributes: { name: string; coingecko_asset_platform_id: string | null } }[];
  links?: { next?: string | null };
};

export type CoinDetail = Record<string, unknown> & {
  id: string;
  symbol: string;
  name: string;
  web_slug?: string;
  asset_platform_id?: string | null;
  platforms?: Record<string, string>;
  detail_platforms?: Record<string, unknown>;
  block_time_in_minutes?: number;
  hashing_algorithm?: string | null;
  categories?: string[];
  description?: { en?: string };
  links?: Record<string, unknown>;
  image?: Record<string, string>;
  country_origin?: string;
  genesis_date?: string | null;
  listing_price?: number | null;
  listing_currency?: string | null;
  listing_timestamp?: string | number | null;
  listing_source?: string | null;
  listing_source_url?: string | null;
  contract_address?: string;
  preview_listing?: boolean;
  has_supply_breakdown?: boolean;
  public_notice?: string | null;
  additional_notices?: unknown[];
  status_updates?: unknown[];
  sentiment_votes_up_percentage?: number | null;
  sentiment_votes_down_percentage?: number | null;
  watchlist_portfolio_users?: number | null;
  market_cap_rank?: number | null;
  market_cap_rank_with_rehypothecated?: number | null;
  market_data?: Record<string, unknown>;
  community_data?: Record<string, unknown>;
  developer_data?: Record<string, unknown>;
  last_updated?: string;
};

export type MarketChart = {
  prices: [number, number][];
  market_caps: [number, number][];
  total_volumes: [number, number][];
};

export type KeyUsage = {
  plan: string;
  rate_limit_request_per_minute: number;
  monthly_call_credit: number;
  current_total_monthly_calls: number;
  current_remaining_monthly_calls: number;
};
