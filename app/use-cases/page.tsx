import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { getCoverage } from "@/lib/site/data";
import { TONE_CHIP, toneOf } from "@/lib/site/verdict";
import { SectionHead, SiteFooter, SiteHeader } from "../_site/chrome";
import { CoverageStrip } from "../_site/coverage";

export const metadata: Metadata = {
  title: "Use cases — CoinGraph",
  description: "Who needs the check before they act: trading agents, AI wallets, DAO treasuries, funds, exchanges, research tools, compliance teams and traders, with real tokens and real verdicts.",
};

type Case = {
  id: string; who: string; tag: "Agents" | "Apps & businesses" | "People";
  need: string; moment: string;
  calls: { name: string; href: string }[];
  example: { ask: string; verdict: string; detail: string; href: string };
  pays: string;
};

// Every example below is a real CoinGraph answer captured from the live service (see /docs for the full runs).
const CASES: Case[] = [
  {
    id: "trading-agents", who: "Trading-agent developers", tag: "Agents",
    need: "A bot acts on exactly what it is given. If the only input is a price feed, it will buy into a thin book, a crowded trade or a token whose owner can freeze it.",
    moment: "Right before every order, and when sizing a position.",
    calls: [{ name: "Trade Gatekeeper", href: "/docs/agents/trade-gatekeeper" }, { name: "Leverage Radar", href: "/docs/agents/leverage-radar" }, { name: "POST /v1/evaluate", href: "/docs/api/evaluate" }],
    example: { ask: "Buy $10K of RAIN with a 0.25% impact limit", verdict: "REDUCE", detail: "Cut to about $6.1K: the best route would move the price 0.41%. A $5K SOL buy the same minute: ALLOW, under 0.01% impact.", href: "/docs/agents/trade-gatekeeper" },
    pays: "Per call with x402, 5 tADA, from the agent's own wallet. No account.",
  },
  {
    id: "ai-wallets", who: "AI wallets and wallet apps", tag: "Apps & businesses",
    need: "The most expensive mistakes happen at the signing step: a sanctioned recipient, a look-alike address, a token that can blacklist you after you buy.",
    moment: "When the user, or the wallet's assistant, is about to sign a swap or a send.",
    calls: [{ name: "Wallet Guard", href: "/docs/agents/wallet-guard" }, { name: "Portfolio Checkup", href: "/docs/agents/portfolio-checkup" }, { name: "GET /v1/inspect", href: "/docs/api/inspect" }],
    example: { ask: "Send $2K of USDC to 0x0330…e54a on Ethereum", verdict: "STOP", detail: "Recipient is on the OFAC sanctions list and flagged for a stealing attack. Swapping $5K into LINK to a Binance wallet: SAFE. PEPE: WARN, the contract can blacklist addresses and pause transfers.", href: "/docs/agents/wallet-guard" },
    pays: "Design-partner API key on a contract, plus signed webhooks for alerts.",
  },
  {
    id: "dao-treasuries", who: "DAO treasuries and vaults", tag: "Apps & businesses",
    need: "A treasury has rules (minimum liquidity, no mint authority, exit slippage caps) but no one checks them continuously, and governance votes carry no evidence.",
    moment: "Before a rebalancing vote, and on a schedule to catch drift.",
    calls: [{ name: "Treasury Steward", href: "/docs/agents/treasury-steward" }, { name: "Due Diligence Analyst", href: "/docs/agents/due-diligence-analyst" }, { name: "Proofs", href: "/docs/proofs" }],
    example: { ask: "Check a $20K treasury in ADA, LINK and SOL against four rules", verdict: "COMPLIANT", detail: "Every asset passes every rule, with a proof id per asset ready to attach to the proposal. Exit slippage priced on live order books.", href: "/docs/agents/treasury-steward" },
    pays: "Hire the Coworker on Sokosumi per Task, with escrow, or an API key.",
  },
  {
    id: "funds", who: "Funds and market makers", tag: "Apps & businesses",
    need: "Crowded leverage and whale flows move prices before the news does. Desks watch a dozen dashboards to see it; an alert with the reason attached is worth more.",
    moment: "Continuously, with a push when something crosses a threshold.",
    calls: [{ name: "Leverage Radar", href: "/docs/agents/leverage-radar" }, { name: "Whale Watch", href: "/docs/agents/whale-watch" }, { name: "Monitors & webhooks", href: "/docs/api/monitor" }],
    example: { ask: "Are whales moving LINK onto exchanges?", verdict: "NEUTRAL", detail: "Net flows within the normal range for the last 24 hours, exchange reserves flat, largest transfers profiled live. Futures crowding score 24/100 for ADA, balanced.", href: "/docs/agents/whale-watch" },
    pays: "Monitoring contract with an API key; webhooks signed with HMAC.",
  },
  {
    id: "exchanges", who: "Exchanges, brokers and listing desks", tag: "Apps & businesses",
    need: "Listing and onboarding decisions need a consistent, sourced memo, not a slide deck from the project. Contract powers and holder concentration are where surprises hide.",
    moment: "Listing review, periodic re-review, and incident response.",
    calls: [{ name: "Due Diligence Analyst", href: "/docs/agents/due-diligence-analyst" }, { name: "GET /v1/state (security section)", href: "/docs/api/state" }, { name: "Track record", href: "/docs/api/record" }],
    example: { ask: "Due diligence on Cardano", verdict: "B", detail: "Liquidity A ($63M within 2% of price across 25 markets), supply B, derivatives balanced, on-chain activity D. LEO, by contrast: the contract owner can change holders' balances.", href: "/docs/agents/due-diligence-analyst" },
    pays: "Enterprise API key; Pro runs at 10 tADA on testnet, $0.25 on mainnet.",
  },
  {
    id: "assistants", who: "Research tools and AI assistants", tag: "Apps & businesses",
    need: "Chatbots and research products get asked “why did SOL drop?” and either guess or paste a headline. A cited brief, with the on-chain evidence, is the honest answer.",
    moment: "Whenever a user asks about a token.",
    calls: [{ name: "MCP server (22 tools)", href: "/docs/mcp" }, { name: "GET /v1/explain", href: "/docs/api/explain" }, { name: "POST /v1/ask", href: "/docs/api/ask" }],
    example: { ask: "Are large holders moving ADA onto exchanges today?", verdict: "ANSWER", detail: "“The evidence shows no sign of it, but that doesn't prove it isn't happening”, with the exchange-flow numbers and their sources, and a claim about SOL futures being crowded marked contradicted.", href: "/docs/api/ask" },
    pays: "MCP is free during the preview; API by key or x402.",
  },
  {
    id: "compliance", who: "Risk and compliance teams", tag: "Apps & businesses",
    need: "Screening an address means stitching sanctions lists, scam databases and live chain data, and keeping an audit trail of what was known when.",
    moment: "Before onboarding a counterparty, and before any outbound transfer.",
    calls: [{ name: "GET /v1/inspect", href: "/docs/api/inspect" }, { name: "Wallet Guard", href: "/docs/agents/wallet-guard" }, { name: "GET /v1/verify", href: "/docs/api/verify" }],
    example: { ask: "Who is behind 5tzFkiKs…uAi9 on Solana?", verdict: "LABELLED", detail: "A Binance hot wallet, read live through NOWNodes, screened against OFAC and GoPlus flags. Every answer is fingerprinted, so the audit trail is the proof id.", href: "/docs/api/inspect" },
    pays: "API key on a contract.",
  },
  {
    id: "people", who: "Active traders and long-term holders", tag: "People",
    need: "People open six tabs every morning and still miss the unlock or the mint function. They want one page, and a check before they click buy.",
    moment: "Every morning, and before a trade.",
    calls: [{ name: "Daily Market Brief", href: "/docs/agents/daily-market-brief" }, { name: "Alert Watchtower", href: "/docs/agents/alert-watchtower" }, { name: "Ask in Claude", href: "/docs/mcp" }],
    example: { ask: "Today's market, with ADA, LINK and SOL as my holdings", verdict: "RISK_OFF", detail: "Market cap down 3.2% in 24 hours, 33% of the top 100 up, Fear & Greed 73, most crowded futures named. 7 alerts on the three holdings in the last 24 hours, each explained.", href: "/docs/agents/daily-market-brief" },
    pays: "Free playground and MCP now; subscription later.",
  },
  {
    id: "agents-hiring-agents", who: "Other AI agents", tag: "Agents",
    need: "An agent with a bigger job (run a portfolio, draft a report) needs a specialist it can hire, pay and trust without a contract.",
    moment: "Whenever its task touches a token or a wallet.",
    calls: [{ name: "Hire on Sokosumi", href: "/docs/sokosumi" }, { name: "x402 per call", href: "/docs/access#agent" }],
    example: { ask: "Hire CoinGraph Crypto Analyst: “Check LINK before I buy $5K”", verdict: "ALLOW", detail: "Paid 1 test USDM into Masumi escrow, result hash on chain, seller payout verified on Cardano. Or pay 5 tADA per call with x402 and get the same verdict in seconds.", href: "/docs/sokosumi" },
    pays: "Masumi escrow per Task, or x402 per call.",
  },
];

