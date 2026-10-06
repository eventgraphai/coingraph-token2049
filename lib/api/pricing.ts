// Pricing configuration. Final prices are still to be decided; the structure is in place so switching
// an endpoint from free to paid is a one-line change here and nothing else.

export type Phase = "hackathon" | "design-partner" | "commercial";
export const PHASE: Phase = (process.env.COINGRAPH_PHASE as Phase) ?? "hackathon";
export const ADA = 1_000_000; // lovelace

export type Price = { lovelace: number; label: string; description: string };

// Endpoints that require an x402 payment. Everything not listed is free. Empty until pricing is finalised.
export const PRICES: Record<string, Price> = {};

export const PASS_HOURS = 24;

export const PAYMENT = {
  network: process.env.CARDANO_NETWORK ?? "preprod",
  address: process.env.X402_SELLER_ADDRESS ?? null,
  facilitator: process.env.X402_FACILITATOR_URL ?? null,
};

export function priceFor(method: string, path: string): Price | null {
  return PRICES[`${method.toUpperCase()} ${path}`] ?? null;
}

export const PRICING_NOTES = {
  phase: PHASE,
  summary: "Reading CoinGraph is free. Prices for Decide calls (evaluate with size, fresh explain, ask) are being finalised and will be paid in ADA via x402; a Token Pass will cover 24h of Decide calls on one token.",
  free_rate_limit_per_minute: Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 60),
};
