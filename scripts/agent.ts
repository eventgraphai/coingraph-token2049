import { sql } from "../lib/db";
import { runAgent } from "../lib/agents/core";
import { AGENTS, AGENT_BY_ID } from "../lib/agents/registry";

// Run a CoinGraph agent from the command line.
//   npx tsx scripts/agent.ts                                  → list agents
//   npx tsx scripts/agent.ts trade-gatekeeper '{"token":"uniswap","size_usd":250000}'
//   npx tsx scripts/agent.ts whale-watch aave                 → a bare token works for single-token agents
//   add --json for the full machine-readable run
async function main() {
  const [id, raw, ...flags] = process.argv.slice(2);
  if (!id) {
    for (const a of AGENTS) console.log(`${a.id.padEnd(24)} ${a.tier.padEnd(8)} ${a.tagline}`);
    return;
  }
  const def = AGENT_BY_ID.get(id);
  if (!def) throw new Error(`Unknown agent ${id}. Run without arguments to list agents.`);
  const input = raw === undefined ? def.example : raw.trim().startsWith("{") ? JSON.parse(raw) : { token: raw };
  const started = Date.now();
  const { run } = await runAgent(def, input, { requester: "cli" });
  if (flags.includes("--json") || raw === "--json") {
    console.log(JSON.stringify(run, null, 2));
  } else {
    console.log(`\n${def.name} → ${run.verdict}   (${((Date.now() - started) / 1000).toFixed(1)}s, ${run.run_id})\n`);
    console.log(run.summary, "\n");
    for (const r of run.reasons.slice(0, 8)) console.log(`  • ${r.text}  [${r.source}]`);
    if (run.warnings.length) { console.log("\n  Warnings:"); for (const w of run.warnings.slice(0, 5)) console.log(`  ! ${w}`); }
    if (typeof run.result.markdown === "string") console.log(`\n${run.result.markdown}`);
    console.log(`\n  proof: ${run.verify_url}`);
  }
}

main().then(() => sql.end()).catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await sql.end();
  process.exit(1);
});
