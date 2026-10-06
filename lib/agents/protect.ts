import { z } from "zod";
import { sql } from "../db";
import { ApiError, resolveToken } from "../api/respond";
import { evaluate } from "../api/evaluate";
import { buildState } from "../api/state";
import { inspectAddress, CHAINS, type Chain } from "../api/inspect";
import { dexQuote } from "../security/jobs";
import { defineAgent, fmtPct, fmtUsd, get, n, tokenField, type Reason } from "./core";

// Protection agents: Wallet Guard, Portfolio Checkup, Treasury Steward.

const chainField = z.enum(CHAINS).describe("Chain: eth (Ethereum), bsc (BNB Chain), btc (Bitcoin), sol (Solana), ada (Cardano)");

// Address poisoning: a lookalike of a known address (same first 6 and last 4 characters, different middle).
async function lookalikeOf(chain: string, address: string) {
  if (address.length < 12) return null;
  const a = chain === "eth" || chain === "bsc" ? address.toLowerCase() : address;
  const [hit] = await sql`
    select address, label, entity from wallet_labels where chain = ${chain} and address <> ${a}
      and left(address, 6) = ${a.slice(0, 6)} and right(address, 4) = ${a.slice(-4)} limit 1`;
  return hit ? { address: hit.address as string, label: (hit.label ?? hit.entity) as string } : null;
}