const TAG_TONE: Record<Case["tag"], string> = { Agents: "border-brand/40 bg-brand/10 text-brand", "Apps & businesses": "border-life/35 bg-life/10 text-life", People: "border-ember/35 bg-ember/10 text-ember" };

export default async function UseCases() {
  await connection();
  const coverage = await getCoverage();
  return (
    <>
      <SiteHeader />
      <main className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"><div className="hero-glow absolute inset-0" /><div className="dot-grid absolute inset-0 opacity-50" /></div>
        <section className="relative mx-auto max-w-6xl px-4 pt-16 pb-10 sm:px-8">
          <SectionHead eyebrow="Use cases" title="Who needs the check before they act," accent="and what they ask." lede="A person squints at a chart and double-checks. An agent acts on exactly what it is given. Every example below is a real CoinGraph answer on a real token." />
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              ["Agents", "Software that decides. Pays per call with x402, or hires the Coworker on Sokosumi."],
              ["Apps & businesses", "Products that embed the answer for their users. API key on a contract."],
              ["People", "Traders, holders and analysts. Free playground and Claude today."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-edge bg-slab p-4"><p className={`numerals inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${TAG_TONE[t as Case["tag"]]}`}>{t}</p><p className="mt-2 text-[13px] text-mist">{d}</p></div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-10 sm:px-8">
          <div className="grid gap-4 lg:grid-cols-2">
            {CASES.map((c) => (
              <article key={c.id} id={c.id} className="sv flex scroll-mt-24 flex-col rounded-2xl border border-edge bg-slab p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[19px] font-semibold tracking-tight">{c.who}</h2>
                  <span className={`numerals shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${TAG_TONE[c.tag]}`}>{c.tag}</span>
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-mist">{c.need}</p>
                <p className="mt-2 text-[13px] text-bone/85"><span className="text-mist">When:</span> {c.moment}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.calls.map((x) => <Link key={x.name} href={x.href} className="rounded-md border border-edge bg-ink px-2 py-1 text-[12px] text-bone/90 transition-colors hover:border-brand/40 hover:text-brand">{x.name}</Link>)}
                </div>
                <div className="mt-4 rounded-xl border border-edge bg-ink p-4">
                  <p className="text-[13px] text-mist">“{c.example.ask}”</p>
                  <p className="mt-2"><span className={`numerals inline-block rounded border px-2 py-0.5 text-[13px] font-bold uppercase ${TONE_CHIP[toneOf(c.example.verdict)] ?? "border-edge bg-slab text-bone"}`}>{c.example.verdict}</span></p>
                  <p className="mt-2 text-[13px] leading-relaxed text-bone/85">{c.example.detail}</p>
                  <Link href={c.example.href} className="mt-2 inline-block text-[12px] text-brand hover:underline">See the real run →</Link>
                </div>
                <p className="mt-3 text-[12.5px] text-mist"><span className="text-bone/80">Pays:</span> {c.pays}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-8">
          {coverage && <CoverageStrip c={coverage} />}
          <div className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl border border-edge bg-slab p-5">
              <p className="font-semibold">Why not build it yourself?</p>
              <p className="mt-2 text-[14px] leading-relaxed text-mist">One check needs CoinGecko for prices, seven exchanges for order books and futures, full nodes on five chains for flows and holders, GoPlus for contract powers, OFAC lists, DEX routers for real slippage, TVL and news. Ten schemas, ten clocks, ten rate limits, rebuilt and babysat by every team. CoinGraph does it once, keeps it fresh every minute to every hour, and returns one answer with every source named and a fingerprint you can verify.</p>
            </div>
            <div className="rounded-2xl border border-brand/30 bg-brand/[0.06] p-5">
              <p className="font-semibold">Try it in two minutes</p>
              <ol className="mt-2 space-y-1.5 text-[14px] text-bone/90">
                <li>1. <Link href="/agents" className="text-brand hover:underline">Run an agent</Link> on SOL, LINK or ADA.</li>
                <li>2. Open the proof link under the answer.</li>
                <li>3. <Link href="/docs/access" className="text-brand hover:underline">Pick your access path</Link>: x402, Sokosumi, a key, or MCP.</li>
              </ol>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
