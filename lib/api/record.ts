import { sql } from "../db";
import { num, round } from "./respond";

// GET /v1/record[/{token}]: the public scorecard. Every evaluation, signal and brief we issued, what the
// price did afterwards, and whether the call was right. Graded in public.

type Entry = { kind: string; id: string; token: string; symbol: string; at: Date; said: string; direction: string | null; severity: number | null; price_at: number | null; after: Record<string, number | null>; outcome: string | null };

export async function buildRecord(token: string | null, since: Date | null, kind: string | null) {
  const from = since ?? new Date(Date.now() - 7 * 86_400_000);
  const rows = await sql<Entry[]>`
    with items as (
      select 'evaluation' as kind, e.id::text as id, e.coingecko_id as token, e.created_at as at, e.verdict as said,
             case e.verdict when 'proceed' then 'up' when 'avoid' then 'down' else 'neutral' end as direction, null::int as severity
      from evaluations e where e.created_at >= ${from} ${token ? sql`and e.coingecko_id = ${token}` : sql``}
      union all
      select 'signal', s.id::text, s.coingecko_id, s.event_ts, s.kind, s.direction, s.severity
      from signals s where s.coingecko_id is not null and s.event_ts >= ${from} ${token ? sql`and s.coingecko_id = ${token}` : sql``}
      union all
      select 'brief', i.id::text, i.coingecko_id, i.finished_at, coalesce(i.headline, ''), case i.brief->>'direction' when 'bullish' then 'up' when 'bearish' then 'down' else 'neutral' end, (i.brief->>'severity')::int
      from investigations i where i.status = 'done' and i.finished_at >= ${from} ${token ? sql`and i.coingecko_id = ${token}` : sql``}
    )
    select it.kind, it.id, it.token, upper(t.symbol) as symbol, it.at, it.said, it.direction, it.severity,
      (select current_price from market_snapshots m where m.coingecko_id = it.token and m.captured_at <= it.at order by captured_at desc limit 1) as price_at,
      (select current_price from market_snapshots m where m.coingecko_id = it.token and m.captured_at >= it.at + interval '1 hour' order by captured_at limit 1) as p_1h,
      (select current_price from market_snapshots m where m.coingecko_id = it.token and m.captured_at >= it.at + interval '24 hours' order by captured_at limit 1) as p_24h,
      (select current_price from market_snapshots m where m.coingecko_id = it.token and m.captured_at >= it.at + interval '7 days' order by captured_at limit 1) as p_7d
    from items it join tokens t on t.coingecko_id = it.token
    ${kind ? sql`where it.kind = ${kind}` : sql``}
    order by it.at desc limit 500`;

  const ledger = rows.map((r) => {
    const p0 = num(r.price_at);
    const ret = (p: unknown) => (p0 && num(p) !== null ? round((num(p)! / p0 - 1) * 100, 2) : null);
    const after = { "1h": ret((r as unknown as { p_1h: unknown }).p_1h), "24h": ret((r as unknown as { p_24h: unknown }).p_24h), "7d": ret((r as unknown as { p_7d: unknown }).p_7d) };
    // A directional call is graded on the 24h return when available, else 1h. Neutral calls are not graded.
    const horizon = after["24h"] !== null ? "24h" : after["1h"] !== null ? "1h" : null;
    let outcome: string | null = null;
    if (horizon && r.direction && r.direction !== "neutral") {
      const v = after[horizon]!;
      outcome = r.direction === "up" ? (v > 0 ? "right" : "wrong") : v < 0 ? "right" : "wrong";
    } else if (horizon && r.kind === "evaluation" && r.said === "caution") {
      outcome = Math.abs(after[horizon]!) >= 2 ? "right" : "wrong"; // caution is right when the asset moved sharply either way
    }
    return { kind: r.kind, id: r.id, token: r.token, symbol: r.symbol, at: r.at, said: r.said, direction: r.direction, severity: r.severity, price_at: p0, return_after_pct: after, graded_on: horizon, outcome };
  });

  const graded = ledger.filter((l) => l.outcome);
  const byKind: Record<string, { calls: number; graded: number; right: number; hit_rate_pct: number | null }> = {};
  for (const l of ledger) {
    const k = (byKind[l.kind] ??= { calls: 0, graded: 0, right: 0, hit_rate_pct: null });
    k.calls++;
    if (l.outcome) { k.graded++; if (l.outcome === "right") k.right++; }
  }
  for (const k of Object.values(byKind)) k.hit_rate_pct = k.graded ? round((k.right / k.graded) * 100, 1) : null;
  const bySeverity: Record<string, { graded: number; right: number; hit_rate_pct: number | null }> = {};
  for (const l of graded.filter((g) => g.severity)) {
    const k = (bySeverity[String(l.severity)] ??= { graded: 0, right: 0, hit_rate_pct: null });
    k.graded++;
    if (l.outcome === "right") k.right++;
  }
  for (const k of Object.values(bySeverity)) k.hit_rate_pct = k.graded ? round((k.right / k.graded) * 100, 1) : null;

  return {
    scope: token ?? "universe", since: from.toISOString(),
    calibration: { total_calls: ledger.length, graded: graded.length, hit_rate_pct: graded.length ? round((graded.filter((g) => g.outcome === "right").length / graded.length) * 100, 1) : null, by_kind: byKind, by_severity: bySeverity,
      method: "Directional calls (up/down) are graded on the 24h return (1h if 24h is not yet available). 'caution' is right when the asset moved ≥2% either way. Neutral calls are listed but not graded." },
    ledger,
  };
}