// ---------------------------------------------------------------------------------------------------
// 5. Wallet Guard — checks a swap or a send before you sign it.
// ---------------------------------------------------------------------------------------------------
export const walletGuard = defineAgent({
  id: "wallet-guard",
  name: "Wallet Guard",
  tagline: "Checks a swap or a send before you sign it.",
  persona: ["AI wallets", "Long-term holders", "Newcomers"],
  description: "Before a swap, it checks the token: contract risks (honeypot, taxes, mint/freeze/blacklist powers), the real price impact of the amount, holder concentration and market conditions. Before a send, it checks the recipient live on the chain: OFAC sanctions, scam and phishing flags, burn addresses, brand-new wallets and lookalikes of known addresses (address poisoning). Returns SAFE, WARN or STOP with one plain sentence for the user.",
  tier: "premium",
  masumi: true,
  verdicts: ["SAFE", "WARN", "STOP"],
  input: z.object({
    token: tokenField.optional().describe("The token being swapped into or sent"),
    amount_usd: z.number().positive().max(1e10).optional().describe("Amount in USD"),
    to_address: z.string().min(20).max(130).optional().describe("Recipient address (for a send)"),
    chain: chainField.optional().describe("Chain of the recipient address"),
  }).refine((v) => v.token || v.to_address, { message: "Provide a token, a to_address, or both" }).refine((v) => !v.to_address || v.chain, { message: "chain is required with to_address" }),
  example: { token: "chainlink", amount_usd: 5000, to_address: "0x28c6c06298d514db089934071355e5743bf21d60", chain: "eth" },
  async run({ token: t, amount_usd, to_address, chain }) {
    const stop: Reason[] = [];
    const warn: Reason[] = [];
    const ok: Reason[] = [];
    const result: Record<string, unknown> = {};
    const tokens: string[] = [];

    if (t) {
      const token = await resolveToken(t);
      tokens.push(token.coingecko_id);
      const ev = await evaluate(token, { size_usd: amount_usd });
      const dims = ev.data.dimensions as Record<string, { rating: string; reasons: { text: string; source: string }[] }>;
      const sym = token.symbol.toUpperCase();
      const contract = dims.contract;
      if (contract.rating === "avoid") stop.push(...contract.reasons.map((r) => ({ text: `${sym}: ${r.text}`, source: r.source })));
      else if (contract.rating === "caution") warn.push(...contract.reasons.slice(0, 2).map((r) => ({ text: `${sym}: ${r.text}`, source: r.source })));
      else ok.push({ text: `${sym} contract: ${contract.reasons[0]?.text ?? "no risks found"}`, source: contract.reasons[0]?.source ?? "goplus" });
      const sc = (ev.data.size_check ?? {}) as Record<string, unknown>;
      const impact = n(get(sc, "dex_quote.price_impact_pct")) ?? n(sc.estimated_impact_pct);
      if (amount_usd && impact !== null) {
        if (impact > 5) stop.push({ text: `Swapping ${fmtUsd(amount_usd)} into ${sym} would lose about ${impact}% to price impact`, source: "dex:quote" });
        else if (impact > 2) warn.push({ text: `Swapping ${fmtUsd(amount_usd)} into ${sym} costs about ${impact}% in price impact`, source: "dex:quote" });
      }
      for (const dim of ["liquidity", "leverage", "onchain", "supply"]) if (dims[dim]?.rating === "avoid") warn.push(...dims[dim].reasons.slice(0, 1).map((r) => ({ text: `${sym}: ${r.text}`, source: r.source })));
      result.token = { id: token.coingecko_id, symbol: sym, check: ev.data.verdict, contract: contract.rating, price_impact_pct: impact, evaluation_id: ev.id };
    }

    if (to_address && chain) {
      const p = await inspectAddress(chain as Chain, to_address);
      const d = p.data as Record<string, unknown>;
      const scr = d.screening as { risk: string; sanctioned: boolean; burn_address: boolean; flags: string[] } | string;
      if (typeof scr === "object") {
        if (scr.sanctioned) stop.push({ text: "Recipient is on the OFAC sanctions list", source: "ofac" });
        if (scr.burn_address) stop.push({ text: "Recipient is a burn address — the funds would be lost forever", source: "coingraph" });
        for (const f of scr.flags.filter((f) => !/OFAC|Burn address/.test(f))) stop.push({ text: `Recipient flagged: ${f}`, source: "goplus:/address_security" });
      }
      const look = await lookalikeOf(chain, to_address);
      if (look) stop.push({ text: `Recipient looks like ${look.label} (${look.address.slice(0, 8)}…${look.address.slice(-4)}) but is a different address — possible address poisoning`, source: "coingraph:wallet_labels" });
      const txs = n(d.tx_count);
      const label = d.label as { name?: string; kind?: string } | string;
      if (typeof label === "object" && label.kind === "exchange") ok.push({ text: `Recipient is a known ${label.name} exchange wallet`, source: "coingraph:wallet_labels" });
      else if (txs !== null && txs < 5) (amount_usd && amount_usd >= 10_000 ? warn : ok).push({ text: `Recipient is a new or barely used wallet (${txs} transactions)`, source: "nownodes" });
      result.recipient = { chain, address: to_address, label: d.label, type: d.type, tx_count: txs, screening: scr, lookalike_of: look };
    }

    const verdict = stop.length ? "STOP" : warn.length ? "WARN" : "SAFE";
    const lead = (stop[0] ?? warn[0] ?? ok[0])?.text;
    const summary = verdict === "STOP" ? `STOP: ${lead}.` : verdict === "WARN" ? `WARN: ${lead}. You can continue, but check this first.` : `SAFE: nothing risky found${lead ? `. ${lead.replace(/\.$/, "")}` : ""}.`;
    return { verdict, summary, result, reasons: [...stop, ...warn, ...ok], tokens };
  },
});

