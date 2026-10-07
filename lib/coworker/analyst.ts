import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { BASE_URL } from "../api/respond";
import { runAgent, type AgentDef } from "../agents/core";
import { AGENTS, AGENT_BY_ID } from "../agents/registry";
import { BRIEF_MODEL } from "../investigations/brief";

// The CoinGraph Coworker's brain. A Task arrives as plain language ("Check LINK before I buy $5K"); Claude picks
// which CoinGraph agent(s) to run and with what input, the agents run on live data (each run stored with a proof),
// and the result is written up for the person who asked. Claude only routes; every fact in the answer comes from
// the agent runs.

const MAX_CALLS = 3;

const ROUTER_SYSTEM = `You are the dispatcher for CoinGraph Crypto Analyst, an AI coworker that checks crypto tokens and wallets before people act.
Read the request and choose which CoinGraph agents to run, with valid inputs. Use only the agents below. Prefer the single best agent; use up to ${MAX_CALLS} only when the request clearly asks for several things.
Token ids are CoinGecko ids (cardano, chainlink, solana, bitcoin, ethereum…); symbols such as ADA or LINK are also accepted.
If an amount is missing for a trade check, use 1000 USD and say so. If the request is not about crypto tokens, wallets or the crypto market, return no calls and a short clarifying question.
Never invent prices or facts: you only route.`;

const routeTool = {
  name: "route",
  description: "Choose the CoinGraph agents to run for this request.",
  input_schema: {
    type: "object" as const,
    properties: {
      calls: {
        type: "array",
        maxItems: MAX_CALLS,
        items: {
          type: "object",
          properties: {
            agent: { type: "string", enum: AGENTS.map((a) => a.id) },
            input: { type: "object", description: "The agent's input, matching its schema." },
            why: { type: "string", description: "One short line: why this agent." },
          },
          required: ["agent", "input"],
        },
      },
      assumptions: { type: "array", items: { type: "string" }, description: "Assumptions made, e.g. a default amount." },
      clarify: { type: "string", description: "Only when no agent fits: a short question back to the requester." },
    },
    required: ["calls"],
  },
};

type Plan = { calls: { agent: string; input: Record<string, unknown>; why?: string }[]; assumptions?: string[]; clarify?: string };

function catalog(): string {
  return AGENTS.map((a) => `- ${a.id}: ${a.tagline} Verdicts ${a.verdicts.join("/")}. Input schema: ${JSON.stringify(z.toJSONSchema(a.input, { io: "input", unrepresentable: "any" }))}. Example: ${JSON.stringify(a.example)}`).join("\n");
}

async function plan(request: string, feedback?: string): Promise<Plan> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 2000,
    system: `${ROUTER_SYSTEM}\n\nAgents:\n${catalog()}`,
    tools: [routeTool],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: `Request:\n<<<\n${request.slice(0, 8000)}\n>>>${feedback ? `\n\nYour previous plan was invalid: ${feedback}. Fix the inputs.` : ""}\n\nCall the route tool.` }],
  });
  const call = res.content.find((c) => c.type === "tool_use");
  if (!call || call.type !== "tool_use") throw new Error("router returned no plan");
  const p = call.input as Plan;
  return { calls: Array.isArray(p.calls) ? p.calls.slice(0, MAX_CALLS) : [], assumptions: p.assumptions ?? [], clarify: p.clarify };
}

function validate(p: Plan): { ok: { def: AgentDef; input: unknown; why?: string }[]; errors: string[] } {
  const ok: { def: AgentDef; input: unknown; why?: string }[] = [];
  const errors: string[] = [];
  for (const c of p.calls) {
    const def = AGENT_BY_ID.get(c.agent);
    if (!def) { errors.push(`unknown agent ${c.agent}`); continue; }
    const parsed = def.input.safeParse(c.input ?? {});
    if (parsed.success) ok.push({ def, input: parsed.data, why: c.why });
    else errors.push(`${c.agent}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`);
  }
  return { ok, errors };
}

type Run = Awaited<ReturnType<typeof runAgent>>["run"];

function section(def: AgentDef, run: Run): string {
  const lines = [`## ${def.name}: **${run.verdict}**`, "", run.summary, ""];
  const r = run.result as Record<string, unknown>;
  if (def.id === "due-diligence-analyst" && Array.isArray(r.sections)) {
    lines.push("| Section | Grade | Key finding |", "|---|---|---|");
    for (const s of r.sections as { name: string; grade: string; findings?: string[] }[]) lines.push(`| ${s.name} | ${s.grade} | ${(s.findings?.[0] ?? "").replace(/\|/g, "/")} |`);
    lines.push("");
    const red = (r.red_flags as string[] | undefined) ?? [];
    if (red.length) lines.push(`**Red flags:** ${red.join("; ")}`, "");
  }
  if (def.id === "daily-market-brief" && typeof r.markdown === "string") lines.push(r.markdown, "");
  if (run.reasons?.length) {
    lines.push("**Why**");
    for (const x of run.reasons.slice(0, 6)) lines.push(`- ${x.text}${x.source ? ` _(${x.source})_` : ""}`);
    lines.push("");
  }
  if (run.warnings?.length) lines.push(`**Watch:** ${run.warnings.slice(0, 4).join(" · ")}`, "");
  lines.push(`Proof: ${BASE_URL}/proof/${run.run_id}`, "");
  return lines.join("\n");
}

export type AnalystResult = { text: string; runIds: string[]; agents: string[] };

// Runs a plain-language request end to end and returns the write-up (UTF-8, well under Sokosumi's 1 MiB limit).
export async function analyze(request: string, requester: string): Promise<AnalystResult> {
  let p = await plan(request);
  let { ok, errors } = validate(p);
  if (errors.length && !ok.length) {
    p = await plan(request, errors.join(" | "));
    ({ ok, errors } = validate(p));
  }
  if (!ok.length) {
    const ask = p.clarify ?? "Which token or wallet should I check, and for what (a trade of a given size, a send to an address, or due diligence)?";
    return { text: `# CoinGraph Crypto Analyst\n\nI couldn't map this request to a check yet. ${ask}\n\nExamples: "Check LINK before I buy $5K", "Is 0x28c6c06298d514db089934071355e5743bf21d60 safe to send to on Ethereum?", "Due diligence on Cardano".\n`, runIds: [], agents: [] };
  }
  const parts: string[] = ["# CoinGraph Crypto Analyst", ""];
  if (p.assumptions?.length) parts.push(`_Assumptions: ${p.assumptions.join("; ")}_`, "");
  const runIds: string[] = [];
  for (const { def, input } of ok) {
    try {
      const { run } = await runAgent(def, input, { requester });
      runIds.push(run.run_id);
      parts.push(section(def, run));
    } catch (e) {
      parts.push(`## ${def.name}\n\nThis check could not complete: ${(e as Error).message.slice(0, 200)}\n`);
    }
  }
  parts.push("---", `Sources: live exchange order books, on-chain data via NOWNodes, GoPlus contract security, OFAC lists, futures and news, as of ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Every check above has a SHA-256 proof at its link.`, "", "_CoinGraph never trades, holds funds or gives financial advice. You decide._");
  return { text: parts.join("\n"), runIds, agents: ok.map((o) => o.def.id) };
}
