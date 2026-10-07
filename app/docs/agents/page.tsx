import type { Metadata } from "next";
import Link from "next/link";
import { AGENTS, TIER_PRICE } from "@/lib/agents/registry";
import { toneOf } from "@/lib/site/verdict";
import { Badge, C, Callout, DocPage, H2, JsonBlock, P, Table } from "../_ui/kit";

export const metadata: Metadata = { title: "Agents", description: "Ten ready-made CoinGraph agents: what each decides, how to call them over REST or MCP, and what they cost." };

const GROUPS: [string, string[]][] = [
  ["Before you act", ["trade-gatekeeper", "wallet-guard", "due-diligence-analyst"]],
  ["Find and read the market", ["opportunity-scout", "leverage-radar", "whale-watch", "daily-market-brief"]],
  ["Look after holdings", ["portfolio-checkup", "treasury-steward", "alert-watchtower"]],
];

export default function AgentsOverview() {
  const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
  return (
    <DocPage href="/docs/agents" eyebrow="Agents" title="Agents" lede="Ten agents built on CoinGraph's data. Each does a whole job in one call, such as deciding whether a trade should go ahead, and returns a verdict you can act on, the reasons behind it, and a proof.">
      {GROUPS.map(([g, ids]) => (
        <section key={g}>
          <H2>{g}</H2>
          <Table
            head={["Agent", "What it answers", "Verdicts", "Price"]}
            rows={ids.map((id) => {
              const a = byId[id];
              return [
                <Link key="n" href={`/docs/agents/${a.id}`} className="font-medium">{a.name}</Link>,
                a.tagline,
                <span key="v" className="flex flex-wrap gap-1">{a.verdicts.map((v) => <Badge key={v} tone={({ good: "good", warn: "warn", bad: "bad", neutral: "mist" } as const)[toneOf(v)]}>{v}</Badge>)}</span>,
                <span key="p" className="numerals whitespace-nowrap text-[13px]">{TIER_PRICE[a.tier].tada} tADA</span>,
              ];
            })}
          />
        </section>
      ))}

      <H2>Every agent returns the same shape</H2>
      <JsonBlock value={{ object: "agent_run", id: "run_…", as_of: "2026-10-07T00:00:00Z", data: { run_id: "run_…", agent: "trade-gatekeeper", verdict: "ALLOW", summary: "One or two plain sentences.", result: { "…": "the structured answer, different per agent" }, reasons: [{ text: "Why, in one sentence", source: "provider:endpoint" }], warnings: ["Things to know that did not change the verdict"], duration_ms: 4120, hash: "sha256 of the stored run", verify_url: "https://token2049.coingraph.ai/api/v1/verify/run_…" }, sources: ["…"] }} />
      <P>The <C>summary</C> is written for a person. The <C>result</C> is for code. <C>reasons</C> carry their sources, and <C>verify_url</C> proves the run later.</P>

      <H2>Three ways to call an agent</H2>
      <Table
        head={["Channel", "How"]}
        rows={[
          ["REST", <><C>POST /v1/agents/&#123;id&#125;</C> with the agent&apos;s input as JSON. <Link href="/docs/api/agents">Reference</Link>.</>],
          ["MCP", <>One tool per agent, such as <C>run_trade_gatekeeper</C>, or the prompts <C>pre_trade_check</C>, <C>wallet_safety_check</C>, <C>token_due_diligence</C>.</>],
          ["Website", <>Click to run any agent in the <Link href="/agents">playground</Link>.</>],
        ]}
      />

      <H2>Pricing</H2>
      <Table head={["Tier", "Testnet", "Mainnet", "Agents"]} rows={[
        ["Premium", "5 tADA", "$0.05", "Trade Gatekeeper, Wallet Guard, Leverage Radar, Whale Watch, Alert Watchtower, Daily Market Brief"],
        ["Pro", "10 tADA", "$0.25", "Due Diligence Analyst, Opportunity Scout, Portfolio Checkup, Treasury Steward"],
      ]} />
      <Callout kind="note">
        <p>Agents pay per run with x402 on Cardano preprod (5 or 10 tADA); the website playground has a small daily allowance, and design partners use an API key. Trade Gatekeeper, Wallet Guard and Due Diligence Analyst can also be hired as a paid Coworker on Sokosumi, settled through Masumi escrow. See <Link href="/docs/pricing">Pricing & payments</Link> and <Link href="/docs/sokosumi">Hire on Sokosumi</Link>.</p>
      </Callout>
      <Callout kind="warn" title="Not advice">
        <p>Agents return information with its evidence. They never trade, hold funds or give financial advice; the caller decides.</p>
      </Callout>
    </DocPage>
  );
}
