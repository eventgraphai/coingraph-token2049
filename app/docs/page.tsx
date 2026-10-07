import type { Metadata } from "next";
import Link from "next/link";
import { Callout, Cards, DocPage, H2, P, Table, C } from "./_ui/kit";

export const metadata: Metadata = { title: { absolute: "CoinGraph Docs" }, description: "CoinGraph is the check before AI agents act: verified crypto intelligence over REST, MCP and ten ready-made agents." };

export default function Intro() {
  return (
    <DocPage href="/docs" title="CoinGraph documentation" lede="CoinGraph is the check before AI agents act. One call turns fragmented crypto data into a verified answer: every number sourced and timed, every verdict explained, every answer fingerprinted.">
      <Cards
        cols={3}
        items={[
          { title: "Quickstart", href: "/docs/quickstart", text: "Check Chainlink, ask Claude about Cardano, and run an agent on Solana. About two minutes.", tag: "Start here" },
          { title: "API reference", href: "/docs/api", text: "Twelve REST endpoints in five groups (discover, understand, decide, watch, trust) plus the agents route.", tag: "REST" },
          { title: "MCP server", href: "/docs/mcp", text: "Add CoinGraph to Claude, Claude Code or Cursor. 22 tools and 3 prompts.", tag: "MCP" },
          { title: "Agents", href: "/docs/agents", text: "Ten agents that each do a whole job, from pre-trade checks to due diligence.", tag: "10 agents" },
          { title: "Proofs & track record", href: "/docs/proofs", text: "How fingerprints, source lists and public grading make answers checkable.", tag: "Trust" },
          { title: "Pricing", href: "/docs/pricing", text: "Free, Data, Premium and Pro tiers, paid per call with x402 on Cardano.", tag: "x402" },
        ]}
      />

      <H2>What CoinGraph does</H2>
      <P>
        An agent about to buy $5K of SOL needs more than a price. It needs to know whether the order book can absorb the order, whether futures are crowded, whether coins are flowing onto exchanges, whether the contract has admin powers, and whether something in the news explains the move. That means stitching together exchanges, nodes, security scanners and news feeds, continuously.
      </P>
      <P>
        CoinGraph does that work once and returns one answer. It watches the 100 largest tokens around the clock, from BTC, ETH, SOL, XRP and ADA to LINK, DOGE, UNI and AVAX, reads five chains directly (Ethereum, BNB Chain, Bitcoin, Solana and Cardano), and answers on demand for any of 21,000+ coins, any address and any contract. See <Link href="/use-cases">who uses it and for what</Link>.
      </P>

      <H2>Three ways in</H2>
      <Table
        head={["Channel", "Best for", "Example"]}
        rows={[
          [<strong key="a">MCP server</strong>, "People and assistants: Claude, Claude Code, Cursor", "“Is it safe to buy $5K of LINK right now?”"],
          [<strong key="b">REST API</strong>, "Apps, bots and backends that need data and verdicts", <C key="c">GET /v1/evaluate/cardano</C>],
          [<strong key="d">Agents</strong>, "Whole jobs in one call, over REST or MCP", <C key="e">POST /v1/agents/trade-gatekeeper</C>],
        ]}
      />
      <P>All three return the same objects from the same engine, so an answer seen in Claude can be verified over the API.</P>

      <H2>Principles</H2>
      <Table
        head={["Principle", "What it means for you"]}
        rows={[
          ["Sourced", <>Every response lists its <C key="s">sources</C> and its <C key="a">as_of</C> time.</>],
          ["Honest about gaps", <>Anything not measured is the string <C key="u">&quot;unassessed&quot;</C>, never a guess. A new memecoin with no GoPlus report returns <C key="c">contract: &quot;unassessed&quot;</C>, so Trade Gatekeeper never says ALLOW on a contract it never read.</>],
          ["Checkable", "Checks, answers, briefs and agent runs carry an id. Its SHA-256 fingerprint proves what was said."],
          ["Graded in public", "Every call is compared with what the price did next, and the record is open."],
          ["Neutral", "CoinGraph never trades, holds funds or gives financial advice. The caller decides."],
        ]}
      />

      <Callout kind="tip" title="Base URLs">
        <p>REST: <C>https://token2049.coingraph.ai/api/v1</C> · MCP: <C>https://token2049.coingraph.ai/mcp</C> · OpenAPI: <C>/openapi.json</C> · For AI readers: <C>/llms.txt</C></p>
      </Callout>
    </DocPage>
  );
}
