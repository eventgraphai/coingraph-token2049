// Captures real responses for the documentation from a running CoinGraph (default: local dev) and writes
// them, trimmed for reading, to lib/docs/examples.json. Examples use Cardano (ADA), Chainlink (LINK) and
// Solana (SOL).
//
//   npx tsx scripts/docs-examples.ts [base-url]
//
// Secrets (the monitor secret) are masked; the test monitor is deleted again.

import { writeFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const API = `${BASE}/api/v1`;

type Json = unknown;

// Keep examples readable: short arrays, short strings, a bounded number of keys and depth.
function trim(v: Json, depth = 0, opts = { arr: 2, keys: 14, str: 220, depth: 8 }): Json {
  if (Array.isArray(v)) {
    const head = v.slice(0, opts.arr).map((x) => trim(x, depth + 1, opts));
    return v.length > opts.arr ? [...head, `… ${v.length - opts.arr} more`] : head;
  }
  if (v && typeof v === "object") {
    if (depth >= opts.depth) return "{ … }";
    const entries = Object.entries(v as Record<string, Json>);
    const out: Record<string, Json> = {};
    for (const [k, x] of entries.slice(0, opts.keys)) out[k] = trim(x, depth + 1, opts);
    if (entries.length > opts.keys) out["…"] = `${entries.length - opts.keys} more fields`;
    return out;
  }
  if (typeof v === "string" && v.length > opts.str) return v.slice(0, opts.str) + "…";
  return v;
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const t = Date.now();
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  console.log(`${method} ${path} → ${res.status} (${Date.now() - t} ms)`);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  await new Promise((r) => setTimeout(r, 1100)); // stay under 60 requests/minute
  return json as Record<string, any>;
}

const out: Record<string, { request: { method: string; path: string; body?: unknown }; response: Json }> = {};
async function grab(key: string, method: string, path: string, body?: unknown, opts?: Parameters<typeof trim>[2], post?: (j: any) => any) {
  try {
    let j = await call(method, path, body);
    if (post) j = post(structuredClone(j));
    out[key] = { request: { method, path, ...(body ? { body } : {}) }, response: trim(j, 0, opts) };
    return j;
  } catch (e) {
    console.error(`  ! ${key}: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  // Discover
  await grab("tokens", "GET", "/tokens?q=chainlink");
  await grab("status", "GET", "/status", undefined, { arr: 2, keys: 10, str: 160, depth: 8 });

  // Understand
  await grab("state", "GET", "/state/chainlink?sections=market,liquidity,security", undefined, { arr: 2, keys: 16, str: 200, depth: 8 });
  await grab("history", "GET", `/history/solana?series=price,funding&since=${new Date(Date.now() - 6 * 3600_000).toISOString()}`, undefined, { arr: 3, keys: 12, str: 200, depth: 8 });
  await grab("market", "GET", "/market?sections=overview,breadth,sentiment", undefined, { arr: 2, keys: 12, str: 200, depth: 8 });
  await grab("inspect", "GET", "/inspect/sol/5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", undefined, { arr: 2, keys: 14, str: 200, depth: 8 });

  // Decide
  const ev = await grab("evaluate_get", "GET", "/evaluate/chainlink", undefined, { arr: 2, keys: 14, str: 220, depth: 8 });
  await grab("evaluate_post", "POST", "/evaluate", { token: "solana", size_usd: 250000, policy: { min_depth_usd: 1000000, max_funding_pct: 0.05, max_top10_holder_pct: 60 } }, { arr: 3, keys: 14, str: 220, depth: 8 });
  await grab("explain", "GET", "/explain/chainlink", undefined, { arr: 2, keys: 18, str: 260, depth: 8 });
  await grab("ask_question", "POST", "/ask", { token: "cardano", question: "Are large holders moving ADA onto exchanges today?" }, { arr: 3, keys: 14, str: 320, depth: 8 });
  await grab("ask_claim", "POST", "/ask", { token: "solana", claim: "SOL futures are heavily crowded on the long side right now" }, { arr: 3, keys: 14, str: 320, depth: 8 });

  // Watch (created, recorded with the secret masked, then deleted)
  const mon = await call("POST", "/monitor", { tokens: ["cardano", "chainlink", "solana"], webhook_url: "https://example.com/hooks/coingraph", conditions: { min_severity: 2, new_briefs: true } }).catch(() => null);
  if (mon) {
    const masked = structuredClone(mon);
    if (masked.data?.secret) masked.data.secret = "whsec_••••••••••••••••";
    out.monitor = { request: { method: "POST", path: "/monitor", body: { tokens: ["cardano", "chainlink", "solana"], webhook_url: "https://example.com/hooks/coingraph", conditions: { min_severity: 2, new_briefs: true } } }, response: trim(masked) };
    await call("DELETE", `/monitor/${mon.data.id}`, undefined, { "x-monitor-secret": mon.data.secret }).catch(() => null);
  }

  // Trust
  await grab("record", "GET", "/record/solana?kind=signal", undefined, { arr: 2, keys: 12, str: 200, depth: 8 });
  if (ev?.id) await grab("verify", "GET", `/verify/${ev.id}`, undefined, { arr: 2, keys: 12, str: 160, depth: 8 });

  // Agents
  const agents: [string, Record<string, unknown>][] = [
    ["trade-gatekeeper", { token: "solana", size_usd: 250000, side: "buy" }],
    ["wallet-guard", { token: "chainlink", amount_usd: 20000, to_address: "0x28c6c06298d514db089934071355e5743bf21d60", chain: "eth" }],
    ["due-diligence-analyst", { token: "cardano" }],
    ["opportunity-scout", { limit: 3 }],
    ["leverage-radar", { tokens: ["solana", "cardano", "chainlink"] }],
    ["whale-watch", { token: "chainlink" }],
    ["portfolio-checkup", { chain: "eth", address: "0x9fc3da866e7df3a1c57ade1a97c9f00a70f010c8" }],
    ["treasury-steward", { assets: [{ token: "cardano", value_usd: 1500000 }, { token: "chainlink", value_usd: 750000 }, { token: "solana", value_usd: 500000 }], policy: { min_depth_usd: 500000, max_exit_slippage_pct: 2, allow_mint_authority: false, max_position_pct_of_market_cap: 0.5 } }],
    ["alert-watchtower", { tokens: ["cardano", "chainlink", "solana"], min_severity: 2 }],
    ["daily-market-brief", { holdings: ["cardano", "chainlink", "solana"] }],
  ];
  for (const [id, body] of agents) await grab(`agent:${id}`, "POST", `/agents/${id}`, body, { arr: 3, keys: 14, str: 320, depth: 8 });
  // One example of each Trade Gatekeeper decision.
  await grab("agent:trade-gatekeeper:reduce", "POST", "/agents/trade-gatekeeper", { token: "cardano", size_usd: 20000000, side: "buy" }, { arr: 3, keys: 14, str: 320, depth: 8 });
  await grab("agent:trade-gatekeeper:block", "POST", "/agents/trade-gatekeeper", { token: "chainlink", size_usd: 5000000, side: "sell" }, { arr: 3, keys: 14, str: 320, depth: 8 });
  // A STOP from Wallet Guard: a recipient on the OFAC sanctions list.
  await grab("agent:wallet-guard:stop", "POST", "/agents/wallet-guard", { to_address: "0x0330070fd38ec3bb94f58fa55d40368271e9e54a", chain: "eth" }, { arr: 3, keys: 14, str: 320, depth: 8 });

  writeFileSync(new URL("../lib/docs/examples.json", import.meta.url), JSON.stringify({ captured_at: new Date().toISOString(), base: BASE, examples: out }, null, 1) + "\n");
  console.log(`\nWrote ${Object.keys(out).length} examples to lib/docs/examples.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
