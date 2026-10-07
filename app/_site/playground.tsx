"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { label, TONE_CHIP, TONE_TEXT, toneOf } from "@/lib/site/verdict";
import { CopyButton } from "./copy";

export type AgentCard = {
  id: string; name: string; tagline: string; description: string; persona: string[]; verdicts: string[];
  tier: string; tada: number; usd: number; masumi: boolean; tool: string;
  presets: { label: string; input: Record<string, unknown> }[];
};

type Run = {
  run_id: string; agent: string; verdict: string; summary: string; duration_ms?: number;
  result?: Record<string, unknown>; reasons?: { text: string; source?: string }[]; warnings?: string[];
  links?: Record<string, string>; hash?: string;
};

type State = { status: "idle" } | { status: "running"; started: number } | { status: "done"; run: Run; ms: number } | { status: "error"; message: string };

export function Playground({ agents, base }: { agents: AgentCard[]; base: string }) {
  const [id, setId] = useState(agents[0].id);
  const agent = useMemo(() => agents.find((a) => a.id === id) ?? agents[0], [agents, id]);
  const [input, setInput] = useState(() => JSON.stringify(agents[0].presets[0].input, null, 2));
  const [state, setState] = useState<State>({ status: "idle" });
  const [tab, setTab] = useState<"web" | "claude" | "api">("web");
  const [elapsed, setElapsed] = useState(0);

  // Deep links: /agents#wallet-guard opens that agent.
  useEffect(() => {
    const pick = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      const a = agents.find((x) => x.id === h);
      if (a) choose(a);
    };
    pick();
    window.addEventListener("hashchange", pick);
    return () => window.removeEventListener("hashchange", pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.status !== "running") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - state.started) / 100) / 10), 100);
    return () => clearInterval(t);
  }, [state]);

  function choose(a: AgentCard) {
    setId(a.id);
    setInput(JSON.stringify(a.presets[0].input, null, 2));
    setState({ status: "idle" });
  }

  let parsed: Record<string, unknown> | null = null;
  let parseError = "";
  try {
    const v = JSON.parse(input || "{}");
    if (v && typeof v === "object" && !Array.isArray(v)) parsed = v;
    else parseError = "Input must be a JSON object.";
  } catch {
    parseError = "Input is not valid JSON.";
  }

  async function run() {
    if (!parsed) return;
    const started = Date.now();
    setElapsed(0);
    setState({ status: "running", started });
    try {
      const res = await fetch(`/api/v1/agents/${agent.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed) });
      const js = await res.json().catch(() => null);
      if (!res.ok || !js?.data) {
        const msg = js?.error?.message ?? `The agent answered ${res.status}.`;
        setState({ status: "error", message: res.status === 402 ? `Payment required: ${msg}` : res.status === 429 ? "Too many runs from this connection. Wait a minute and try again." : msg });
        return;
      }
      setState({ status: "done", run: js.data as Run, ms: Date.now() - started });
    } catch {
      setState({ status: "error", message: "Could not reach CoinGraph. Check your connection and try again." });
    }
  }

  const body = parsed ? JSON.stringify(parsed) : "{}";
  const curl = `curl -X POST ${base}/api/v1/agents/${agent.id} \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`;
  const ask = askInClaude(agent, parsed ?? {});

  return (
    <div className="mt-12 grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Agent list */}
      <nav aria-label="Agents" className="grid content-start gap-2 sm:grid-cols-2 lg:grid-cols-1">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => {
              history.replaceState(null, "", `#${a.id}`);
              choose(a);
              if (window.innerWidth < 1024) requestAnimationFrame(() => document.getElementById(a.id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }}
            className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${a.id === agent.id ? "border-brand/60 bg-brand/[0.07]" : "border-edge bg-slab hover:border-brand/30 hover:bg-slab-raised"}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className={`text-[14px] font-semibold ${a.id === agent.id ? "text-brand" : "text-bone"}`}>{a.name}</span>
              <span className="numerals text-[10px] text-mist">{a.tada} tADA</span>
            </span>
            <span className="mt-0.5 block text-[12px] leading-snug text-mist">{a.tagline}</span>
          </button>
        ))}
      </nav>

      {/* Selected agent */}
      <section id={agent.id} aria-live="polite" className="min-w-0 scroll-mt-24 rounded-2xl border border-edge bg-slab p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[24px] font-semibold tracking-tight">{agent.name}</h2>
            <p className="mt-1 text-[15px] text-brand">{agent.tagline}</p>
          </div>
          <div className="text-right">
            <p className="numerals text-[18px] font-semibold">{agent.tada} tADA <span className="text-[12px] font-normal text-mist">per run</span></p>
            <p className="text-[11px] text-mist">{agent.tier} · mainnet ${agent.usd.toFixed(2)}{agent.masumi ? " · hire on Sokosumi" : ""}</p>
          </div>
        </div>
        <p className="mt-4 max-w-3xl text-[14px] leading-relaxed text-mist">{agent.description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-mist">Answers</span>
          {agent.verdicts.map((v) => <span key={v} className={`numerals rounded border px-1.5 py-0.5 text-[11px] ${TONE_CHIP[toneOf(v)]}`}>{label(v)}</span>)}
          <span className="ml-2 text-mist">For</span>
          {agent.persona.map((p) => <span key={p} className="rounded-full border border-edge bg-ink px-2 py-0.5 text-[11px] text-bone/80">{p}</span>)}
        </div>

        <div className="mt-6 flex gap-1 border-b border-edge text-[13px]">
          {([["web", "Run it here"], ["claude", "In Claude (MCP)"], ["api", "From code (API)"]] as const).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 transition-colors ${tab === k ? "border-brand text-bone" : "border-transparent text-mist hover:text-bone"}`}>{t}</button>
          ))}
        </div>

        {tab === "web" && (
          <div className="mt-5">
            <p className="text-[12px] text-mist">Try an example</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {agent.presets.map((p) => (
                <button key={p.label} type="button" onClick={() => { setInput(JSON.stringify(p.input, null, 2)); setState({ status: "idle" }); }}
                  className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${input === JSON.stringify(p.input, null, 2) ? "border-brand/50 bg-brand/10 text-brand" : "border-edge bg-ink text-bone/90 hover:border-brand/30"}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <label className="mt-4 block text-[12px] text-mist" htmlFor="agent-input">Input (JSON, editable)</label>
            <textarea
              id="agent-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
              rows={Math.min(12, Math.max(3, input.split("\n").length))}
              className="numerals mt-1.5 w-full resize-y rounded-lg border border-edge bg-ink px-3 py-2.5 text-[12.5px] leading-relaxed text-bone focus:border-brand/60 focus:outline-none"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={run} disabled={!parsed || state.status === "running"} className="btn-glow rounded-lg bg-brand px-5 py-2 text-[14px] font-semibold text-brand-ink disabled:opacity-50">
                {state.status === "running" ? `Running… ${elapsed.toFixed(1)}s` : `Run ${agent.name}`}
              </button>
              {parseError ? <span className="text-[12px] text-blood">{parseError}</span> : <span className="text-[12px] text-mist">Free to try during the hackathon preview. Most runs take 2 to 20 seconds.</span>}
            </div>
            <Result state={state} />
          </div>
        )}

        {tab === "claude" && (
          <div className="mt-5 space-y-4 text-[14px] text-mist">
            <p>1. Add CoinGraph to Claude once. In Claude settings, add a custom connector with this URL. In Claude Code, run the command below.</p>
            <CodeLine text={`${base}/mcp`} />
            <CodeLine text={`claude mcp add --transport http coingraph ${base}/mcp`} />
            <p>2. Ask in plain words. Claude picks the <span className="numerals text-bone">{agent.tool}</span> tool and explains the answer with its proof.</p>
            <div className="rounded-xl border border-brand/30 bg-brand/[0.06] p-4 text-[15px] text-bone">“{ask}”</div>
          </div>
        )}

        {tab === "api" && (
          <div className="mt-5 space-y-3">
            <div className="overflow-hidden rounded-xl border border-edge bg-ink">
              <div className="flex items-center justify-between border-b border-edge px-3 py-2">
                <span className="numerals text-[11px] uppercase tracking-[0.12em] text-mist">POST /api/v1/agents/{agent.id}</span>
                <CopyButton text={curl} />
              </div>
              <pre className="numerals overflow-x-auto px-4 py-3 text-[12.5px] leading-relaxed text-bone/90">{curl}</pre>
            </div>
            <p className="text-[13px] text-mist">
              The reply is <span className="numerals text-bone">{"{ object: \"agent_run\", data: { verdict, summary, result, reasons, run_id, verify_url } }"}</span>. Input schemas for every agent are at{" "}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- JSON API route, not a page */}
              <a href="/api/v1/agents" className="text-brand hover:underline">/api/v1/agents</a>.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function CodeLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-edge bg-ink px-3 py-2">
      <code className="numerals min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[12.5px] text-bone">{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

function askInClaude(a: AgentCard, i: Record<string, unknown>): string {
  const t = (i.token as string) ?? "chainlink";
  switch (a.id) {
    case "trade-gatekeeper": return `Before I ${i.side ?? "buy"} $${Number(i.size_usd ?? 5000).toLocaleString("en")} of ${t}, run CoinGraph's Trade Gatekeeper. Should I go ahead?`;
    case "wallet-guard": return `I'm about to send funds to ${i.to_address ?? "this address"}. Is it safe? Check it with CoinGraph's Wallet Guard.`;
    case "due-diligence-analyst": return `Give me a due-diligence memo on ${t} using CoinGraph.`;
    case "opportunity-scout": return "What's moving in crypto right now that's actually safe to act on? Use CoinGraph's Opportunity Scout.";
    case "leverage-radar": return "Which crypto futures markets are most crowded right now? Use CoinGraph's Leverage Radar.";
    case "whale-watch": return `What are the whales doing with ${t}? Use CoinGraph's Whale Watch.`;
    case "portfolio-checkup": return `Give this wallet a health check with CoinGraph: ${i.address ?? "0x…"}`;
    case "treasury-steward": return "Check our treasury against our rules with CoinGraph's Treasury Steward.";
    case "alert-watchtower": return `Any alerts on ${((i.tokens as string[]) ?? ["cardano", "chainlink", "solana"]).join(", ")}? Explain each one with CoinGraph.`;
    default: return "Give me today's crypto market brief from CoinGraph.";
  }
}

