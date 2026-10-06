import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "../db";
import { resolveToken } from "../api/respond";
import { evaluate } from "../api/evaluate";
import { buildState } from "../api/state";
import { buildMarket } from "../api/market";
import { buildRecord } from "../api/record";
import { createMonitor } from "../api/monitor";
import { BRIEF_MODEL } from "../investigations/brief";
import { computeCrowding } from "./trading";
import { defineAgent, fmtPct, fmtUsd, get, n, tokenField, type Reason } from "./core";

// Research and monitoring agents: Due Diligence Analyst, Alert Watchtower, Daily Market Brief.

const GRADE = (s: number) => (s >= 85 ? "A" : s >= 70 ? "B" : s >= 55 ? "C" : s >= 40 ? "D" : "F");

async function shortSummary(prompt: string, maxTokens = 1500): Promise<string | null> { // room for the model's thinking + a short answer
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await Promise.race([
      client.messages.create({ model: BRIEF_MODEL, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
      new Promise<null>((r) => setTimeout(() => r(null), 45_000)),
    ]);
    if (!res) return null;
    return res.content.map((c) => (c.type === "text" ? c.text : "")).join("").trim() || null;
  } catch (err) {
    console.warn(`[agents] summary failed: ${(err as Error).message.slice(0, 160)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------
// 8. Due Diligence Analyst — a full due-diligence memo on any token in one run.
// ---------------------------------------------------------------------------------------------------
export const dueDiligenceAnalyst = defineAgent({
  id: "due-diligence-analyst",
  name: "Due Diligence Analyst",
  tagline: "A full due-diligence memo on any token in one run.",
  persona: ["Exchanges & brokers", "Research & data platforms", "Funds & market makers"],
  description: "Structured like exchange listing reviews (Coinbase, Kraken) and lending-risk onboarding (Aave, Gauntlet, LlamaRisk): liquidity and markets, supply and holder concentration, contract and admin powers, onchain activity, derivatives, development and community, and CoinGraph's own track record on the token. Each section gets a grade with its evidence, plus red flags, strengths and an overall grade.",
  tier: "pro",
  masumi: true,
  verdicts: ["A", "B", "C", "D", "F"],
  input: z.object({ token: tokenField }),
  example: { token: "morpho" },
  async run({ token: t }) {
    const token = await resolveToken(t);
    const [st, ev, rec, brief] = await Promise.all([
      buildState(token),
      evaluate(token),
      buildRecord(token.coingecko_id, new Date(Date.now() - 30 * 86_400_000), null),
      sql`select id, headline, finished_at from investigations where coingecko_id = ${token.coingecko_id} and status = 'done' order by finished_at desc limit 1`,
    ]);
    const s = st.sections as Record<string, Record<string, unknown>>;
    const sym = token.symbol.toUpperCase();
    const sections: { name: string; score: number; findings: string[]; sources: string[] }[] = [];
    const red: string[] = [];
    const strong: string[] = [];

    { // Liquidity and markets
      const depth = n(get(s.liquidity, "depth_2pct_total_usd.ask")) ?? n(get(s.liquidity, "exchanges.cost_to_move_2pct_usd.up"));
      const venues = n(get(s.liquidity, "exchanges.count")), trusted = n(get(s.liquidity, "exchanges.trusted_count"));
      const vol = n(get(s.market, "volume_24h_usd")), mcap = n(get(s.market, "market_cap_usd"));
      let sc = 50; const f: string[] = [];
      if (depth !== null) { sc += depth >= 5e6 ? 30 : depth >= 1e6 ? 20 : depth >= 2.5e5 ? 5 : -20; f.push(`${fmtUsd(depth)} available within 2% of the price`); }
      if (venues !== null) { sc += (trusted ?? 0) >= 10 ? 10 : (trusted ?? 0) >= 3 ? 5 : -5; f.push(`${venues} exchange markets, ${trusted ?? 0} rated trustworthy by CoinGecko`); }
      if (vol && mcap) { const t2 = vol / mcap; sc += t2 >= 0.02 && t2 <= 0.5 ? 10 : t2 > 1 ? -10 : 0; f.push(`24h volume ${fmtUsd(vol)} (${(t2 * 100).toFixed(1)}% of market cap)${t2 > 1 ? " — unusually high turnover, check for wash trading" : ""}`); }
      if (depth !== null && depth < 2.5e5) red.push(`Thin liquidity: only ${fmtUsd(depth)} within 2% of the price`);
      if (depth !== null && depth >= 5e6) strong.push("Deep liquidity across venues");
      sections.push({ name: "Liquidity & markets", score: Math.max(0, Math.min(100, sc)), findings: f, sources: ["ccxt:fetchOrderBook", "coingecko:/coins/{id}/tickers"] });
    }
    { // Supply and concentration
      const fdv = n(get(s.supply, "fdv_to_market_cap")), top10 = n(get(s.supply, "top_holders_pct.top10")), issued = n(get(s.supply, "issued_pct_of_max")), exHeld = n(get(s.supply, "exchange_held_pct"));
      let sc = 70; const f: string[] = [];
      if (fdv !== null) { sc += fdv <= 1.2 ? 10 : fdv >= 3 ? -25 : -5; f.push(`Fully diluted value is ${fdv}× market cap${issued !== null ? ` (${issued}% of max supply issued)` : ""}`); if (fdv >= 3) red.push(`Large dilution ahead: FDV ${fdv}× market cap`); }
      if (top10 !== null) { sc += top10 >= 80 ? -30 : top10 >= 50 ? -10 : 10; f.push(`Top 10 holders own ${top10}% (burn and locked addresses excluded)`); if (top10 >= 80) red.push(`Top 10 holders own ${top10}% of supply`); }
      if (exHeld !== null) f.push(`${exHeld}% of circulating supply sits in known exchange wallets`);
      f.push("Unlock schedule: unassessed (no free source)");
      sections.push({ name: "Supply & concentration", score: Math.max(0, Math.min(100, sc)), findings: f, sources: ["coingecko:/coins/markets", "goplus:/token_security", "nownodes"] });
    }
    { // Contract and admin
      const sec = s.security as { risk_level?: string; rated_on?: string; contracts?: { chain: string; home_chain: boolean; flags: string[]; risk_level: string }[]; status?: string };
      let sc = 75; const f: string[] = [];
      if (sec?.contracts?.length) {
        const home = sec.contracts.find((c) => c.home_chain) ?? sec.contracts[0];
        sc = home.risk_level === "high" ? 15 : home.risk_level === "medium" ? (home.flags.some((x) => !/^Upgradeable|^Issuer/.test(x)) ? 55 : 75) : 95;
        f.push(`Rated on ${sec.rated_on}: ${home.flags.length ? home.flags.join("; ") : "no risks found"}`);
        if (home.risk_level === "high") red.push(...home.flags.slice(0, 2));
        if (home.risk_level === "low") strong.push("Clean contract: no admin powers flagged");
        if (sec.contracts.length > 1) f.push(`Also deployed on ${sec.contracts.filter((c) => c !== home).map((c) => `${c.chain.toUpperCase()} (${c.risk_level})`).join(", ")}`);
      } else f.push("Native coin: no token contract to review");
      sections.push({ name: "Contract & admin powers", score: sc, findings: f, sources: ["goplus:/token_security"] });
    }
    { // Onchain activity
      const on = s.onchain as Record<string, unknown>;
      let sc = 60; const f: string[] = [];
      if ((on as { status?: string })?.status === "unassessed") f.push("No onchain coverage for this chain");
      else {
        const tx24 = n(get(on, "activity.transfers_24h")), senders = n(get(on, "activity.senders_24h")), net7 = n(get(on, "exchange_flows.7d.net_usd"));
        if (tx24 !== null) { sc += tx24 >= 1000 ? 20 : tx24 >= 100 ? 10 : -10; f.push(`${tx24?.toLocaleString()} transfers and ${senders?.toLocaleString() ?? "n/a"} unique senders in 24h`); }
        if (net7 !== null) { f.push(`Net ${fmtUsd(Math.abs(net7))} ${net7 >= 0 ? "onto" : "off"} exchanges over 7 days`); sc += net7 < 0 ? 5 : 0; }
      }
      sections.push({ name: "Onchain activity", score: Math.max(0, Math.min(100, sc)), findings: f, sources: ["nownodes:eth_getLogs"] });
    }
    { // Derivatives
      const d = s.derivatives as Record<string, unknown>;
      let sc = 70; const f: string[] = [];
      if ((d as { status?: string })?.status === "unassessed") f.push("No perpetual futures market tracked");
      else {
        const crowd = (await computeCrowding([token.coingecko_id]))[0];
        if (crowd) { sc = 100 - crowd.score; f.push(`Crowding score ${crowd.score}/100 (${crowd.regime})`, ...crowd.reasons.slice(0, 2)); if (crowd.score >= 65) red.push(`Crowded ${crowd.side} in futures (score ${crowd.score})`); }
        const lev = n(get(d, "leverage_ratio")); if (lev !== null) f.push(`Open interest is ${(lev * 100).toFixed(1)}% of market cap`);
      }
      sections.push({ name: "Derivatives & leverage", score: Math.max(0, Math.min(100, sc)), findings: f, sources: ["binanceusdm", "okx", "bybit"] });
    }
    { // Development and community
      const dev = get(s.context, "development") as { commits_4w?: number; stars?: number } | string;
      const com = get(s.context, "community") as { x_followers?: number; watchlist_users?: number } | string;
      const tvl = get(s.context, "protocol_tvl") as { name: string; tvl_usd: number; change_7d_pct: number }[] | string;
      let sc = 60; const f: string[] = [];
      if (typeof dev === "object") { sc += (dev.commits_4w ?? 0) >= 20 ? 20 : (dev.commits_4w ?? 0) > 0 ? 5 : -15; f.push(`${dev.commits_4w} code commits in 4 weeks, ${dev.stars ?? 0} GitHub stars`); if (dev.commits_4w === 0) red.push("No code commits in the last 4 weeks"); }
      else f.push("Developer activity not tracked for this token");
      if (typeof com === "object") f.push(`${com.x_followers?.toLocaleString() ?? "n/a"} followers on X, ${com.watchlist_users?.toLocaleString() ?? "n/a"} CoinGecko watchlists`);
      if (Array.isArray(tvl) && tvl.length) { f.push(`TVL ${fmtUsd(tvl[0].tvl_usd)} in ${tvl[0].name} (${fmtPct(tvl[0].change_7d_pct)} 7d)`); sc += 10; strong.push(`Real usage: ${fmtUsd(tvl[0].tvl_usd)} TVL`); }
      sections.push({ name: "Development, usage & community", score: Math.max(0, Math.min(100, sc)), findings: f, sources: ["coingecko:/coins/{id}", "defillama:/protocols"] });
    }
    const weights = [0.25, 0.2, 0.2, 0.1, 0.1, 0.15];
    const overall = Math.round(sections.reduce((acc, sec, i) => acc + sec.score * weights[i], 0));
    const grade = red.length >= 3 ? (GRADE(overall) < "D" ? "D" : GRADE(overall)) : GRADE(overall);
    const news = (get(s.context, "news_24h") as { title: string }[] | undefined)?.slice(0, 3).map((x) => x.title) ?? [];
    const calib = rec.calibration as { total_calls: number; hit_rate_pct: number | null };
    const facts = sections.map((x) => `${x.name} (${GRADE(x.score)}): ${x.findings.join("; ")}`).join("\n");
    const exec = await shortSummary(`You write executive summaries for crypto due-diligence memos. In at most 90 words, plain English, no hype, no investment advice, summarise this memo for ${token.name} (${sym}), overall grade ${grade}. Use only these facts:\n${facts}\nRed flags: ${red.join("; ") || "none"}\nStrengths: ${strong.join("; ") || "none"}\nCurrent check verdict: ${ev.data.verdict}.`);
    return {
      verdict: grade,
      summary: exec ?? `${token.name} (${sym}) grades ${grade} (${overall}/100). ${red.length ? `Red flags: ${red.slice(0, 2).join("; ")}.` : "No red flags."} ${strong[0] ? `Strength: ${strong[0]}.` : ""}`.trim(),
      result: {
        token: { id: token.coingecko_id, symbol: sym, name: token.name, rank: token.market_cap_rank },
        overall: { grade, score: overall }, sections: sections.map((x) => ({ ...x, grade: GRADE(x.score) })),
        red_flags: red, strengths: strong, current_check: { verdict: ev.data.verdict, evaluation_id: ev.id },
        recent_news: news, latest_brief: brief[0] ? { id: Number(brief[0].id), headline: brief[0].headline, at: brief[0].finished_at } : null,
        coingraph_track_record_30d: { calls: calib.total_calls, hit_rate_pct: calib.hit_rate_pct },
        method: "Weighted: liquidity 25%, supply 20%, contract 20%, onchain 10%, derivatives 10%, development & usage 15%. Three or more red flags cap the grade at D.",
      },
      reasons: [...red.map((r) => ({ text: `Red flag: ${r}`, source: "coingraph" })), ...strong.map((r) => ({ text: `Strength: ${r}`, source: "coingraph" }))] as Reason[],
      links: { proof: `/api/v1/verify/${ev.id}`, ...(brief[0] ? { brief: `/investigations/${brief[0].id}` } : {}) },
      tokens: [token.coingecko_id],
    };
  },
});

// ---------------------------------------------------------------------------------------------------
// 9. Alert Watchtower — watches your tokens and explains every alert.
// ---------------------------------------------------------------------------------------------------
export const alertWatchtower = defineAgent({
  id: "alert-watchtower",
  name: "Alert Watchtower",
  tagline: "Watches your tokens and explains every alert.",
  persona: ["Funds & market makers", "Active traders"],
  description: "Give it a list of tokens and optionally a webhook URL. It returns what is happening right now on each token (recent signals with the brief that explains them) and, with a webhook, keeps watching: every new signal or brief is pushed to you as a signed message.",
  tier: "premium",
  masumi: false,
  verdicts: ["ACTIVE", "QUIET"],
  input: z.object({
    tokens: z.array(tokenField).min(1).max(50),
    webhook_url: z.string().url().optional().describe("Optional public https URL for continuous alerts"),
    min_severity: z.number().int().min(1).max(3).default(2),
    hours: z.number().int().min(1).max(48).default(24),
  }),
  example: { tokens: ["bitcoin", "ethereum", "aave"], min_severity: 2 },
  async run({ tokens, webhook_url, min_severity, hours }) {
    const ids = (await Promise.all(tokens.map((t) => resolveToken(t)))).map((t) => t.coingecko_id);
    const rows = await sql`
      select s.id, s.coingecko_id, upper(t.symbol) as symbol, s.kind, s.direction, s.severity, s.event_ts, s.details, i.id as brief_id, i.headline
      from signals s join tokens t using (coingecko_id) left join investigations i on i.id = s.investigation_id and i.status = 'done'
      where s.coingecko_id = any(${ids}) and s.severity >= ${min_severity} and s.event_ts > now() - ${hours} * interval '1 hour'
      order by s.event_ts desc limit 100`;
    let monitor: { id: string; secret: string } | null = null;
    if (webhook_url) { const m = await createMonitor({ tokens: ids, webhook_url, conditions: { min_severity } }); monitor = { id: m.id, secret: m.secret }; }
    const alerts = rows.map((r) => ({ at: r.event_ts, token: r.symbol, kind: r.kind, direction: r.direction, severity: r.severity, explained_by: r.brief_id ? { brief_id: Number(r.brief_id), headline: r.headline } : null, details: r.details }));
    const byToken = ids.map((id) => ({ token: id, alerts: alerts.filter((a) => a.token === rows.find((r) => r.coingecko_id === id)?.symbol).length }));
    return {
      verdict: alerts.length ? "ACTIVE" : "QUIET",
      summary: alerts.length ? `${alerts.length} alert${alerts.length > 1 ? "s" : ""} in the last ${hours}h on ${new Set(alerts.map((a) => a.token)).size} of ${ids.length} tokens; latest: ${alerts[0].token} ${alerts[0].kind.replace(/_/g, " ")}${alerts[0].explained_by ? ` — "${alerts[0].explained_by.headline}"` : ""}.${monitor ? " Watching continuously; new alerts go to your webhook." : ""}`
        : `Quiet: no alerts at severity ${min_severity}+ in the last ${hours}h.${monitor ? " Watching continuously; new alerts go to your webhook." : ""}`,
      result: { tokens: ids, alerts, per_token: byToken, watch: monitor ? { id: monitor.id, webhook_url, note: "Messages are signed with X-CoinGraph-Signature (HMAC-SHA256 of the body, using the secret)." } : null },
      reasons: alerts.slice(0, 5).map((a) => ({ text: `${a.token}: ${a.kind.replace(/_/g, " ")} (${a.direction}, severity ${a.severity})`, source: "coingraph:signals" })),
      tokens: ids,
      private: monitor ? { watch_secret: monitor.secret } : undefined,
    };
  },
});

// ---------------------------------------------------------------------------------------------------
// 10. Daily Market Brief — the whole market in one readable page.
// ---------------------------------------------------------------------------------------------------
export const dailyMarketBrief = defineAgent({
  id: "daily-market-brief",
  name: "Daily Market Brief",
  tagline: "The whole market in one readable page.",
  persona: ["Funds & market makers", "Analysts & creators", "Active traders", "Newcomers"],
  description: "Opens with CoinGraph's own graded calls from the last 24 hours, then the market regime (risk-on or risk-off, breadth, leverage, Fear & Greed), what changed ranked by importance, stablecoin and exchange flows, the most crowded futures markets, top movers and headlines — and, if you pass your holdings, a line on each. Returned as Markdown and JSON.",
  tier: "premium",
  masumi: false,
  verdicts: ["RISK_ON", "RISK_OFF", "NEUTRAL"],
  input: z.object({ holdings: z.array(tokenField).max(20).optional().describe("Optional tokens you hold, for a personal section") }),
  example: { holdings: ["bitcoin", "ethereum", "aave"] },
  async run({ holdings }) {
    const [m, rec, crowd] = await Promise.all([
      buildMarket(["overview", "breadth", "sentiment", "flows", "rankings", "events"]),
      buildRecord(null, new Date(Date.now() - 48 * 3600_000), null),
      computeCrowding(null),
    ]);
    const s = m.sections as Record<string, Record<string, unknown>>;
    const mc24 = n(get(s.overview, "market_cap_change_24h_pct")), up24 = n(get(s.breadth, "up_24h_pct")), fg = get(s.sentiment, "fear_greed") as { value: number; label: string } | string;
    const stable1h = n(get(s.flows, "stablecoins_to_exchanges.net_24h_usd"));
    const regime = (up24 ?? 50) >= 60 && (mc24 ?? 0) > 0 ? "RISK_ON" : (up24 ?? 50) <= 40 && (mc24 ?? 0) < 0 ? "RISK_OFF" : "NEUTRAL";
    const graded = (rec.ledger as { outcome: string | null; kind: string; symbol: string; said: string; return_after_pct: Record<string, number | null> }[]).filter((l) => l.outcome);
    const right = graded.filter((g) => g.outcome === "right").length;
    const rk = s.rankings as Record<string, { symbol: string; change_24h_pct?: number; change_1h_pct?: number }[]>;
    const headlines = ((get(s.events, "headlines") ?? []) as { title: string; source: string }[]).slice(0, 5);
    const crowdedTop = crowd.slice(0, 3);
    const mine = holdings?.length ? await Promise.all(holdings.map(async (h) => {
      const tk = await resolveToken(h).catch(() => null);
      if (!tk) return null;
      const ev = await evaluate(tk).catch(() => null);
      const ch = n(get(ev?.data.snapshot, "market.change_pct.24h"));
      return { token: tk.symbol.toUpperCase(), change_24h_pct: ch, check: ev?.data.verdict ?? "unassessed", note: ev && ev.data.verdict !== "proceed" ? (ev.data.reasons as { text: string }[])[0]?.text ?? null : null };
    })) : [];
    const md = [
      `# CoinGraph Daily Market Brief — ${new Date().toISOString().slice(0, 10)}`,
      ``,
      `## Yesterday's calls, graded`,
      graded.length ? `${right} of ${graded.length} graded calls were right (${Math.round((right / graded.length) * 100)}%). Every call is public: /api/v1/record.` : "No calls old enough to grade yet.",
      ``,
      `## Regime: ${regime.replace("_", "-").toLowerCase()}`,
      `- Total market cap ${fmtPct(mc24)} in 24h; ${up24 ?? "n/a"}% of the top 100 are up.`,
      `- Fear & Greed: ${typeof fg === "object" ? `${fg.value} (${fg.label})` : "n/a"}.`,
      `- Stablecoins to exchanges (24h): ${stable1h !== null ? `${stable1h >= 0 ? "+" : "−"}${fmtUsd(Math.abs(stable1h))}` : "n/a"} ${stable1h !== null && stable1h > 0 ? "— buying power arriving" : ""}`,
      ``,
      `## Leverage`,
      ...crowdedTop.map((c) => `- ${c.symbol}: crowding ${c.score}/100, ${c.regime}${c.reasons[0] ? ` — ${c.reasons[0]}` : ""}`),
      ``,
      `## Movers`,
      `- Top 24h: ${(rk.gainers_24h ?? []).slice(0, 5).map((g) => `${g.symbol} ${fmtPct(g.change_24h_pct ?? null)}`).join(", ") || "n/a"}`,
      `- Bottom 24h: ${(rk.losers_24h ?? []).slice(0, 5).map((g) => `${g.symbol} ${fmtPct(g.change_24h_pct ?? null)}`).join(", ") || "n/a"}`,
      ``,
      `## Headlines`,
      ...headlines.map((h) => `- ${h.title} (${h.source})`),
      ...(mine.length ? [``, `## Your holdings`, ...mine.filter(Boolean).map((x) => `- ${x!.token}: ${fmtPct(x!.change_24h_pct)} 24h, check ${x!.check}${x!.note ? ` — ${x!.note}` : ""}`)] : []),
      ``,
      `_Sources: CoinGecko, Binance/OKX/Bybit/Coinbase/Kraken/Gate via CCXT, NOWNodes (5 chains), DefiLlama, news RSS, alternative.me. CoinGraph never gives financial advice._`,
    ].join("\n");
    return {
      verdict: regime,
      summary: `Market ${regime.replace("_", "-").toLowerCase()}: cap ${fmtPct(mc24)} in 24h, ${up24 ?? "n/a"}% of the top 100 up, Fear & Greed ${typeof fg === "object" ? fg.value : "n/a"}.${crowdedTop[0] ? ` Most crowded: ${crowdedTop[0].symbol} (${crowdedTop[0].score}/100).` : ""}`,
      result: { markdown: md, regime, overview: s.overview, breadth: s.breadth, sentiment: fg, flows: s.flows, crowded: crowdedTop, graded_calls: { graded: graded.length, right }, holdings: mine.filter(Boolean), headlines },
      reasons: [{ text: `Breadth ${up24 ?? "n/a"}% up, market cap ${fmtPct(mc24)}`, source: "coingecko:/global + /coins/markets" }],
      tokens: (holdings ?? []).map(String),
    };
  },
});
