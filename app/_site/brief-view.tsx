import Link from "next/link";
import { sql } from "@/lib/db";
import type { Brief, Claim } from "@/lib/investigations/brief";
import type { Evidence } from "@/lib/investigations/evidence";

// One brief, rendered for people. Used by the public /briefs/{id} page and the private ops page.

export type Row = {
  id: number; coingecko_id: string; symbol: string; name: string; status: string; score: string | null; opened_at: Date; started_at: Date | null; finished_at: Date | null;
  headline: string | null; brief: Brief | null; evidence: Evidence | null; model: string | null; error: string | null; verification: Record<string, unknown> | null;
};

const DIR = { bullish: "bg-life/15 text-life ring-life/30", bearish: "bg-blood/15 text-blood ring-blood/30", neutral: "bg-slab text-mist ring-edge" } as Record<string, string>;

function Claims({ title, claims }: { title: string; claims: Claim[] | undefined }) {
  if (!claims?.length) return null;
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mist">{title}</h2>
      <ul className="space-y-2">
        {claims.map((c, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
            <span>
              {c.text}{" "}
              {c.evidence.map((e) => (
                <a key={e} href={`#${e}`} className="numerals ml-1 rounded border border-edge bg-slab px-1.5 py-0.5 text-[11px] text-mist hover:text-bone">{e}</a>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function loadBrief(id: number, publicOnly: boolean): Promise<Row | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [row] = await sql<Row[]>`
    select i.*, upper(t.symbol) as symbol, t.name from investigations i join tokens t using (coingecko_id)
    where i.id = ${id} and (${!publicOnly} or i.status = 'done')`;
  return row ?? null;
}

export function BriefView({ row, back }: { row: Row; back: { href: string; label: string } }) {
  const b = row.brief;
  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <div className="mb-6 text-xs text-mist"><Link href={back.href} className="hover:text-bone">← {back.label}</Link> · Brief #{row.id} · <Link href={`/proof/${row.id}`} className="hover:text-bone">Proof</Link></div>
      <header className="mb-8">
        <p className="numerals text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">{row.name} · {row.symbol}</p>
        <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{row.headline ?? (row.status === "failed" ? "Investigation failed" : "Investigating…")}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-mist">
          {b && <span className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${DIR[b.direction] ?? DIR.neutral}`}>{b.direction}</span>}
          {b && <span className="rounded-full bg-slab px-2 py-0.5 ring-1 ring-inset ring-edge">severity {b.severity}/3</span>}
          {b && <span className="rounded-full bg-slab px-2 py-0.5 ring-1 ring-inset ring-edge">confidence {Math.round(b.confidence * 100)}%</span>}
          <span className="rounded-full bg-slab px-2 py-0.5 ring-1 ring-inset ring-edge">{row.status}</span>
          {row.score && <span>score {Number(row.score).toFixed(1)}</span>}
          <span>opened {new Date(row.opened_at).toISOString().replace("T", " ").slice(0, 16)} UTC</span>
          {row.model && <span>{row.model}</span>}
        </div>
      </header>

      {row.error && <p className="mb-6 rounded-lg border border-blood/30 bg-blood/10 p-3 text-sm text-blood">{row.error}</p>}
      {b && (
        <>
          <p className="mb-8 text-[17px] leading-relaxed text-bone">{b.summary}</p>
          <Claims title="What happened" claims={b.what_happened} />
          {b.likely_causes?.length ? (
            <section className="mb-7">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mist">Likely causes</h2>
              <ol className="space-y-2">
                {b.likely_causes.map((c, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                    <span className="numerals mt-0.5 text-mist">{i + 1}.</span>
                    <span>{c.cause} <span className="numerals text-xs text-mist">({Math.round(c.confidence * 100)}%)</span>{" "}
                      {c.evidence.map((e) => <a key={e} href={`#${e}`} className="numerals ml-1 rounded border border-edge bg-slab px-1.5 py-0.5 text-[11px] text-mist hover:text-bone">{e}</a>)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <Claims title="Onchain" claims={b.onchain} />
          <Claims title="Market context" claims={b.market_context} />
          {b.watch_next?.length ? (
            <section className="mb-7"><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mist">What to watch</h2>
              <ul className="list-disc space-y-1 pl-5 text-[15px] text-bone">{b.watch_next.map((w, i) => <li key={i}>{w}</li>)}</ul></section>
          ) : null}
          {b.caveats?.length ? (
            <section className="mb-10"><h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-mist">Caveats</h2>
              <ul className="list-disc space-y-1 pl-5 text-[15px] text-mist">{b.caveats.map((w, i) => <li key={i}>{w}</li>)}</ul></section>
          ) : null}
        </>
      )}

      {row.evidence && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-mist">Evidence ({row.evidence.items.length} items)</h2>
          <ol className="space-y-2">
            {row.evidence.items.map((e) => (
              <li key={e.id} id={e.id} className="rounded-lg border border-edge bg-slab p-3 text-sm scroll-mt-4">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-mist">
                  <span className="numerals rounded border border-edge px-1.5 py-0.5 text-bone">{e.id}</span>
                  <span>{e.kind}</span>
                  <span className="numerals">{e.source}</span>
                </div>
                <p className="text-bone">{e.summary}</p>
                <details className="mt-1 text-xs text-mist"><summary className="cursor-pointer">data</summary><pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(e.data, null, 1)}</pre></details>
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
