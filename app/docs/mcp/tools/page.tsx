import type { Metadata } from "next";
import Link from "next/link";
import { listMcp, type McpTool } from "@/lib/docs/mcp";
import { Badge, C, Callout, DocPage, H2, H3, P, Params, schemaParams } from "../../_ui/kit";

export const metadata: Metadata = { title: "MCP tools", description: "Every CoinGraph MCP tool: what it does, its inputs and the REST endpoint behind it." };

// Tools grouped the way an assistant would reach for them. Anything not listed lands in "Agents".
const GROUPS: { title: string; id: string; text: string; tools: string[] }[] = [
  { title: "Find and understand", id: "understand", text: "Read-only tools. Safe to call freely.", tools: ["search_tokens", "get_token_snapshot", "get_token_timeline", "get_market_overview", "lookup_address", "get_service_status"] },
  { title: "Decide", id: "decide", text: "Create an object with an id that goes on the public record.", tools: ["check_token", "get_token_brief", "ask_about_token"] },
  { title: "Watch", id: "watch", text: "Set up webhooks.", tools: ["watch_tokens"] },
  { title: "Trust", id: "trust", text: "The record and the proofs.", tools: ["get_track_record", "get_proof"] },
];
const REST: Record<string, string> = {
  search_tokens: "tokens", get_token_snapshot: "state", get_token_timeline: "history", get_market_overview: "market", lookup_address: "inspect", get_service_status: "status",
  check_token: "evaluate", get_token_brief: "explain", ask_about_token: "ask", watch_tokens: "monitor", get_track_record: "record", get_proof: "verify",
};

function Tool({ t }: { t: McpTool }) {
  const agentId = t.name.startsWith("run_") ? t.name.slice(4).replace(/_/g, "-") : null;
  const rows = schemaParams(t.inputSchema as never);
  return (
    <div className="my-6 rounded-xl border border-edge p-4">
      <H3 id={t.name} toc={t.name}><C>{t.name}</C></H3>
      <div className="-mt-1 mb-2 flex flex-wrap items-center gap-2 text-[12.5px] text-mist">
        <span className="font-medium text-bone">{t.title}</span>
        {t.annotations?.readOnlyHint ? <Badge tone="good">read-only</Badge> : <Badge tone="brand">creates a record</Badge>}
        {REST[t.name] && <Link href={`/docs/api/${REST[t.name]}`}>REST: {REST[t.name]}</Link>}
        {agentId && <Link href={`/docs/agents/${agentId}`}>Agent docs</Link>}
      </div>
      <p className="text-[14px] leading-relaxed text-bone/85">{(t.description ?? "").replace(/ Price: .*$/, "")}</p>
      {rows.length ? <Params rows={rows} title="Inputs" /> : <p className="mt-2 text-[13px] text-mist">No inputs.</p>}
    </div>
  );
}

export default async function McpTools() {
  const { tools } = await listMcp();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const grouped = new Set(GROUPS.flatMap((g) => g.tools));
  const agents = tools.filter((t) => !grouped.has(t.name));
  return (
    <DocPage href="/docs/mcp/tools" eyebrow="MCP server" title="Tools" lede={`${tools.length} tools: twelve that mirror the REST API and one per agent. Inputs below are generated from the live server definition.`}>
      <Callout kind="note">Every tool returns the same JSON as the REST API: <C>{"{ object, id, as_of, data, sources }"}</C>. Errors come back as a tool error with the same <C>{"{ error: { code, message } }"}</C> body.</Callout>
      {GROUPS.map((g) => (
        <section key={g.id}>
          <H2 id={g.id}>{g.title}</H2>
          <P>{g.text}</P>
          {g.tools.filter((n) => byName[n]).map((n) => <Tool key={n} t={byName[n]} />)}
        </section>
      ))}
      <H2 id="agents">Agents</H2>
      <P>One tool per agent. Each returns a verdict, a summary, a structured result, sourced reasons and a <C>run_…</C> id. See <Link href="/docs/agents">Agents</Link> for how each one decides.</P>
      {agents.map((t) => <Tool key={t.name} t={t} />)}
    </DocPage>
  );
}