// ---------------------------------------------------------------------------------------------------
// 6. Portfolio Checkup — a health check for everything in a wallet.
// ---------------------------------------------------------------------------------------------------
export const portfolioCheckup = defineAgent({
  id: "portfolio-checkup",
  name: "Portfolio Checkup",
  tagline: "A health check for everything in a wallet.",
  persona: ["Long-term holders", "AI wallets"],
  description: "Reads a wallet's holdings live from the chain, runs the CoinGraph check on each tracked token, and measures concentration, how many days each position would take to exit at normal volume, and contract risks. Returns a health grade from A to F with fixes ranked by impact.",
  tier: "pro",
  masumi: false,
  verdicts: ["A", "B", "C", "D", "F"],
  input: z.object({ chain: chainField, address: z.string().min(20).max(130) }),
  example: { chain: "eth", address: "0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8" },
  async run({ chain, address }) {
    const p = await inspectAddress(chain as Chain, address);
    const d = p.data as Record<string, unknown>;
    type Pos = { token: string | null; symbol: string; usd: number | null; tracked: boolean };
    const native = d.native as { symbol: string; amount: number; usd: number | null } | undefined;
    const nativeId = ({ eth: "ethereum", bsc: "binancecoin", btc: "bitcoin", sol: "solana", ada: "cardano" } as Record<string, string>)[chain];
    const positions: Pos[] = [
      ...(native && (native.usd ?? 0) > 0 ? [{ token: nativeId, symbol: native.symbol, usd: native.usd, tracked: true }] : []),
      ...((d.holdings as Pos[] | undefined) ?? []).filter((h) => (h.usd ?? 0) >= 10),
    ].sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
    const total = positions.reduce((s, h) => s + (h.usd ?? 0), 0);
    if (!total) return { verdict: "F", summary: "The wallet holds nothing CoinGraph can value.", result: { chain, address, total_usd: 0, positions: [] }, reasons: [] };
    // Concentration and exit time are about volatile assets: stablecoins are excluded from both.
    const stableIds = new Set((await sql<{ coingecko_id: string }[]>`select coingecko_id from tokens where is_stablecoin`).map((r) => r.coingecko_id));
    const volatile = positions.filter((h) => !(h.token && stableIds.has(h.token)));
    const volTotal = volatile.reduce((s, h) => s + (h.usd ?? 0), 0);
    const hhi = volTotal ? volatile.reduce((s, h) => s + ((h.usd ?? 0) / volTotal) ** 2, 0) : 0;
    const stableShare = total ? Math.round(((total - volTotal) / total) * 1000) / 10 : 0;
    const evaluated = await Promise.all(positions.filter((h) => h.tracked && h.token).slice(0, 8).map(async (h) => {
      const tk = await resolveToken(h.token!).catch(() => null);
      if (!tk) return null;
      const [ev, vol] = await Promise.all([
        evaluate(tk).catch(() => null),
        sql`select total_volume from market_snapshots where coingecko_id = ${tk.coingecko_id} order by captured_at desc limit 1`,
      ]);
      const volume = n(vol[0]?.total_volume);
      return { symbol: h.symbol, id: tk.coingecko_id, usd: h.usd, share_pct: Math.round(((h.usd ?? 0) / total) * 1000) / 10, check: ev?.data.verdict ?? "unassessed",
        contract: (ev?.data.dimensions as Record<string, { rating: string }> | undefined)?.contract?.rating ?? "unassessed",
        exit_days: volume ? Math.round(((h.usd ?? 0) / (volume * 0.05)) * 100) / 100 : null, evaluation_id: ev?.id ?? null,
        concern: ev && ev.data.verdict !== "proceed" ? (ev.data.reasons as { text: string }[])[0]?.text ?? null : null };
    }));
    const rows = evaluated.filter(Boolean) as NonNullable<(typeof evaluated)[number]>[];
    let score = 100;
    const fixes: { impact: number; text: string }[] = [];
    if (hhi > 0.5 && volatile[0]) {
      const blueChip = ["bitcoin", "ethereum"].includes(volatile[0].token ?? "");
      const pen = blueChip ? 8 : 25;
      score -= pen;
      fixes.push({ impact: pen, text: `${Math.round(((volatile[0].usd ?? 0) / volTotal) * 100)}% of the non-stablecoin value is in ${volatile[0].symbol}.${blueChip ? " Concentrated, but in the most liquid asset in crypto." : " Spreading it out lowers the damage from one bad token."}` });
    }
    else if (hhi > 0.3) { score -= 10; fixes.push({ impact: 10, text: `Moderately concentrated (HHI ${hhi.toFixed(2)}).` }); }
    for (const r of rows) {
      if (r.check === "avoid" || r.contract === "avoid") { score -= 15; fixes.push({ impact: 15 + r.share_pct / 10, text: `${r.symbol} (${r.share_pct}% of the wallet) fails the check: ${r.concern ?? "contract risk"}.` }); }
      else if (r.check === "caution") { score -= 4; fixes.push({ impact: 4 + r.share_pct / 20, text: `${r.symbol} is rated caution: ${r.concern ?? ""}` }); }
      if (r.exit_days !== null && r.exit_days > 3 && !stableIds.has(r.id)) { score -= 10; fixes.push({ impact: 10, text: `${r.symbol} would take about ${r.exit_days} days to exit at 5% of daily volume — size is large for its liquidity.` }); }
    }
    const untracked = positions.filter((p) => !p.tracked).reduce((s, h) => s + (h.usd ?? 0), 0);
    if (untracked / total > 0.2) { score -= 5; fixes.push({ impact: 5, text: `${Math.round((untracked / total) * 100)}% of the value is in tokens CoinGraph doesn't track yet — unassessed.` }); }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
    fixes.sort((a, b) => b.impact - a.impact);
    return {
      verdict: grade,
      summary: `Grade ${grade} (${score}/100) for ${fmtUsd(total)} across ${positions.length} holdings.${fixes[0] ? ` Top fix: ${fixes[0].text}` : " No issues found."}`,
      result: { chain, address, label: d.label, total_usd: Math.round(total), score, grade, concentration_hhi: Number(hhi.toFixed(3)), stablecoin_share_pct: stableShare, positions: rows, other_positions: positions.filter((p) => !rows.some((r) => r.symbol === p.symbol)).slice(0, 20), fixes: fixes.map((f) => f.text) },
      reasons: fixes.slice(0, 5).map((f) => ({ text: f.text, source: "coingraph:evaluate + nownodes" })),
      tokens: rows.map((r) => r.id),
    };
  },
});

