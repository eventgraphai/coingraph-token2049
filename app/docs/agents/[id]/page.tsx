import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AGENT_BY_ID, AGENTS, TIER_PRICE } from "@/lib/agents/registry";
import { toneOf } from "@/lib/site/verdict";
import { AGENT_DOCS } from "../../_content/agents";
import { CodeTabs } from "../../_ui/client";
import { API, Badge, C, Callout, DocPage, Endpoint, Example, H2, P, Params, Table, UL, schemaParams } from "../../_ui/kit";

export const dynamicParams = false;
export function generateStaticParams() {
  return AGENTS.map((a) => ({ id: a.id }));
}
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const a = AGENT_BY_ID.get((await params).id);
  return a ? { title: `${a.name} · Agents`, description: `${a.tagline} ${a.description}`.slice(0, 300) } : {};
}

const TONE = { good: "good", warn: "warn", bad: "bad", neutral: "mist" } as const;

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const a = AGENT_BY_ID.get((await params).id);
  const d = a && AGENT_DOCS[a.id];
  if (!a || !d) notFound();
  const tool = `run_${a.id.replace(/-/g, "_")}`;
  const schema = z.toJSONSchema(a.input, { io: "input", unrepresentable: "any" }) as never;
  return (
    <DocPage href={`/docs/agents/${a.id}`} eyebrow="Agents" title={a.name} lede={a.tagline}>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-mist">
        <Badge tone="brand">{a.tier === "pro" ? "Pro" : "Premium"} · {TIER_PRICE[a.tier].tada} tADA</Badge>
        {a.masumi && <Badge tone="mist">Listed on Masumi</Badge>}
        <span>MCP tool <Link href={`/docs/mcp/tools#${tool}`}><C>{tool}</C></Link></span>
        <span>·</span>
        <Link href={`/agents#${a.id}`}>Run it in the playground →</Link>
      </div>
      <P>{a.description}</P>

      <H2>When to use it</H2>
      <UL>{d.useWhen.map((u) => <li key={u}>{u}</li>)}</UL>
      <P><span className="text-mist">Built for:</span> {a.persona.join(" · ")}</P>

      <H2>How it decides</H2>
      <UL>{d.decides.map((x, i) => <li key={i}>{x}</li>)}</UL>

      <H2>Verdicts</H2>
      <Table head={["Verdict", "Meaning"]} rows={a.verdicts.map((v) => [<Badge key={v} tone={TONE[toneOf(v)]}>{v}</Badge>, d.verdicts[v] ?? ""])} />

      <H2>Input</H2>
      <Endpoint method="POST" path={`/v1/agents/${a.id}`} />
      <Params rows={schemaParams(schema)} title="Body" />

      <H2>Examples</H2>
      <P>Real runs, captured from the live service.</P>
      {d.examples.map((ex) => <Example key={ex.key} id={ex.key} label={ex.label} />)}

      <H2>Result fields</H2>
      <P>Inside <C>data.result</C>:</P>
      <Table head={["Field", "Contents"]} rows={d.result.map(([k, v]) => [<C key="k">{k}</C>, v])} />
      {d.notes && <Callout kind="note">{d.notes}</Callout>}

      <H2>Use it from Claude</H2>
      <P>With CoinGraph connected (<Link href="/docs/mcp">how</Link>), ask in plain words, or call the tool directly:</P>
      <CodeTabs samples={[{ label: "MCP tools/call", code: JSON.stringify({ name: tool, arguments: (d.examples[0] && a.example) ? a.example : {} }, null, 2) }]} />
      <P>The proof for any run: <C>{API.replace("/api/v1", "")}/proof/run_…</C></P>
    </DocPage>
  );
}
