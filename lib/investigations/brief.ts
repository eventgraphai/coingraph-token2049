import Anthropic from "@anthropic-ai/sdk";
import type { Evidence } from "./evidence";

// Claude turns gathered evidence into a brief. Every statement must cite evidence ids; the model is told
// it may only use what is in the evidence and to say so when the evidence does not explain the move.

export const BRIEF_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

export type Claim = { text: string; evidence: string[] };
export type Brief = {
  headline: string;
  direction: "bullish" | "bearish" | "neutral";
  severity: 1 | 2 | 3;
  confidence: number;
  summary: string;
  what_happened: Claim[];
  likely_causes: { cause: string; confidence: number; evidence: string[] }[];
  onchain: Claim[];
  market_context: Claim[];
  watch_next: string[];
  caveats: string[];
};

const SYSTEM = `You are CoinGraph's analyst. CoinGraph sells verified crypto market intelligence to AI agents.
You receive evidence items (E1, E2, …) gathered from CoinGecko, exchange APIs (Binance, OKX, Bybit…) and onchain data
(NOWNodes: Ethereum, BNB Chain, Bitcoin, Solana, Cardano) for one coin over a time window, and you write a brief.

Rules:
- Use only the evidence provided. Never invent numbers, events, news or wallets.
- Every statement in what_happened, likely_causes, onchain and market_context must cite the evidence ids it rests on.
- Separate what is observed (facts) from what is inferred (likely causes), and give honest confidence levels.
- If the evidence does not explain the move, say so plainly in likely_causes and caveats; do not speculate.
- Write for a trading agent: specific numbers, plain language, no hype, no advice to buy or sell.
- Direction is the pressure the evidence suggests on price (bullish / bearish / neutral); severity 1 (minor) to 3 (major).
- Deliver the brief by calling the write_brief tool.`;

// The brief is returned as a tool call, so the shape is enforced by the API rather than parsed from prose.
const claim = { type: "object", properties: { text: { type: "string" }, evidence: { type: "array", items: { type: "string" } } }, required: ["text", "evidence"] } as const;
const BRIEF_TOOL = {
  name: "write_brief",
  description: "Record the finished brief for this investigation.",
  input_schema: {
    type: "object" as const,
    properties: {
      headline: { type: "string", description: "One line, max 90 characters, specific, e.g. 'AAVE -6% as 41k AAVE hits Binance; longs liquidated'" },
      direction: { type: "string", enum: ["bullish", "bearish", "neutral"] },
      severity: { type: "integer", enum: [1, 2, 3] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      summary: { type: "string", description: "2-3 sentences in plain English" },
      what_happened: { type: "array", items: claim },
      likely_causes: { type: "array", items: { type: "object", properties: { cause: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, evidence: { type: "array", items: { type: "string" } } }, required: ["cause", "confidence", "evidence"] } },
      onchain: { type: "array", items: claim },
      market_context: { type: "array", items: claim },
      watch_next: { type: "array", items: { type: "string" } },
      caveats: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "direction", "severity", "confidence", "summary", "what_happened", "likely_causes", "onchain", "market_context", "watch_next", "caveats"],
  },
};

export async function writeBrief(evidence: Evidence): Promise<{ brief: Brief; model: string; usage: { input: number; output: number } }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing required env var ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey });

  const lines = evidence.items.map((e) => `${e.id} [${e.source}] ${e.summary}\n    data: ${JSON.stringify(e.data)}`).join("\n");
  const user = `Coin: ${evidence.name} (${evidence.symbol}, ${evidence.coingecko_id})
Window: ${evidence.window_from} → ${evidence.window_to} (UTC). Evidence gathered at ${evidence.gathered_at}.

Evidence:
${lines}

Write the brief by calling write_brief.`;

  const res = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 3000,
    system: SYSTEM,
    tools: [BRIEF_TOOL],
    tool_choice: { type: "auto" }, // forced tool choice is not supported on this model; the prompt asks for the call
    messages: [{ role: "user", content: user }],
  });
  const call = res.content.find((c) => c.type === "tool_use");
  let brief: Brief;
  if (call && call.type === "tool_use") {
    brief = call.input as Brief;
  } else {
    // Fallback: the model answered in text; take the JSON object out of it (trailing commas removed).
    const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end < 0) throw new Error(`brief: no write_brief call and no JSON (stop_reason ${res.stop_reason}): ${text.slice(0, 200)}`);
    brief = JSON.parse(text.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1")) as Brief;
  }
  if (!brief.headline || !brief.summary) throw new Error("brief: missing headline or summary");

  // Drop citations that do not exist, so a brief never points at evidence we do not have.
  const ids = new Set(evidence.items.map((e) => e.id));
  const clean = (claims: Claim[] | undefined) => (claims ?? []).map((c) => ({ ...c, evidence: (c.evidence ?? []).filter((id) => ids.has(id)) }));
  brief.what_happened = clean(brief.what_happened);
  brief.onchain = clean(brief.onchain);
  brief.market_context = clean(brief.market_context);
  brief.likely_causes = (brief.likely_causes ?? []).map((c) => ({ ...c, evidence: (c.evidence ?? []).filter((id) => ids.has(id)) }));

  return { brief, model: res.model, usage: { input: res.usage.input_tokens, output: res.usage.output_tokens } };
}
