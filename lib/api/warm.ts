import { sql } from "../db";
import { newId, ok, prime } from "./respond";
import { buildState } from "./state";
import { buildMarket } from "./market";

// Cache warmer: keeps the default state object for the top tokens, and the market object, warm in the
// response cache so a burst of first-time callers never waits for a cold build. Runs inside the web process.

const WARM_TOKENS = Number(process.env.API_WARM_TOKENS ?? 60);
const EVERY_MS = Number(process.env.API_WARM_EVERY_SEC ?? 120) * 1000;
const PARALLEL = 3;
const STATE_TTL = 120;

async function warmOnce(): Promise<void> {
  const tokens = await sql<{ coingecko_id: string; symbol: string; name: string; market_cap_rank: number | null; is_stablecoin: boolean; is_demo: boolean }[]>`
    select coingecko_id, symbol, name, market_cap_rank, is_stablecoin, is_demo from tokens where in_universe order by is_demo desc, market_cap_rank nulls last limit ${WARM_TOKENS}`;
  await prime("/api/v1/market", 60, async () => {
    const m = await buildMarket();
    return ok("market", m.sections, { id: newId("mk"), sources: m.sources });
  });
  for (let i = 0; i < tokens.length; i += PARALLEL) {
    await Promise.all(tokens.slice(i, i + PARALLEL).map((t) => prime(`/api/v1/state/${t.coingecko_id}`, STATE_TTL, async () => {
      const st = await buildState(t);
      return ok("state", { token: st.token, ...st.sections }, { id: newId("st"), as_of: st.as_of ?? undefined, sources: st.sources });
    })));
  }
}

const g = globalThis as unknown as { coingraphWarmer?: NodeJS.Timeout };
export function startWarmer(): void {
  if (g.coingraphWarmer || process.env.API_WARM === "off" || process.env.NEXT_PHASE === "phase-production-build") return;
  const run = () => warmOnce().catch((err) => console.warn(`[api:warm] ${(err as Error).message.slice(0, 120)}`));
  setTimeout(run, 2_000);
  g.coingraphWarmer = setInterval(run, EVERY_MS);
  g.coingraphWarmer.unref?.();
}
