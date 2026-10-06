import type { Metadata } from "next";
import Link from "next/link";
import { Badge, C, Callout, DocPage, H2, H3, JsonBlock, P, Table } from "../_ui/kit";

export const metadata: Metadata = { title: "Core concepts", description: "Token ids, the response envelope, sources and as_of, unassessed values, verdicts, ids and proofs, errors and limits." };

export default function Concepts() {
  return (
    <DocPage href="/docs/concepts">
      <H2>Token ids</H2>
      <P>CoinGraph uses CoinGecko ids. Symbols and contract addresses work too, wherever a token is expected:</P>
      <Table
        head={["Token", "Id", "Symbol", "Contract (example)"]}
        rows={[
          ["Cardano", <C key="1">cardano</C>, <C key="2">ADA</C>, "native coin, no contract"],
          ["Chainlink", <C key="3">chainlink</C>, <C key="4">LINK</C>, <C key="5">0x514910771af9ca656af840dff83e8264ecf986ca</C>],
          ["Solana", <C key="6">solana</C>, <C key="7">SOL</C>, "native coin, no contract"],
        ]}
      />
      <P>The 100 largest tokens are tracked continuously. Use <Link href="/docs/api/tokens">search</Link> to find any of 21,000+ coins and see whether it is tracked.</P>

      <H2>The response envelope</H2>
      <P>Every API response, and every MCP tool result, has the same shape:</P>
      <JsonBlock value={{ object: "evaluation", id: "eval_cf5e78e040b79780a06e", as_of: "2026-10-06T22:36:20.000Z", data: { "…": "the answer" }, sources: [{ provider: "coingecko", endpoint: "/coins/markets", as_of: "2026-10-06T22:36:00.000Z" }, { provider: "nownodes", endpoint: "eth:eth_getLogs", as_of: "2026-10-06T22:30:00.000Z" }] }} />
      <Table
        head={["Field", "Meaning"]}
        rows={[
          [<C key="o">object</C>, "What kind of object this is: state, evaluation, brief, answer, agent_run…"],
          [<C key="i">id</C>, "Set for objects that go on the record (checks, answers, briefs, agent runs). Use it with Verify."],
          [<C key="a">as_of</C>, "When the data was true, not when you asked."],
          [<C key="d">data</C>, "The answer itself."],
          [<C key="s">sources</C>, "Every provider and endpoint the answer was built from, each with its own time."],
        ]}
      />

      <H2 id="unassessed">Unassessed, never guessed</H2>
      <P>
        When CoinGraph cannot measure something, the value is the string <C>&quot;unassessed&quot;</C>. For example, a token with no perpetual futures market has an unassessed <C>derivatives</C> section, and token unlock schedules are unassessed for every token because there is no free, reliable source. Your code should treat <C>unassessed</C> as “unknown”, not as zero or as safe.
      </P>

      <H2>Verdicts</H2>
      <H3>Checks</H3>
      <P>A check rates seven dimensions and the worst rating drives the verdict:</P>
      <Table
        head={["Verdict", "Meaning"]}
        rows={[
          [<Badge key="p" tone="good">proceed</Badge>, "No dimension flags a risk."],
          [<Badge key="c" tone="warn">caution</Badge>, "At least one dimension flags something worth knowing before you act."],
          [<Badge key="a" tone="bad">avoid</Badge>, "At least one dimension flags a serious risk: thin liquidity for the size, a dangerous contract, extreme concentration."],
        ]}
      />
      <Table
        head={["Dimension", "What is checked"]}
        rows={[
          ["momentum", "1-hour and 24-hour moves against the token's own volatility."],
          ["liquidity", "Depth within 2% across exchanges, size versus daily volume, best on-chain route."],
          ["leverage", "Funding, open interest growth, top-trader positioning."],
          ["onchain", "Net flows onto exchanges, very large transfers to exchanges."],
          ["supply", "Top-10 holder share, FDV versus market cap."],
          ["contract", "Admin powers on the home-chain contract: mint, pause, blacklist, owner balance changes, honeypot test, taxes."],
          ["context", "News bursts, TVL drops, market mood."],
        ]}
      />
      <H3>Agents</H3>
      <P>Agents answer in their own words, such as <Badge tone="good">ALLOW</Badge> <Badge tone="warn">REDUCE</Badge> <Badge tone="bad">BLOCK</Badge> for Trade Gatekeeper. Each agent page lists its verdicts.</P>

      <H2>Ids and proofs</H2>
      <Table
        head={["Prefix", "Object", "Created by"]}
        rows={[
          [<C key="e">eval_…</C>, "A check", <Link key="l1" href="/docs/api/evaluate">Evaluate</Link>],
          [<C key="a">ans_…</C>, "An answer or claim verdict", <Link key="l2" href="/docs/api/ask">Ask</Link>],
          [<C key="r">run_…</C>, "An agent run", <Link key="l3" href="/docs/agents">Agents</Link>],
          [<C key="n">46</C>, "A brief (a number)", <Link key="l4" href="/docs/api/explain">Explain</Link>],
        ]}
      />
      <P>Pass any id to <Link href="/docs/api/verify">Verify</Link>, or open <C>/proof/&#123;id&#125;</C> in a browser. See <Link href="/docs/proofs">Proofs & track record</Link>.</P>

      <H2>Errors</H2>
      <JsonBlock value={{ error: { code: "token_not_found", message: "No tracked token matches \"not-a-coin\". Try GET /v1/tokens?q=…" } }} />
      <Table
        head={["Status", "When", "Example codes"]}
        rows={[
          ["400", "The request is invalid", <C key="1">invalid_input, invalid_json, token_required, invalid_chain, invalid_address, question_or_claim</C>],
          ["401", "A monitor secret is missing or wrong", <C key="6">secret_required</C>],
          ["402", "Payment required (paid tiers, once x402 is live)", "x402 payment details in the body"],
          ["404", "Nothing matches", <C key="3">token_not_found, agent_not_found, no_brief, not_found</C>],
          ["413", "The body is over 16 KB", <C key="7">body_too_large</C>],
          ["429", "Too many requests, or the investigation queue is full", <C key="4">rate_limited, investigations_busy, busy</C>],
          ["5xx", "Something failed on our side", <C key="5">internal_error, investigation_failed</C>],
        ]}
      />

      <H2>Limits</H2>
      <Table
        head={["Limit", "Value"]}
        rows={[
          ["Requests", "60 per minute per caller. A 429 carries a Retry-After header."],
          ["Request body", "16 KB."],
          ["Fresh investigations and questions", "20 to 90 seconds each, limited per hour during the hackathon."],
          ["Agents", "Most runs take 2 to 20 seconds."],
        ]}
      />
      <Callout kind="tip">Responses for the same question are cached for a short time, so polling a state every few seconds is cheap but rarely useful. Use <Link href="/docs/api/monitor">monitors</Link> to be told when something changes.</Callout>
    </DocPage>
  );
}
