import type { Metadata } from "next";
import Link from "next/link";
import { CodeTabs } from "../_ui/client";
import { API, C, Callout, DocPage, H2, P, Request, Step, Steps, example, highlightJson } from "../_ui/kit";

export const metadata: Metadata = { title: "Quickstart", description: "Your first CoinGraph check in two minutes: over the API, in Claude, or with an agent." };

const MCP_URL = API.replace("/api/v1", "/mcp");

export default function Quickstart() {
  const ev = example("evaluate_get")?.response as { data?: { verdict?: string; confidence?: number; reasons?: unknown[]; dimensions?: Record<string, { rating: string }> }; id?: string } | undefined;
  const short = ev?.data ? JSON.stringify({ id: ev.id, verdict: ev.data.verdict, confidence: ev.data.confidence, dimensions: Object.fromEntries(Object.entries(ev.data.dimensions ?? {}).map(([k, v]) => [k, v.rating])) }, null, 2) : null;
  const caution = example("evaluate_get_caution")?.response as { data?: { verdict?: string; dimensions?: Record<string, { rating: string; reasons?: { text: string }[] }> }; id?: string } | undefined;
  const cautionShort = caution?.data ? JSON.stringify({ id: caution.id, verdict: caution.data.verdict, dimensions: Object.fromEntries(Object.entries(caution.data.dimensions ?? {}).map(([k, v]) => [k, v.rating])), reasons: Object.values(caution.data.dimensions ?? {}).filter((d) => d.rating !== "ok").flatMap((d) => (d.reasons ?? []).map((r) => r.text)) }, null, 2) : null;
  return (
    <DocPage href="/docs/quickstart">
      <P>No account or key is needed to start. Pick the path that fits you; each takes about two minutes.</P>

      <H2 id="api">1. Check a token over the API</H2>
      <Steps>
        <Step title="Ask whether Chainlink is safe to act on">
          <Request method="GET" path="/evaluate/chainlink" />
        </Step>
        <Step title="Read the verdict">
          <P>You get a verdict (<C>proceed</C>, <C>caution</C> or <C>avoid</C>), a rating per dimension, the reasons with their sources, and an id. This is the real response, shortened:</P>
          {short && <CodeTabs title="Response (shortened)" samples={[{ label: "JSON", code: short, node: highlightJson(short) }]} />}
          <P>The same call on PEPE, the same day, flags the contract: it can blacklist addresses and pause transfers. The verdict changes to <C>caution</C> and says why.</P>
          <Request method="GET" path="/evaluate/pepe" />
          {cautionShort && <CodeTabs title="Response (shortened, real)" samples={[{ label: "JSON", code: cautionShort, node: highlightJson(cautionShort) }]} />}
        </Step>
        <Step title="Size it to your order">
          <P>Add your order size and rules with <C>POST</C>. CoinGraph compares the order with order-book depth, daily volume and the best on-chain route.</P>
          <Request method="POST" path="/evaluate" body={{ token: "solana", size_usd: 5000, policy: { min_depth_usd: 1000000, max_funding_pct: 0.05 } }} />
          <P>Here <C>max_funding_pct: 0.05</C> means 0.05% per 8 hours, and <C>min_depth_usd</C> is the liquidity required within 2% of the price.</P>
        </Step>
        <Step title="Prove it later">
          <P>Every check has an id. Fetch its proof any time: the exact object, its SHA-256 fingerprint and the source calls behind it.</P>
          <Request method="GET" path={`/verify/${ev?.id ?? "eval_…"}`} />
        </Step>
      </Steps>

      <H2 id="claude">2. Ask in Claude (MCP)</H2>
      <Steps>
        <Step title="Add the connector">
          <P>In Claude (web or desktop): <strong>Settings → Connectors → Add custom connector</strong>, name it CoinGraph and paste the URL. In Claude Code, run:</P>
          <CodeTabs samples={[{ label: "Terminal", code: `claude mcp add --transport http coingraph ${MCP_URL}` }]} />
        </Step>
        <Step title="Ask in plain words">
          <P>Try: <em>“Is it safe to buy $5K of LINK right now? Use CoinGraph.”</em> or <em>“Are whales moving ADA onto exchanges today?”</em> Claude picks the right tool, shows the verdict with its sources, and links the proof.</P>
        </Step>
      </Steps>
      <Callout kind="note">Other clients (Cursor, Windsurf, custom agents) are covered in <Link href="/docs/mcp">Connect</Link>.</Callout>

      <H2 id="agent">3. Run an agent</H2>
      <P>Agents do a whole job in one call. Trade Gatekeeper decides whether a trade should go ahead:</P>
      <Request method="POST" path="/agents/trade-gatekeeper" body={{ token: "solana", size_usd: 5000, side: "buy" }} />
      <P>
        It answers <C>ALLOW</C>, <C>REDUCE</C> (with a safe size) or <C>BLOCK</C>, with the reasons. Copying that curl gives you HTTP 402: that is the payment prompt, not an error. Pay with x402 (5 tADA here), use a partner key (judges have one in the submission), or run it free in the <Link href="/agents">playground</Link> (10 Premium and 5 Pro runs a day). <Link href="/docs/access">Get access</Link> covers every path.
      </P>

      <H2 id="next">Next steps</H2>
      <ul className="my-3 list-disc space-y-1.5 pl-5">
        <li><Link href="/docs/concepts">Core concepts</Link>: token ids, the response envelope, <C>unassessed</C>, verdicts and proofs.</li>
        <li><Link href="/docs/api">API reference</Link>: every endpoint with real examples.</li>
        <li><Link href="/docs/agents">Agents</Link>: what each of the ten agents decides and how.</li>
      </ul>
    </DocPage>
  );
}
