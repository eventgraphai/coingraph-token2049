import Anthropic from "@anthropic-ai/sdk";
import { sql } from "../db";
import { gatherEvidence } from "../investigations/evidence";
import { BRIEF_MODEL } from "../investigations/brief";
import { canonical, newId, sha256, BASE_URL, type Token } from "./respond";

// POST /v1/ask: a question gets a cited answer; a claim gets supported / contradicted / unknown.

type QuestionOut = { answer: string; key_points: { text: string; evidence: string[] }[]; confidence: number; caveats: string[] };
type ClaimOut = { verdict: "supported" | "contradicted" | "unknown"; reasoning: { text: string; evidence: string[] }[]; confidence: number; caveats: string[] };

const SYSTEM = `You are CoinGraph's analyst. You answer questions and test claims about one crypto asset using only the evidence items (E1, E2, …) provided.
Rules: use only the evidence; cite evidence ids for every point; never invent numbers, news or wallets; if the evidence cannot answer, say so and use "unknown"; plain language for a trading agent; no buy/sell advice. Deliver the result by calling the tool.`;

export async function ask(token: Token, input: { question?: string; claim?: string }, hours = 4) {
  const mode = input.claim ? "claim" : "question";
  const text = (input.claim ?? input.question ?? "").trim().slice(0, 500);
  const evidence = await gatherEvidence(token.coingecko_id, new Date(Date.now() - hours * 3600_000), new Date(), []);
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const lines = evidence.items.map((e) => `${e.id} [${e.source}] ${e.summary}\n    data: ${JSON.stringify(e.data).slice(0, 1500)}`).join("\n");
  const point = { type: "object", properties: { text: { type: "string" }, evidence: { type: "array", items: { type: "string" } } }, required: ["text", "evidence"] } as const;
  const tool = mode === "claim"
    ? { name: "deliver_verdict", description: "Record the claim verdict.", input_schema: { type: "object" as const, properties: { verdict: { type: "string", enum: ["supported", "contradicted", "unknown"] }, reasoning: { type: "array", items: point }, confidence: { type: "number", minimum: 0, maximum: 1 }, caveats: { type: "array", items: { type: "string" } } }, required: ["verdict", "reasoning", "confidence", "caveats"] } }
    : { name: "deliver_answer", description: "Record the answer.", input_schema: { type: "object" as const, properties: { answer: { type: "string" }, key_points: { type: "array", items: point }, confidence: { type: "number", minimum: 0, maximum: 1 }, caveats: { type: "array", items: { type: "string" } } }, required: ["answer", "key_points", "confidence", "caveats"] } };
  const res = await client.messages.create({
    model: BRIEF_MODEL, max_tokens: 1500, system: SYSTEM, tools: [tool], tool_choice: { type: "auto" },
    messages: [{ role: "user", content: `Asset: ${evidence.name} (${evidence.symbol}). Evidence window: last ${hours} hours, gathered ${evidence.gathered_at}.\n\nEvidence:\n${lines}\n\n${mode === "claim" ? `Claim to test: "${text}"` : `Question: "${text}"`}\n\nCall the tool with your result.` }],
  });
  const call = res.content.find((c) => c.type === "tool_use");
  let out: QuestionOut | ClaimOut;
  if (call && call.type === "tool_use") out = call.input as QuestionOut | ClaimOut;
  else {
    const t = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b < 0) throw new Error("ask: model returned no structured result");
    out = JSON.parse(t.slice(a, b + 1).replace(/,\s*([}\]])/g, "$1"));
  }
  // Normalise: the response always has the full shape even if the model left a field out.
  const ids = new Set(evidence.items.map((e) => e.id));
  const clean = (pts: { text: string; evidence: string[] }[] | undefined) => (pts ?? []).map((p) => ({ ...p, evidence: (p.evidence ?? []).filter((e) => ids.has(e)) }));
  out.confidence = typeof out.confidence === "number" ? Math.max(0, Math.min(1, out.confidence)) : 0.5;
  out.caveats = Array.isArray(out.caveats) ? out.caveats : [];
  if (mode === "claim") {
    const c = out as ClaimOut;
    c.verdict = ["supported", "contradicted", "unknown"].includes(c.verdict) ? c.verdict : "unknown";
    c.reasoning = clean(c.reasoning);
  } else {
    const q = out as QuestionOut;
    q.answer = typeof q.answer === "string" ? q.answer : "";
    q.key_points = clean(q.key_points);
    if (!q.key_points.length && q.answer) q.key_points = q.answer.split(/(?<=\.)\s+/).slice(0, 4).map((s) => ({ text: s, evidence: [] }));
  }

  const id = newId("ans");
  const data = { token: { id: token.coingecko_id, symbol: token.symbol.toUpperCase(), name: token.name }, mode, input: text, ...out, evidence: evidence.items, model: res.model };
  const hash = sha256(canonical(data));
  // `evidence` stores the exact object that was hashed, so /verify can recompute the hash.
  await sql`insert into answers (id, coingecko_id, mode, input, answer, evidence, model, hash) values (${id}, ${token.coingecko_id}, ${mode}, ${text}, ${sql.json(out as never)}, ${sql.json(data as never)}, ${res.model}, ${hash})`;
  return { id, data: { ...data, hash, verify_url: `${BASE_URL}/api/v1/verify/${id}` }, sources: evidence.items.map((e) => ({ provider: e.source.split(":")[0], endpoint: e.source })) };
}