// ---------------------------------------------------------------------------------------------------
// 7. Treasury Steward — enforces the treasury's rules, with proof.
// ---------------------------------------------------------------------------------------------------
export const treasurySteward = defineAgent({
  id: "treasury-steward",
  name: "Treasury Steward",
  tagline: "Enforces the treasury's rules, with proof.",
  persona: ["DAO treasuries & vaults", "Risk & compliance teams"],
  description: "Give it the treasury's assets and its investment policy (minimum liquidity, maximum holder concentration, maximum funding, maximum exchange inflow, mint authority, maximum exit slippage, maximum share of market cap). It tests every asset against every rule — exit slippage with a live DEX quote for the actual position size — and returns pass/fail per rule per asset, each backed by a proof id, ready to attach to a governance vote.",
  tier: "pro",
  masumi: false,
  verdicts: ["COMPLIANT", "BREACH", "INCOMPLETE"],
  input: z.object({
    assets: z.array(z.object({ token: tokenField, value_usd: z.number().positive().max(1e11) })).min(1).max(20),
    policy: z.object({
      min_depth_usd: z.number().optional().describe("Minimum liquidity within 2% of price"),
      max_top10_holder_pct: z.number().optional(), max_funding_pct: z.number().optional(), max_exchange_inflow_usd: z.number().optional(),
      allow_mint_authority: z.boolean().optional(),
      max_exit_slippage_pct: z.number().optional().describe("Largest acceptable price impact to sell the whole position"),
      max_position_pct_of_market_cap: z.number().optional(),
    }),
  }),
  example: { assets: [{ token: "cardano", value_usd: 9_000 }, { token: "chainlink", value_usd: 6_000 }, { token: "solana", value_usd: 5_000 }], policy: { min_depth_usd: 500_000, max_exit_slippage_pct: 1, allow_mint_authority: false, max_position_pct_of_market_cap: 0.5 } },
  async run({ assets, policy }) {
    const { max_exit_slippage_pct, max_position_pct_of_market_cap, ...checkPolicy } = policy;
    const rows = await Promise.all(assets.map(async (a) => {
      const tk = await resolveToken(a.token);
      const [ev, exit, mc] = await Promise.all([
        evaluate(tk, { policy: checkPolicy, size_usd: a.value_usd }),
        max_exit_slippage_pct !== undefined && !tk.is_stablecoin ? dexQuote(tk.coingecko_id, a.value_usd, "sell").catch(() => null) : Promise.resolve(null),
        sql`select market_cap from market_snapshots where coingecko_id = ${tk.coingecko_id} order by captured_at desc limit 1`,
      ]);
      const rules: Record<string, { result: string; detail: string }> = { ...((ev.data.policy_check ?? {}) as Record<string, { result: string; detail: string }>) };
      if (max_exit_slippage_pct !== undefined) {
        // Best exit route: a live on-chain sell quote, or the bid side of exchange order books (2% depth).
        const bid = n(get(ev.data.size_check ?? {}, "depth_2pct_usd.bid"));
        const routes = [
          ...(exit ? [{ impact: exit.price_impact_pct, where: `on ${exit.venue} (${exit.chain.toUpperCase()})` }] : []),
          ...(bid ? [{ impact: Math.round(Math.min((a.value_usd / bid) * 2, 100) * 100) / 100, where: "on exchange order books" }] : []),
        ].sort((x, y) => x.impact - y.impact);
        const best = routes[0];
        const shown = (v: number) => (v < 0.01 ? "under 0.01" : String(v));
        rules.max_exit_slippage_pct = best
          ? { result: best.impact <= max_exit_slippage_pct ? "pass" : "fail", detail: `selling ${fmtUsd(a.value_usd)} costs about ${shown(best.impact)}% ${best.where} (limit ${max_exit_slippage_pct}%)` }
          : { result: tk.is_stablecoin ? "pass" : "unknown", detail: tk.is_stablecoin ? "stablecoin" : "no exit route quoted" };
      }
      const mcap = n(mc[0]?.market_cap);
      if (max_position_pct_of_market_cap !== undefined) rules.max_position_pct_of_market_cap = mcap ? { result: (a.value_usd / mcap) * 100 <= max_position_pct_of_market_cap ? "pass" : "fail", detail: `${((a.value_usd / mcap) * 100).toFixed(3)}% of market cap (limit ${max_position_pct_of_market_cap}%)` } : { result: "unknown", detail: "market cap unknown" };
      const status = Object.values(rules).some((r) => r.result === "fail") ? "breach" : Object.values(rules).some((r) => r.result === "unknown") ? "incomplete" : "compliant";
      return { token: { id: tk.coingecko_id, symbol: tk.symbol.toUpperCase() }, value_usd: a.value_usd, status, rules, check: ev.data.verdict, proof_id: ev.id };
    }));
    const breaches = rows.filter((r) => r.status === "breach");
    const verdict = breaches.length ? "BREACH" : rows.some((r) => r.status === "incomplete") ? "INCOMPLETE" : "COMPLIANT";
    const total = rows.reduce((s, r) => s + r.value_usd, 0);
    return {
      verdict,
      summary: breaches.length
        ? `${breaches.length} of ${rows.length} assets breach the policy (${fmtUsd(breaches.reduce((s, r) => s + r.value_usd, 0))} of ${fmtUsd(total)}): ${breaches.map((b) => `${b.token.symbol} — ${Object.entries(b.rules).find(([, v]) => v.result === "fail")?.[1].detail}`).join("; ")}.`
        : verdict === "COMPLIANT" ? `All ${rows.length} assets (${fmtUsd(total)}) comply with the policy.` : `No breaches, but some rules could not be assessed.`,
      result: { assets: rows, policy, total_usd: total },
      reasons: breaches.flatMap((b) => Object.entries(b.rules).filter(([, v]) => v.result === "fail").map(([k, v]) => ({ text: `${b.token.symbol} fails ${k}: ${v.detail}`, source: `coingraph:evaluate ${b.proof_id}` }))),
      links: Object.fromEntries(rows.map((r) => [`proof_${r.token.symbol}`, `/api/v1/verify/${r.proof_id}`])),
      tokens: rows.map((r) => r.token.id),
    };
  },
});

// Snapshot helper shared with the research agents.
export async function stateOf(id: string) {
  const tk = await resolveToken(id);
  if (!tk) throw new ApiError(404, "token_not_found", id);
  return { tk, st: await buildState(tk) };
}
export { fmtPct };
