import type { Metadata } from "next";
import Link from "next/link";
import { listMcp } from "@/lib/docs/mcp";
import { C, Callout, DocPage, H2, P, Params } from "../../_ui/kit";

export const metadata: Metadata = { title: "MCP prompts", description: "Ready-made CoinGraph workflows that appear as slash commands in MCP clients." };

const EXAMPLES: Record<string, { args: string; agent: string; what: string }> = {
  pre_trade_check: { args: "token: solana · size_usd: 5000 · side: buy", agent: "trade-gatekeeper", what: "The decision in one line, the top three reasons with sources, the safe size if it says REDUCE, and the proof link. If the check mentions a brief, Claude also explains why the token moved." },
  wallet_safety_check: { args: "token: chainlink · amount_usd: 5000 · to_address: 0x28c6…1d60 · chain: eth", agent: "wallet-guard", what: "SAFE, WARN or STOP first, then the reasons in plain language. On STOP, a clear instruction not to sign." },
  token_due_diligence: { args: "token: cardano", agent: "due-diligence-analyst", what: "The overall grade, a table of section grades with their findings, red flags, strengths and the proof link, without adding facts that are not in the result." },
};

export default async function McpPrompts() {
  const { prompts } = await listMcp();
  return (
    <DocPage href="/docs/mcp/prompts" eyebrow="MCP server" title="Prompts" lede="Prompts are ready-made workflows. In clients that support them they appear as slash commands: pick one, fill in the blanks, and the assistant runs the right agent and presents the answer.">
      {prompts.map((p) => {
        const ex = EXAMPLES[p.name];
        return (
          <section key={p.name}>
            <H2 id={p.name}>{p.title ?? p.name}</H2>
            <P><C>{p.name}</C> · {p.description}</P>
            <Params title="Arguments" rows={(p.arguments ?? []).map((a) => ({ name: a.name, type: "string", required: a.required, description: a.description ?? "" }))} />
            {ex && (
              <>
                <P><strong>Example:</strong> <C>{ex.args}</C></P>
                <P><strong>You get:</strong> {ex.what} Runs <Link href={`/docs/agents/${ex.agent}`}>{ex.agent.replace(/-/g, " ")}</Link>.</P>
              </>
            )}
          </section>
        );
      })}
      <Callout kind="tip">Prompts are shortcuts. You can always ask in your own words; the assistant picks the same tools.</Callout>
    </DocPage>
  );
}