function Result({ state }: { state: State }) {
  if (state.status === "idle") return null;
  if (state.status === "running")
    return (
      <div className="mt-6 rounded-xl border border-edge bg-ink p-5 text-[13px] text-mist">
        <span className="throb mr-2 inline-block h-2 w-2 rounded-full bg-brand text-brand" />
        Reading order books, chains, contracts and news…
      </div>
    );
  if (state.status === "error") return <div className="mt-6 rounded-xl border border-blood/40 bg-blood/10 p-4 text-[14px] text-blood">{state.message}</div>;

  const r = state.run;
  const tone = toneOf(r.verdict);
  const md = typeof r.result?.markdown === "string" ? (r.result.markdown as string) : null;
  return (
    <div className="mt-6 overflow-hidden rounded-xl border border-edge bg-ink">
      <div className="flex flex-wrap items-center gap-3 border-b border-edge px-5 py-4">
        <span className={`numerals rounded-lg border px-3 py-1 text-[18px] font-bold uppercase ${TONE_CHIP[tone]}`}>{label(r.verdict)}</span>
        <span className="numerals ml-auto text-[11px] text-mist">{(state.ms / 1000).toFixed(1)}s · {r.run_id}</span>
      </div>
      <div className="px-5 py-4">
        <p className={`text-[15px] leading-relaxed ${tone === "neutral" ? "text-bone" : "text-bone"}`}>{r.summary}</p>
        {r.reasons?.length ? (
          <ul className="mt-4 space-y-2">
            {r.reasons.slice(0, 8).map((x, i) => (
              <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone === "good" ? "bg-life" : tone === "bad" ? "bg-blood" : "bg-ember"}`} />
                <span className="text-bone/90">{x.text}{x.source && <span className="numerals ml-2 text-[11px] text-mist">{x.source}</span>}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {r.warnings?.length ? <p className="mt-4 text-[12.5px] text-ember">{r.warnings.join(" · ")}</p> : null}
        {md && <Markdown text={md} />}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link href={`/proof/${r.run_id}`} className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-[13px] font-semibold text-brand hover:bg-brand/20">See the proof →</Link>
          <span className={`text-[12px] ${TONE_TEXT.neutral}`}>Stored and fingerprinted. Information, not advice: you decide.</span>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-[12px] text-mist hover:text-bone">Full result (what an agent receives)</summary>
          <pre className="numerals mt-2 max-h-[420px] overflow-auto rounded-lg border border-edge bg-void p-3 text-[11.5px] leading-relaxed text-mist">{JSON.stringify(r.result, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

// Just enough markdown for the Daily Market Brief: headings, bullets, bold.
function Markdown({ text }: { text: string }) {
  const bold = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <strong key={i} className="text-bone">{p.slice(2, -2)}</strong> : p));
  return (
    <div className="mt-5 space-y-1.5 rounded-lg border border-edge bg-void p-4 text-[13.5px] leading-relaxed text-bone/85">
      {text.split("\n").map((l, i) => {
        if (/^#{1,3} /.test(l)) return <p key={i} className="pt-2 text-[14px] font-semibold text-brand">{l.replace(/^#+ /, "")}</p>;
        if (/^[-*] /.test(l)) return <p key={i} className="flex gap-2"><span className="text-mist">•</span><span>{bold(l.slice(2))}</span></p>;
        if (!l.trim()) return null;
        return <p key={i}>{bold(l)}</p>;
      })}
    </div>
  );
}
