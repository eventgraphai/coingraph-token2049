import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { Category } from "@/lib/jobs-meta";
import { loadStatus, type Feed, type JobRow, type Level } from "@/lib/status";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = {
  title: "Pipeline status — CoinGraph",
  description: "Live health of CoinGraph's data feeds, jobs, coverage and budget.",
};

const CATEGORY_ORDER: Category[] = ["market", "spot", "futures", "onchain", "intelligence", "maintenance"];

const levelStyle: Record<Level, string> = {
  ok: "bg-life/15 text-life ring-life/30",
  late: "bg-ember/15 text-ember ring-ember/30",
  down: "bg-blood/15 text-blood ring-blood/30",
};
const levelText: Record<Level, string> = { ok: "text-life", late: "text-ember", down: "text-blood" };

function Pill({ level, children }: { level: Level; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${levelStyle[level]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

const secondsBetween = (a: Date | string | null | undefined, now: Date) => (a ? Math.round((now.getTime() - new Date(a).getTime()) / 1000) : null);

function span(s: number): string {
  const a = Math.abs(s);
  if (a < 90) return `${a}s`;
  if (a < 5400) return `${Math.round(a / 60)}m`;
  if (a < 172800) return `${Math.round(a / 3600)}h`;
  return `${Math.round(a / 86400)}d`;
}
const ago = (from: Date | string | null | undefined, now: Date) => {
  const s = secondsBetween(from, now);
  return s === null ? "never" : `${span(s)} ago`;
};
const until = (to: Date, now: Date) => {
  const s = Math.round((to.getTime() - now.getTime()) / 1000);
  return s <= 2 ? "now" : `in ${span(s)}`;
};
const cadence = (sec: number) => (sec >= 86400 ? "daily" : sec >= 3600 ? `every ${sec / 3600}h` : sec >= 60 ? `every ${sec / 60} min` : `every ${sec}s`);
const ms = (v: number | null | undefined) => (v == null ? "—" : v >= 10_000 ? `${Math.round(v / 1000)}s` : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);
const num = (v: number | null | undefined) => (v == null ? "—" : Intl.NumberFormat("en", { notation: Math.abs(v) >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(v));
const bytes = (b: number | null | undefined) => {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = b;
  while (Math.abs(v) >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
};

function ageLevel(seconds: number | null, expectedSec: number): Level {
  if (seconds === null) return "down";
  return seconds <= expectedSec * 2.5 ? "ok" : seconds <= expectedSec * 6 ? "late" : "down";
}

function jobLevel(j: JobRow, now: Date): Level {
  if (j.last_status === "failed" || j.last_status === "timeout") return "down";
  const sinceRun = secondsBetween(j.last_run, now);
  if (sinceRun === null) return j.every_sec >= 3600 ? "ok" : "late"; // not run yet since tracking started
  if (sinceRun > j.every_sec * 3 + 120) return "down";
  if (j.failed_1h > 0 || (j.success_pct !== null && j.success_pct < 95)) return "late";
  if (j.median_rows && j.median_rows > 0 && (j.last_rows ?? 0) < j.median_rows * 0.5) return "late";
  return "ok";
}

const DEMO_COLUMNS: { key: string; label: string; expected: number }[] = [
  { key: "coingecko", label: "CoinGecko", expected: 60 },
  { key: "spot_1m", label: "Spot 1m", expected: 60 },
  { key: "perp_1m", label: "Perp 1m", expected: 60 },
  { key: "funding", label: "Funding", expected: 300 },
  { key: "open_interest", label: "Open interest", expected: 300 },
  { key: "positioning", label: "Positioning", expected: 300 },
  { key: "order_book", label: "Order book", expected: 300 },
  { key: "dex_pools", label: "DEX pools", expected: 900 },
];

export default async function StatusPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection(); // always render live data at request time

  // Optional gate: when STATUS_TOKEN is set, the page requires ?token=<value>.
  const token = process.env.STATUS_TOKEN;
  if (token && (await searchParams).token !== token) notFound();

  const data = await loadStatus();
  const now = new Date(data.now);
  const { coverage, budget } = data;

  const worker = data.heartbeats[0] ?? null;
  const workerAge = secondsBetween(worker?.last_beat, now);
  const workerLevel: Level = workerAge === null ? "down" : workerAge <= 90 ? "ok" : workerAge <= 300 ? "late" : "down";

  const feedCounts = { ok: 0, late: 0, down: 0 } as Record<Level, number>;
  for (const f of data.feeds) feedCounts[f.status]++;
  const jobLevels = new Map(data.jobs.map((j) => [j.job, jobLevel(j, now)]));
  const jobCounts = { ok: 0, late: 0, down: 0 } as Record<Level, number>;
  for (const l of jobLevels.values()) jobCounts[l]++;

  const cg = coverage.coingecko;
  const cgLevel: Level = cg.fresh_10m >= cg.universe - 2 ? "ok" : cg.fresh_10m >= cg.universe * 0.9 ? "late" : "down";
  const candleLevel: Level =
    coverage.candles.fresh >= coverage.candles.expected - 1 ? "ok" : coverage.candles.fresh >= coverage.candles.expected * 0.9 ? "late" : "down";
  const budgetLevel: Level = budget.projectedAtMonthEnd === null ? "late" : budget.projectedAtMonthEnd > 5000 ? "ok" : budget.projectedAtMonthEnd > 0 ? "late" : "down";

  const worst: Level[] = [
    workerLevel,
    feedCounts.down ? "down" : feedCounts.late ? "late" : "ok",
    jobCounts.down ? "down" : jobCounts.late ? "late" : "ok",
    cgLevel,
    candleLevel,
    budgetLevel,
  ];
  const overall: Level = worst.includes("down") ? "down" : worst.includes("late") ? "late" : "ok";
  const overallText = { ok: "All systems collecting", late: "Degraded — something needs attention", down: "Problem — a feed, job or the worker is down" }[overall];
  const downCount = feedCounts.down + jobCounts.down;
  const lateCount = feedCounts.late + jobCounts.late;
  const tabTitle = overall === "ok" ? "✓ Pipeline status" : `${overall === "down" ? "✕" : "!"} ${downCount} down · ${lateCount} late — Pipeline`;

  // Timeline: last 60 minutes, one cell per minute per job.
  const minutes = Array.from({ length: 60 }, (_, i) => {
    const d = new Date(now);
    d.setUTCSeconds(0, 0);
    d.setUTCMinutes(d.getUTCMinutes() - (59 - i));
    return d.getTime();
  });
  const runIndex = new Map(data.runs.map((r) => [`${r.job}|${new Date(r.minute).getTime()}`, r.status]));
  const largestMax = Math.max(1, ...Object.values(budget.largest));

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6">
      {/* Header */}
      <header className="flex flex-col gap-4 border-b border-edge pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-[0.12em] text-mist uppercase">CoinGraph · Data pipeline</p>
          <h1 className="text-2xl font-semibold text-balance text-bone sm:text-3xl">Pipeline status</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Pill level={overall}>{overallText}</Pill>
            <span className="text-sm text-mist">
              Feeds {feedCounts.ok}/{data.feeds.length} ok · Jobs {jobCounts.ok}/{data.jobs.length} ok
            </span>
          </div>
        </div>
        <AutoRefresh renderedAt={now.toISOString()} title={tabTitle} />
      </header>

      {/* Summary */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Summary">
        <Tile
          label="Ingestion worker"
          level={workerLevel}
          value={worker ? `beat ${ago(worker.last_beat, now)}` : "no heartbeat"}
          detail={worker ? `up ${span(secondsBetween(worker.started_at, now) ?? 0)} · ${worker.meta?.rss_mb ?? "?"} MB · ${worker.meta?.pool ?? ""} pool` : "Start: npm run worker:supervised"}
        />
        <Tile
          label="Feeds & jobs"
          level={downCount ? "down" : lateCount ? "late" : "ok"}
          value={`${feedCounts.ok + jobCounts.ok}/${data.feeds.length + data.jobs.length} ok`}
          detail={`${lateCount} late · ${downCount} down`}
        />
        <Tile label="Top-100 coverage" level={cgLevel} value={`${cg.fresh_10m}/${cg.universe} coins`} detail={`${cg.minute_coverage_pct}% of minutes in the last hour`} />
        <Tile
          label="1-minute candles"
          level={candleLevel}
          value={`${coverage.candles.fresh}/${coverage.candles.expected} live`}
          detail={`${coverage.candles.complete_hour} complete for the last hour`}
        />
        <Tile
          label="CoinGecko credits"
          level={budgetLevel}
          value={num(budget.remaining)}
          detail={budget.daysLeft !== null ? `${num(budget.burnPerDay)}/day · lasts ${budget.daysLeft.toFixed(0)} days` : "burn rate not measured yet"}
        />
        <Tile
          label="Database"
          level={budget.connections > budget.maxConnections * 0.8 ? "late" : "ok"}
          value={bytes(budget.dbBytes)}
          detail={`${budget.growthPerDay !== null ? `+${bytes(budget.growthPerDay)}/day · ` : ""}${budget.connections}/${budget.maxConnections} connections`}
        />
      </section>

      {/* Coverage */}
      <Section title="Coverage" subtitle="Is data arriving for every coin and series — not only are the jobs running.">
        <div className="grid gap-3 lg:grid-cols-3">
          <Card title="CoinGecko · top 100" level={cgLevel}>
            <Stat label="Updated in the last 10 min" value={`${cg.fresh_10m} / ${cg.universe}`} />
            <Stat label="Minutes covered (last hour, avg per coin)" value={`${cg.minute_coverage_pct}%`} />
            <p className="mt-2 text-xs text-mist">
              {coverage.coingeckoMissing.length === 0
                ? "Every coin updated within 15 minutes."
                : `Not updated for 15+ min: ${coverage.coingeckoMissing.map((m) => `${m.symbol} (${ago(m.last, now)})`).join(", ")}`}
            </p>
          </Card>
          <Card title="1-minute candles · primary venues" level={candleLevel}>
            <Stat label="Series expected (spot + perp)" value={String(coverage.candles.expected)} />
            <Stat label="Fresh (candle in the last 5 min)" value={`${coverage.candles.fresh} / ${coverage.candles.expected}`} />
            <Stat label="Complete last hour (≥ 58 of 60)" value={`${coverage.candles.complete_hour} / ${coverage.candles.expected}`} />
          </Card>
          <Card
            title="Futures · symbols reporting"
            level={coverage.futures.every((v) => v.oi_fresh >= v.mapped * 0.9 && v.funding_fresh >= v.mapped * 0.9) ? "ok" : "late"}
          >
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-mist">
                  <th className="py-1 font-medium">Venue</th>
                  <th className="font-medium">Open interest</th>
                  <th className="font-medium">Funding</th>
                  <th className="font-medium">Positioning</th>
                </tr>
              </thead>
              <tbody>
                {coverage.futures.map((v) => (
                  <tr key={v.venue} className="border-t border-edge/60 tabular-nums">
                    <td className="py-1 font-mono text-bone">{v.venue}</td>
                    <td className={v.oi_fresh >= v.mapped * 0.9 ? "text-bone" : "text-ember"}>{v.oi_fresh}/{v.mapped}</td>
                    <td className={v.funding_fresh >= v.mapped * 0.9 ? "text-bone" : "text-ember"}>{v.funding_fresh}/{v.mapped}</td>
                    <td className={v.positioning_fresh >= v.mapped * 0.9 ? "text-bone" : "text-ember"}>{v.positioning_fresh}/{v.mapped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <div className="overflow-x-auto rounded-lg border border-edge bg-ink">
          <table className="w-full min-w-[860px] text-sm">
            <caption className="px-4 pt-3 text-left text-xs font-medium tracking-wide text-mist uppercase">Demo coins · age of each data type</caption>
            <thead>
              <tr className="text-left text-xs text-mist">
                <th className="px-4 py-2.5 font-medium">Coin</th>
                {DEMO_COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2.5 font-medium whitespace-nowrap">{c.label}</th>
                ))}
                <th className="px-3 py-2.5 font-medium whitespace-nowrap">Last liquidation</th>
              </tr>
            </thead>
            <tbody>
              {coverage.demo.map((row) => (
                <tr key={String(row.coingecko_id)} className="border-t border-edge/70">
                  <td className="px-4 py-2.5 font-medium text-bone">{String(row.symbol)}</td>
                  {DEMO_COLUMNS.map((c) => {
                    const s = secondsBetween(row[c.key] as Date | null, now);
                    return (
                      <td key={c.key} className={`px-3 py-2.5 whitespace-nowrap tabular-nums ${levelText[ageLevel(s, c.expected)]}`}>
                        {s === null ? "none" : span(s)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 whitespace-nowrap text-mist tabular-nums">{ago(row.last_liquidation as Date | null, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Categories */}
      {CATEGORY_ORDER.map((cat) => {
        const jobs = data.jobs.filter((j) => j.category === cat);
        const feeds = data.feeds.filter((f) => f.category === cat);
        if (!jobs.length && !feeds.length) {
          return (
            <Section key={cat} title={data.categories[cat]} subtitle="Not built yet — appears here once its jobs are scheduled." badge={<Pill level="late">not started</Pill>}>
              {null}
            </Section>
          );
        }
        const c = { ok: 0, late: 0, down: 0 } as Record<Level, number>;
        jobs.forEach((j) => c[jobLevels.get(j.job)!]++);
        feeds.forEach((f) => c[f.status]++);
        const level: Level = c.down ? "down" : c.late ? "late" : "ok";
        return (
          <Section
            key={cat}
            title={data.categories[cat]}
            subtitle={`${jobs.length} jobs · ${feeds.length} feeds`}
            badge={
              <Pill level={level}>
                {c.ok} ok{c.late ? ` · ${c.late} late` : ""}
                {c.down ? ` · ${c.down} down` : ""}
              </Pill>
            }
          >
            {jobs.length > 0 && (
              <Table caption="Jobs" head={["Job", "Status", "Next run", "Success 24h", "Typical / slow", "Time-limit use", "Rows: last vs normal", "Last run", "Failed 1h / 24h"]}>
                {jobs.map((j) => {
                  const rowsLow = !!j.median_rows && j.median_rows > 0 && (j.last_rows ?? 0) < j.median_rows * 0.5;
                  return (
                    <tr key={j.job} className="border-t border-edge/70 align-top hover:bg-slab-raised/60">
                      <Td>
                        <span className="block font-mono text-xs text-bone">{j.job}</span>
                        <span className="text-xs text-mist">
                          {j.label} · {cadence(j.every_sec)}
                        </span>
                      </Td>
                      <Td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Pill level={jobLevels.get(j.job)!}>{j.last_status ?? "waiting"}</Pill>
                          {j.running_now ? <span className="text-xs text-mist">· running now</span> : null}
                        </span>
                        {j.last_error && j.last_status !== "ok" ? (
                          <p className="mt-1 max-w-xs text-xs break-words whitespace-normal text-blood/90">{j.last_error.slice(0, 160)}</p>
                        ) : null}
                      </Td>
                      <Td muted>{until(j.next_run, now)}</Td>
                      <Td num className={j.success_pct !== null && j.success_pct < 95 ? "text-ember" : ""}>
                        {j.success_pct === null ? "—" : `${j.success_pct}%`}
                        <span className="text-xs text-mist"> · {j.runs_24h} runs</span>
                      </Td>
                      <Td num muted>
                        {ms(j.p50_ms)} / {ms(j.p95_ms)}
                      </Td>
                      <Td>
                        <Meter pct={j.headroom_pct} />
                      </Td>
                      <Td num className={rowsLow ? "text-ember" : ""}>
                        {num(j.last_rows)} <span className="text-xs text-mist">vs {num(j.median_rows)}</span>
                      </Td>
                      <Td muted>{ago(j.last_run, now)}</Td>
                      <Td num className={j.failed_1h || j.failed_24h ? "text-ember" : ""}>
                        {j.failed_1h} / {j.failed_24h}
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )}
            {feeds.length > 0 && (
              <Table caption="Feeds (external APIs)" head={["Feed", "Venue", "Status", "Cadence", "Last success", "Calls / failed 1h", "Rows 1h", "Avg latency", "Credits 24h"]}>
                {feeds.map((f: Feed) => (
                  <tr key={f.feed} className="border-t border-edge/70 hover:bg-slab-raised/60">
                    <Td mono>{f.feed}</Td>
                    <Td muted>{f.venues}</Td>
                    <Td>
                      <Pill level={f.status}>{f.status}</Pill>
                    </Td>
                    <Td muted>{cadence(f.every_sec)}</Td>
                    <Td>{f.age_sec == null ? "never" : `${span(f.age_sec)} ago`}</Td>
                    <Td num className={f.failures_1h ? "text-blood" : ""}>
                      {num(f.calls_1h)} / {f.failures_1h}
                    </Td>
                    <Td num>{num(f.rows_1h)}</Td>
                    <Td num muted>{ms(f.avg_latency_ms_1h)}</Td>
                    <Td num muted>{f.credits_24h === null ? "free" : num(f.credits_24h)}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Section>
        );
      })}

      {/* Venues */}
      <Section title="Exchange & API health" subtitle="Every provider we call, over the last hour — shows which venue is failing, not just which job.">
        <Table head={["Provider", "Calls 1h", "Failed 1h", "Typical latency", "Last success", "Last error"]}>
          {data.venues.map((v) => {
            const lvl: Level = v.failed_1h === 0 ? "ok" : v.failed_1h < v.calls_1h * 0.2 ? "late" : "down";
            return (
              <tr key={v.provider} className="border-t border-edge/70 align-top hover:bg-slab-raised/60">
                <Td>
                  <span className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${lvl === "ok" ? "bg-life" : lvl === "late" ? "bg-ember" : "bg-blood"}`} aria-hidden />
                    <span className="font-mono text-xs">{v.provider}</span>
                  </span>
                </Td>
                <Td num>{v.calls_1h}</Td>
                <Td num className={v.failed_1h ? "text-blood" : ""}>{v.failed_1h}</Td>
                <Td num muted>{ms(v.p50_ms)}</Td>
                <Td muted>{ago(v.last_ok, now)}</Td>
                <Td className="max-w-md break-words whitespace-normal text-blood/90">{v.last_error ?? <span className="text-mist">—</span>}</Td>
              </tr>
            );
          })}
        </Table>
      </Section>

      {/* Budget & capacity */}
      <Section title="Budget & capacity" subtitle="Will the CoinGecko credits last the month, and how fast is the database growing.">
        <div className="grid gap-3 md:grid-cols-2">
          <Card title="CoinGecko credits (account-wide)" level={budgetLevel}>
            <Stat label="Remaining" value={num(budget.remaining)} />
            <Stat label="Used by CoinGraph today / last 24h" value={`${num(budget.usedToday)} / ${num(budget.burnPerDay)}`} />
            <Stat label="Lasts at this rate" value={budget.daysLeft !== null ? `${budget.daysLeft.toFixed(1)} days` : "—"} />
            <Stat label={`Projected at month end (${budget.daysToMonthEnd.toFixed(1)} days away)`} value={num(budget.projectedAtMonthEnd)} level={budgetLevel} />
            <p className="mt-2 text-xs text-mist">
              Checked {ago(budget.checkedAt, now)}. Credits are shared by every key on the account; per-feed use is in the Feeds tables above.
            </p>
          </Card>
          <Card title="Database (Supabase · Small)" level={budget.connections > budget.maxConnections * 0.8 ? "late" : "ok"}>
            <Stat label="Size" value={bytes(budget.dbBytes)} />
            <Stat label="Growth per day" value={budget.growthPerDay !== null ? bytes(budget.growthPerDay) : "measuring…"} />
            <Stat label="Connections in use" value={`${budget.connections} / ${budget.maxConnections}`} />
            <div className="mt-3">
              <p className="mb-1 text-xs text-mist">Largest tables</p>
              <ul className="flex flex-col gap-1">
                {Object.entries(budget.largest)
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, size]) => (
                    <li key={t} className="flex items-center gap-3 text-xs">
                      <span className="w-44 truncate font-mono text-bone">{t}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded bg-edge/60">
                        <span className="block h-full bg-brand/70" style={{ width: `${Math.max(2, (size / largestMax) * 100)}%` }} />
                      </span>
                      <span className="w-16 text-right text-mist tabular-nums">{bytes(size)}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <p className="mt-2 text-xs text-mist">
              {budget.metricsSince ? `Growth measured since ${ago(budget.metricsSince, now)}.` : "Growth appears after a few hourly snapshots."} Minute data is kept 14 days,
              then hourly.
            </p>
          </Card>
        </div>
      </Section>

      {/* Timeline */}
      <Section title="Last 60 minutes" subtitle="One square per minute per job. Green ran fine · red failed or timed out · outlined still running · grey no run.">
        <div className="overflow-x-auto rounded-lg border border-edge bg-ink">
          <div className="min-w-[760px] p-4">
            <div className="mb-2 grid grid-cols-[220px_1fr] gap-3 text-[11px] text-mist">
              <span />
              <div className="flex justify-between tabular-nums">
                <span>−60 min</span>
                <span>−30 min</span>
                <span>now</span>
              </div>
            </div>
            {CATEGORY_ORDER.filter((cat) => data.jobs.some((j) => j.category === cat)).map((cat) => (
              <div key={cat} className="mb-3">
                <p className="mb-1 text-[11px] font-medium tracking-wide text-mist uppercase">{data.categories[cat]}</p>
                <div className="flex flex-col gap-1.5">
                  {data.jobs
                    .filter((j) => j.category === cat)
                    .map((j) => (
                      <div key={j.job} className="grid grid-cols-[220px_1fr] items-center gap-3">
                        <span className="truncate font-mono text-xs text-bone">{j.job}</span>
                        <div className="grid grid-cols-[repeat(60,minmax(0,1fr))] gap-[2px]">
                          {minutes.map((m) => {
                            const st = runIndex.get(`${j.job}|${m}`);
                            const cls = st === "ok" ? "bg-life/80" : st === "failed" ? "bg-blood" : st === "running" ? "ring-1 ring-inset ring-mist" : "bg-edge/40";
                            return <span key={m} className={`h-3 rounded-[2px] ${cls}`} title={`${j.job} · ${new Date(m).toISOString().slice(11, 16)} UTC${st ? ` · ${st}` : ""}`} />;
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Freshness */}
      <Section title="Data freshness" subtitle="Newest row per table, compared with how often it should update.">
        <Table head={["Table", "Status", "Updates", "Newest row", "Rows (approx.)"]}>
          {data.freshness.map((t) => {
            const expectedMin = t.cadence.includes("daily") ? 1440 : Number(/(\d+)\s*min/.exec(t.cadence)?.[1] ?? 5);
            const level = ageLevel(secondsBetween(t.newest, now), expectedMin * 60);
            return (
              <tr key={t.name} className="border-t border-edge/70 hover:bg-slab-raised/60">
                <Td mono>{t.name}</Td>
                <Td>
                  <Pill level={level}>{level}</Pill>
                </Td>
                <Td muted>{t.cadence}</Td>
                <Td>{ago(t.newest, now)}</Td>
                <Td num>{Number(t.rows) > 0 ? num(Number(t.rows)) : "—"}</Td>
              </tr>
            );
          })}
        </Table>
      </Section>

      {/* Failures */}
      <Section title="Recent failures (24h)" subtitle="Failed or timed-out job runs and failed API calls, newest first.">
        {data.failures.length === 0 ? (
          <p className="rounded-lg border border-edge bg-ink px-4 py-6 text-sm text-mist">No failures in the last 24 hours.</p>
        ) : (
          <Table head={["When", "Source", "What", "Error"]}>
            {data.failures.map((f, i) => (
              <tr key={i} className="border-t border-edge/70 align-top hover:bg-slab-raised/60">
                <Td muted>{ago(f.at, now)}</Td>
                <Td mono>{f.source}</Td>
                <Td mono>{f.what}</Td>
                <Td className="max-w-xl break-words whitespace-normal text-blood/90">{f.error.slice(0, 240)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      <footer className="border-t border-edge pt-4 text-xs text-mist">
        Sources: <span className="font-mono">job_runs</span>, <span className="font-mono">worker_heartbeats</span>, <span className="font-mono">ingestion_health</span>,{" "}
        <span className="font-mono">api_calls</span>, <span className="font-mono">symbol_map</span>, <span className="font-mono">system_metrics</span>. Schedule from{" "}
        <span className="font-mono">lib/jobs-meta.ts</span>.
      </footer>
    </main>
  );
}

function Tile({ label, value, detail, level }: { label: string; value: string; detail: string; level: Level }) {
  const bar = { ok: "bg-life", late: "bg-ember", down: "bg-blood" }[level];
  return (
    <div className="relative overflow-hidden rounded-lg border border-edge bg-slab p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden />
      <p className="text-xs font-medium tracking-wide text-mist uppercase">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-bone">{value}</p>
      <p className="mt-1 text-xs text-mist">{detail}</p>
    </div>
  );
}

function Card({ title, level, children }: { title: string; level: Level; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-edge bg-slab p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-bone">{title}</p>
        <Pill level={level}>{level}</Pill>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

function Stat({ label, value, level }: { label: string; value: string; level?: Level }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-mist">{label}</span>
      <span className={`font-medium tabular-nums ${level ? levelText[level] : "text-bone"}`}>{value}</span>
    </div>
  );
}

function Meter({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-mist">—</span>;
  const color = pct >= 75 ? "bg-blood" : pct >= 40 ? "bg-ember" : "bg-life";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded bg-edge/60">
        <span className={`block h-full ${color}`} style={{ width: `${Math.min(100, Math.max(3, pct))}%` }} />
      </span>
      <span className="text-xs text-mist tabular-nums">{pct}%</span>
    </span>
  );
}

function Section({ title, subtitle, badge, children }: { title: string; subtitle: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-bone">{title}</h2>
          <p className="text-sm text-mist">{subtitle}</p>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Table({ head, caption, children }: { head: string[]; caption?: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-ink">
      <table className="w-full min-w-[860px] text-sm">
        {caption ? <caption className="px-4 pt-3 text-left text-xs font-medium tracking-wide text-mist uppercase">{caption}</caption> : null}
        <thead>
          <tr className="text-left text-xs text-mist">
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({ children, mono, num: isNum, muted, className = "" }: { children: React.ReactNode; mono?: boolean; num?: boolean; muted?: boolean; className?: string }) {
  const color = /\btext-(blood|ember|life)/.test(className) ? "" : muted ? "text-mist" : "text-bone";
  return <td className={`px-4 py-2.5 whitespace-nowrap ${mono ? "font-mono text-xs" : ""} ${isNum ? "tabular-nums" : ""} ${color} ${className}`}>{children}</td>;
}
