import type { Metadata } from "next";
import { AGENTS, TIER_PRICE } from "@/lib/agents/registry";
import { BASE_URL } from "@/lib/api/respond";
import { SectionHead, SiteFooter, SiteHeader } from "@/app/_site/chrome";
import { Playground, type AgentCard } from "@/app/_site/playground";

export const metadata: Metadata = {
  title: "Agents — CoinGraph",
  description: "Ten ready-made crypto agents: pre-trade checks, wallet safety, due diligence, crowding, whales, treasury rules. Run one here, from Claude, or from code.",
};

// Example inputs people can run with one click. The first one is the agent's own example.
const PRESETS: Record<string, [string, Record<string, unknown>][]> = {
  "trade-gatekeeper": [["Buy $5K of SOL", { token: "solana", size_usd: 5000, side: "buy" }], ["Sell $8K of LINK", { token: "chainlink", size_usd: 8000, side: "sell" }], ["Buy $10K of RAIN, max 0.25% impact", { token: "rain", size_usd: 10000, side: "buy", max_impact_pct: 0.25 }], ["Buy $10K of LEO", { token: "leo-token", size_usd: 10000, side: "buy" }]],
  "wallet-guard": [["Swap $5K into LINK, send to Binance", { token: "chainlink", amount_usd: 5000, to_address: "0x28c6c06298d514db089934071355e5743bf21d60", chain: "eth" }], ["Send to a sanctioned address", { to_address: "0x0330070fd38ec3bb94f58fa55d40368271e9e54a", chain: "eth" }], ["Swap $2K into ADA", { token: "cardano", amount_usd: 2000 }]],
  "due-diligence-analyst": [["Cardano", { token: "cardano" }], ["Chainlink", { token: "chainlink" }], ["Solana", { token: "solana" }]],
  "opportunity-scout": [["Top 3 setups", { limit: 3 }], ["Top 5 setups", { limit: 5 }]],
  "leverage-radar": [["SOL, ADA and LINK", { tokens: ["solana", "cardano", "chainlink"] }], ["Most crowded 5", { top: 5 }]],
  "whale-watch": [["Chainlink", { token: "chainlink" }], ["Cardano", { token: "cardano" }], ["Solana", { token: "solana" }]],
  "portfolio-checkup": [["Example wallet", { chain: "eth", address: "0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8" }], ["Uniswap DAO timelock", { chain: "eth", address: "0x1a9C8182C09F50C8318d769245beA52c32BE35BC" }]],
  "treasury-steward": [["$20K in ADA, LINK and SOL", { assets: [{ token: "cardano", value_usd: 9000 }, { token: "chainlink", value_usd: 6000 }, { token: "solana", value_usd: 5000 }], policy: { min_depth_usd: 500000, max_exit_slippage_pct: 1, allow_mint_authority: false, max_position_pct_of_market_cap: 0.5 } }]],
  "alert-watchtower": [["ADA, LINK and SOL", { tokens: ["cardano", "chainlink", "solana"], min_severity: 2 }], ["SOL, all alerts", { tokens: ["solana"], min_severity: 1 }]],
  "daily-market-brief": [["With ADA, LINK and SOL", { holdings: ["cardano", "chainlink", "solana"] }], ["Market only", {}]],
};

export default function AgentsPage() {
  const agents: AgentCard[] = AGENTS.map((a) => {
    const presets = PRESETS[a.id] ?? [];
    return {
      id: a.id, name: a.name, tagline: a.tagline, description: a.description, persona: a.persona, verdicts: a.verdicts,
      tier: a.tier, tada: TIER_PRICE[a.tier].tada, usd: TIER_PRICE[a.tier].usd, masumi: a.masumi,
      tool: `run_${a.id.replace(/-/g, "_")}`,
      presets: presets.length ? presets.map(([label, input]) => ({ label, input })) : [{ label: "Example", input: a.example as Record<string, unknown> }],
    };
  });
  return (
    <>
      <SiteHeader />
      <main className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[420px]">
          <div className="hero-glow absolute inset-0" />
          <div className="dot-grid absolute inset-0 opacity-50" />
        </div>
        <div className="relative mx-auto max-w-6xl px-4 pt-14 pb-24 sm:px-8">
          <SectionHead
            eyebrow="Ready-made agents"
            title="Ten agents."
            accent="Pick one and run it."
            lede="Each agent does a whole job in one call and returns a verdict, a plain summary, its reasons with sources, and a proof. Run them here, ask for them by name in Claude, or call them from code."
          />
          <Playground agents={agents} base={BASE_URL} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
