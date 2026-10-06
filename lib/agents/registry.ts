import { z } from "zod";
import type { AgentDef } from "./core";
import { tradeGatekeeper, opportunityScout, leverageRadar, whaleWatch } from "./trading";
import { walletGuard, portfolioCheckup, treasurySteward } from "./protect";
import { dueDiligenceAnalyst, alertWatchtower, dailyMarketBrief } from "./research";

// The 10 CoinGraph agents. Order = how they're listed in the catalog.
export const AGENTS: AgentDef[] = [
  tradeGatekeeper, walletGuard, dueDiligenceAnalyst, // flagship, on Masumi
  opportunityScout, leverageRadar, whaleWatch, portfolioCheckup, treasurySteward, alertWatchtower, dailyMarketBrief,
] as AgentDef[];

export const AGENT_BY_ID = new Map(AGENTS.map((a) => [a.id, a]));

// Testnet price per run in tADA, and the planned mainnet price in USD, by tier.
export const TIER_PRICE = { premium: { tada: 5, usd: 0.05 }, pro: { tada: 10, usd: 0.25 } } as const;

export function catalogEntry(a: AgentDef) {
  return {
    id: a.id, name: a.name, tagline: a.tagline, description: a.description, persona: a.persona, verdicts: a.verdicts,
    tier: a.tier, price: { testnet_tada: TIER_PRICE[a.tier].tada, mainnet_usd: TIER_PRICE[a.tier].usd },
    payment: a.masumi ? "x402 on Cardano (Masumi escrow)" : "x402 on Cardano (direct)",
    input_schema: z.toJSONSchema(a.input, { io: "input", unrepresentable: "any" }),
    example_input: a.example,
    endpoints: { run: `POST /api/v1/agents/${a.id}`, mcp_tool: `run_${a.id.replace(/-/g, "_")}`, cli: `npx tsx scripts/agent.ts ${a.id} '<json input>'` },
  };
}
