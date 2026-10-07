import { agentGet, agentRun, OPTIONS } from "@/lib/api/handlers";
import { AGENT_BY_ID } from "@/lib/agents/registry";
import { paid } from "@/lib/x402/server";

export { agentGet as GET, OPTIONS };

// Running an agent is paid: Premium (5 tADA) or Pro (10 tADA) depending on the agent.
export const POST = paid(agentRun, {
  group: "agents",
  description: "Run a CoinGraph agent",
  tier: async (_req, ctx) => (AGENT_BY_ID.get((await ctx.params).id)?.tier === "pro" ? "pro" : "premium"),
});
