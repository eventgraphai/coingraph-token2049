// Pricing: which calls are paid, what they cost, and how payment works (x402 on Cardano).
// Switching a route between free and paid is a one-line change in TIERS/ROUTE_TIER; nothing else moves.

export type Phase = "hackathon" | "design-partner" | "commercial";
export const PHASE: Phase = (process.env.COINGRAPH_PHASE as Phase) ?? "hackathon";
export const ADA = 1_000_000; // lovelace

export type Tier = "free" | "data" | "premium" | "pro";
export type TierInfo = { tier: Tier; tada: number; usd: number; free_per_day: number; label: string };

// Testnet prices in tADA (pure-lovelace x402 payments must clear Cardano's ~1 ADA minimum output), mainnet
// equivalents in USD. Data calls carry a daily free allowance; Premium and Pro carry a small website allowance.
export const TIERS: Record<Tier, TierInfo> = {
  free: { tier: "free", tada: 0, usd: 0, free_per_day: Infinity, label: "Free" },
  data: { tier: "data", tada: 2, usd: 0.01, free_per_day: 25, label: "Data" },
  premium: { tier: "premium", tada: 5, usd: 0.05, free_per_day: 10, label: "Premium" },
  pro: { tier: "pro", tada: 10, usd: 0.25, free_per_day: 5, label: "Pro" },
};

// Paid routes. Keys are "METHOD /v1/path" with {token}/{id} placeholders; everything not listed is free.
export const ROUTE_TIER: Record<string, Tier> = {
  "GET /v1/state/{token}": "data",
  "GET /v1/history/{token}": "data",
  "GET /v1/market": "data",
  "GET /v1/inspect/{chain}/{address}": "premium",
  "POST /v1/evaluate": "premium",
  "POST /v1/explain": "premium",
  "POST /v1/ask": "premium",
  "POST /v1/monitor": "premium",
  "POST /v1/agents/{id}": "premium", // Pro agents are priced per agent (see agent registry tier)
};

export const PAYMENT = {
  protocol: "x402",
  scheme: "exact",
  network: process.env.X402_NETWORK ?? "cardano:preprod",
  asset: "lovelace",
  address: process.env.X402_SELLER_ADDRESS ?? process.env.CARDANO_SELLER_ADDRESS ?? null,
  facilitator: process.env.X402_FACILITATOR_URL ?? null,
};

export const X402_ENABLED = Boolean(PAYMENT.address && PAYMENT.facilitator && process.env.X402_DISABLED !== "true");

export const lovelace = (tada: number) => String(Math.round(tada * ADA));

// Public pricing table (what /v1/status and the docs show).
export const PRICES = Object.fromEntries(
  Object.entries(ROUTE_TIER).map(([route, tier]) => [route, { tier, tada: TIERS[tier].tada, mainnet_usd: TIERS[tier].usd, free_per_day: TIERS[tier].free_per_day === Infinity ? null : TIERS[tier].free_per_day }]),
);

export const PRICING_NOTES = {
  phase: PHASE,
  payments_live: X402_ENABLED,
  summary: X402_ENABLED
    ? "Discover and Trust calls are free. Data calls (state, history, market) are free for 25 calls a day, then 2 tADA. Premium calls (sized checks, fresh briefs, questions, address lookups, monitors, most agents) are 5 tADA; Pro agents are 10 tADA. Paid calls answer 402 with x402 payment details on Cardano preprod; design partners use an API key instead."
    : "Reading CoinGraph is free during the preview. Paid tiers switch on with x402 on Cardano.",
  free_rate_limit_per_minute: Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 60),
  tiers: Object.values(TIERS).map((t) => ({ tier: t.tier, testnet_tada: t.tada, mainnet_usd: t.usd, free_per_day: t.free_per_day === Infinity ? null : t.free_per_day })),
};
