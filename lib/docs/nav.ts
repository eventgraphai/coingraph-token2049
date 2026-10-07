// The documentation's information architecture: one list drives the sidebar, the search, the
// breadcrumbs and the previous/next links, so a page can't be orphaned.

export type DocLink = { href: string; title: string; description: string; badge?: string };
export type DocGroup = { title: string; links: DocLink[] };

const ENDPOINTS: DocLink[] = [
  { href: "/docs/api/tokens", title: "List & search tokens", description: "The 100 tracked tokens, or search 21,000+ by name, symbol or contract.", badge: "GET" },
  { href: "/docs/api/status", title: "Service status", description: "Pipeline health, data freshness, coverage and prices.", badge: "GET" },
  { href: "/docs/api/state", title: "Token state", description: "Everything known about a token right now, in sections.", badge: "GET" },
  { href: "/docs/api/history", title: "Token history", description: "Charts and events over time.", badge: "GET" },
  { href: "/docs/api/market", title: "Market overview", description: "The whole market: totals, sectors, breadth, sentiment, flows.", badge: "GET" },
  { href: "/docs/api/inspect", title: "Inspect an address", description: "Who is behind an address, read live from the chain.", badge: "GET" },
  { href: "/docs/api/evaluate", title: "Evaluate a token", description: "Proceed, caution or avoid, sized to your order and rules.", badge: "GET POST" },
  { href: "/docs/api/explain", title: "Explain a move", description: "Why a token moved: the cited brief.", badge: "GET POST" },
  { href: "/docs/api/ask", title: "Ask or check a claim", description: "A cited answer, or supported / contradicted / unknown.", badge: "POST" },
  { href: "/docs/api/monitor", title: "Monitors & webhooks", description: "Signed webhooks when signals fire or briefs are written.", badge: "POST" },
  { href: "/docs/api/record", title: "Track record", description: "Every call CoinGraph made and what happened next.", badge: "GET" },
  { href: "/docs/api/verify", title: "Verify a proof", description: "The exact object, its SHA-256 and the source calls.", badge: "GET" },
  { href: "/docs/api/agents", title: "Agents", description: "List agents and run one over REST.", badge: "GET POST" },
];

export const DOCS_NAV: DocGroup[] = [
  {
    title: "Get started",
    links: [
      { href: "/docs", title: "Introduction", description: "What CoinGraph is and the three ways to use it." },
      { href: "/docs/quickstart", title: "Quickstart", description: "Your first check in two minutes: API, Claude or an agent." },
      { href: "/docs/concepts", title: "Core concepts", description: "Token ids, the response envelope, sources, unassessed, verdicts and proofs." },
    ],
  },
  {
    title: "API reference",
    links: [{ href: "/docs/api", title: "Overview", description: "Base URL, requests, errors, limits and the endpoint index." }, ...ENDPOINTS],
  },
  {
    title: "MCP server",
    links: [
      { href: "/docs/mcp", title: "Connect", description: "Add CoinGraph to Claude, Claude Code, Cursor or any MCP client." },
      { href: "/docs/mcp/tools", title: "Tools", description: "All 22 tools, their inputs and when an assistant uses them." },
      { href: "/docs/mcp/prompts", title: "Prompts", description: "Ready-made workflows: pre-trade check, wallet safety, due diligence." },
    ],
  },
  {
    title: "Agents",
    links: [
      { href: "/docs/agents", title: "Overview", description: "Ten ready-made agents: how they work and how to call them." },
      { href: "/docs/sokosumi", title: "Hire on Sokosumi", description: "CoinGraph Crypto Analyst as a paid Masumi Coworker on Cardano." },
      { href: "/docs/agents/trade-gatekeeper", title: "Trade Gatekeeper", description: "ALLOW, REDUCE or BLOCK a trade of a given size." },
      { href: "/docs/agents/wallet-guard", title: "Wallet Guard", description: "SAFE, WARN or STOP before signing a swap or send." },
      { href: "/docs/agents/due-diligence-analyst", title: "Due Diligence Analyst", description: "A graded due-diligence memo on any token." },
      { href: "/docs/agents/opportunity-scout", title: "Opportunity Scout", description: "What's moving that passes the full check." },
      { href: "/docs/agents/leverage-radar", title: "Leverage Radar", description: "Crowding score for futures markets." },
      { href: "/docs/agents/whale-watch", title: "Whale Watch", description: "Are big wallets accumulating or distributing?" },
      { href: "/docs/agents/portfolio-checkup", title: "Portfolio Checkup", description: "A health grade for a wallet's holdings." },
      { href: "/docs/agents/treasury-steward", title: "Treasury Steward", description: "A treasury's rules, checked asset by asset." },
      { href: "/docs/agents/alert-watchtower", title: "Alert Watchtower", description: "Alerts on your tokens, each one explained." },
      { href: "/docs/agents/daily-market-brief", title: "Daily Market Brief", description: "The market on one readable page." },
    ],
  },
  {
    title: "Trust & billing",
    links: [
      { href: "/docs/proofs", title: "Proofs & track record", description: "How fingerprints, provenance and public grading work." },
      { href: "/docs/pricing", title: "Pricing & payments", description: "Tiers, x402 on Cardano and design-partner keys." },
    ],
  },
];

export const ALL_DOCS: (DocLink & { group: string })[] = DOCS_NAV.flatMap((g) => g.links.map((l) => ({ ...l, group: g.title })));

export function docMeta(href: string) {
  const i = ALL_DOCS.findIndex((d) => d.href === href);
  return { page: ALL_DOCS[i], prev: i > 0 ? ALL_DOCS[i - 1] : null, next: i >= 0 && i < ALL_DOCS.length - 1 ? ALL_DOCS[i + 1] : null };
}
