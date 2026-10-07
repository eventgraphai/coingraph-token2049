import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { AGENTS, TIER_PRICE } from "@/lib/agents/registry";
import { BASE_URL } from "@/lib/api/respond";
import { ago, compact, getCoverage, getExample, getFeed, getLatestBrief, getStats, SIGNAL_LABEL, type Example } from "@/lib/site/data";
import { CoverageStrip } from "./_site/coverage";
import { TONE_CHIP, TONE_TEXT, toneOf } from "@/lib/site/verdict";
import { DOCS_URL, GITHUB_URL, SectionHead, SiteFooter, SiteHeader } from "./_site/chrome";
import { CopyButton, Snippet } from "./_site/copy";
import { ProofForm } from "./_site/proof-form";

// The public homepage. The story follows the deck (problem → product → proof → model); every number on
// it is read live from this build's database.

const DIMENSIONS = ["Momentum", "Liquidity", "Leverage", "Onchain", "Supply", "Contract", "Context"];

const SOURCES: [string, string][] = [
  ["CoinGecko", "prices, volume, supply for 21,000+ coins"],
  ["Exchanges (CCXT)", "order books, funding, open interest, liquidations"],
  ["NOWNodes", "Ethereum, BNB Chain, Bitcoin, Solana and Cardano nodes"],
  ["GoPlus", "contract security: mint, pause, blacklist, owner powers"],
  ["DefiLlama", "protocol TVL"],
  ["DEX routers", "ParaSwap, KyberSwap and Jupiter swap quotes"],
  ["OFAC lists", "sanctioned addresses"],
  ["News", "four crypto newsrooms, every 15 minutes"],
  ["Fear & Greed", "market mood"],
  ["Claude", "writes the brief, citing evidence ids"],
];

const MCP_URL = `${BASE_URL}/mcp`;

export default async function Home() {
  await connection();
  const [stats, example, feed, brief, coverage] = await Promise.all([getStats(), getExample(), getFeed(), getLatestBrief(), getCoverage()]);
  const now = new Date();

  return (
    <>
      <SiteHeader />
      <main className="relative overflow-hidden">
        {/* ---------------------------------------------------------------- Hero */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[760px]">
          <div className="hero-glow absolute inset-0" />
          <div className="dot-grid absolute inset-0 opacity-60" />
        </div>
        <section className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pt-16 pb-16 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <p className="rise numerals flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
              Crypto intelligence infrastructure <span className="h-px w-16 bg-edge" />
            </p>
            <h1 className="rise rise-1 mt-5 text-[clamp(38px,5.6vw,62px)] font-semibold leading-[1.02] tracking-[-0.035em]">
              AI agents move money in crypto.
            </h1>
            <p className="rise rise-2 mt-3 text-[clamp(22px,2.8vw,30px)] font-semibold leading-tight tracking-[-0.02em] text-brand">
              CoinGraph is the check before they act.
            </p>
            <p className="rise rise-3 mt-5 max-w-xl text-[16px] leading-relaxed text-mist">
              Ask “Can my agent buy $5K of SOL right now?” and get ALLOW, with the order-book depth, funding, exchange flows and contract check behind it, plus an id anyone can verify. Every number sourced and timed; anything unmeasured says so.
            </p>
            <div className="rise rise-4 mt-8 flex flex-wrap gap-3">
              <Link href="/agents" className="btn-glow rounded-lg bg-brand px-5 py-2.5 text-[14px] font-semibold text-brand-ink">Try an agent</Link>
              <Link href="/tokens" className="rounded-lg border border-edge bg-slab px-5 py-2.5 text-[14px] font-semibold text-bone transition-colors hover:border-brand/40">Explore 100 tokens</Link>
            </div>
            <div className="rise rise-5 mt-6 flex flex-wrap items-center gap-2">
              <span className="numerals inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/5 px-3 py-1 text-[11px] uppercase tracking-[0.1em] text-brand">
                <span className="throb h-1.5 w-1.5 rounded-full bg-life text-life" /> Live
              </span>
              <span className="numerals inline-flex items-center gap-2 rounded-full border border-edge bg-slab px-3 py-1 text-[11px] text-mist">
                MCP · {MCP_URL.replace("https://", "")} <CopyButton text={MCP_URL} />
              </span>
            </div>
          </div>
          <Hub />
        </section>

        {/* ---------------------------------------------------------------- Live numbers */}
        <section aria-label="Live numbers" className="relative border-y border-edge bg-ink/60">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:px-8 md:grid-cols-4 lg:grid-cols-7" title="Live numbers from this build's database">
            <Stat value={stats ? String(stats.tokens) : "100"} label="tokens tracked deeply" />
            <Stat value={stats ? String(stats.venues) : "—"} label="exchanges read" />
            <Stat value="5" label="chains read live via NOWNodes" />
            <Stat value={stats ? compact(stats.rows) : "—"} label="data points stored" />
            <Stat value={stats ? String(stats.signals24h) : "—"} label="signals in 24h" />
            <Stat value={stats ? String(stats.briefs) : "—"} label="cited briefs written" />
            <Stat value={stats ? compact(stats.checks) : "—"} label="checks issued with proofs" />
          </div>
          <p className="mx-auto max-w-6xl px-4 pb-3 text-[11px] text-mist sm:px-8">Live from this build&apos;s database; health and freshness at <a href="/api/v1/status" className="text-brand hover:underline">/api/v1/status</a>.</p>
        </section>

        {/* ---------------------------------------------------------------- Problem */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-8">
          <SectionHead id="problem" eyebrow="The problem" title="Crypto has a context problem." lede="More data than ever. Understanding it still means stitching many systems together, continuously, and every team rebuilds the same plumbing." />
          <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
            <div className="sv rounded-2xl border border-edge bg-slab p-6">
              <p className="numerals text-[11px] uppercase tracking-[0.16em] text-mist">The work nobody productized</p>
              <ol className="mt-4 space-y-3">
                {["Reconcile schemas and clocks across sources", "Decide which changes matter", "Separate signal from noise", "Chase the supporting evidence on chain", "Assess risk in context: size, liquidity, contract", "Repeat it, forever"].map((t, i) => (
                  <li key={t} className="flex gap-3 text-[15px]">
                    <span className="numerals text-brand">0{i + 1}</span>
                    <span className="text-bone/90">{t}</span>
                  </li>
                ))}
              </ol>
              <p className="numerals mt-6 rounded-lg border border-edge bg-ink px-3 py-2 text-[12px] text-mist">
                <span className="text-bone">10 sources × 10 schemas × 10 clocks</span> = weeks of plumbing, rebuilt by every team
              </p>
            </div>
            <div className="sv sv-d1 grid gap-3">
              {[
                ["People", "open six tabs every morning, and still miss the unlock or the mint function."],
                ["Apps", "integrate and babysit a dozen APIs to show one risk badge."],
                ["Agents", "get raw numbers and must interpret them. A person double-checks; an agent acts on exactly what it is given."],
              ].map(([who, what]) => (
                <div key={who} className="rounded-2xl border border-edge bg-slab p-5">
                  <p className="text-[15px]"><span className="font-semibold text-bone">{who}</span> <span className="text-mist">{what}</span></p>
                </div>
              ))}
              <div className="rounded-2xl border border-brand/25 bg-brand/[0.06] p-5">
                <p className="text-[15px] text-bone">
                  <span className="font-semibold text-brand">Why now:</span> agents can already read markets (MCP, the tool protocol Claude and Cursor use) and pay for data (x402, pay-per-request over HTTP 402). What they lack is a neutral check, with evidence, before they move money.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Product: live example */}
        <section className="border-t border-edge bg-ink/40">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-8">
            <SectionHead id="product" eyebrow="The product" title="Humans read it." accent="Agents call it." lede="One call checks a token across seven dimensions and returns a verdict with every reason and its source: written for a person, structured for a machine. This is a real check from the last 48 hours." />
            {example ? <LiveExample ex={example} now={now} /> : <p className="mt-10 text-mist">The live example is loading. Try a check on the agents page.</p>}
          </div>
        </section>

        {/* ---------------------------------------------------------------- How it works */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-8">
          <SectionHead id="how" eyebrow="How it works" title="From raw feeds to a decision" accent="you can prove." lede="CoinGraph runs continuously on the top 100 tokens and on demand for any address or contract." />
          <ol className="mt-12 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            {[
              ["Collect", "Prices, order books, futures, on-chain flows, contracts, news, every minute to every hour."],
              ["Detect", "Eleven rules flag what changed: price, volume, leverage, whale moves, exchange flows, TVL, news."],
              ["Investigate", "Big signals open an investigation. Claude writes a brief where every claim cites evidence."],
              ["Decide", "Checks and agents turn the state into a verdict, sized to your order and your rules."],
              ["Prove", "Each answer is stored with a SHA-256 fingerprint and its source calls. Chainlink CRE attestation is in progress."],
              ["Grade", "Every call is scored against what the price did next, in public."],
            ].map(([t, d], i) => (
              <li key={t} className={`sv sv-d${Math.min(i, 3)} rounded-2xl border border-edge bg-slab p-4`}>
                <p className="numerals text-[11px] text-brand">0{i + 1}</p>
                <p className="mt-2 font-semibold">{t}</p>
                <p className="mt-1.5 text-[13px] leading-relaxed text-mist">{d}</p>
              </li>
            ))}
          </ol>
          {coverage && <div className="mt-10"><CoverageStrip c={coverage} /></div>}
          <div className="mt-10">
            <p className="numerals text-[11px] uppercase tracking-[0.16em] text-mist">Sources stitched together</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {SOURCES.map(([n, d]) => (
                <div key={n} className="rounded-xl border border-edge bg-ink px-3 py-2.5">
                  <p className="text-[13px] font-semibold text-bone">{n}</p>
                  <p className="mt-0.5 text-[12px] leading-snug text-mist">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Agents */}
        <section className="border-t border-edge bg-ink/40">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-8">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <SectionHead id="agents" eyebrow="Ready-made agents" title="Ten agents that do the whole job." lede="Each one answers a real question in one call, with a verdict, a plain summary, sourced reasons and a proof. Use them from Claude, from code, or click to try." />
              <Link href="/agents" className="btn-glow shrink-0 rounded-lg bg-brand px-4 py-2 text-[13px] font-semibold text-brand-ink">Try them live →</Link>
            </div>
            <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {AGENTS.map((a) => (
                <Link key={a.id} href={`/agents#${a.id}`} className="group flex flex-col rounded-2xl border border-edge bg-slab p-4 transition-colors hover:border-brand/40 hover:bg-slab-raised">
                  <p className="font-semibold text-bone group-hover:text-brand">{a.name}</p>
                  <p className="mt-1.5 flex-1 text-[13px] leading-snug text-mist">{a.tagline}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {(a.verdicts.length > 4 ? [`${a.verdicts[0]}–${a.verdicts[a.verdicts.length - 1]}`] : a.verdicts).map((v) => (
                      <span key={v} className={`numerals rounded border px-1.5 py-0.5 text-[10px] ${TONE_CHIP[toneOf(v.split("–")[0])]}`}>{v}</span>
                    ))}
                  </div>
                  <p className="numerals mt-3 text-[11px] text-mist">{a.tier} · {TIER_PRICE[a.tier].tada} tADA <span className="text-mist/70">(≈ ${TIER_PRICE[a.tier].usd} on mainnet)</span></p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Developers */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-8">
          <SectionHead id="developers" eyebrow="For builders" title="One engine," accent="three ways in." lede="The same verified answer, whether a person asks in Claude, an app calls the API, or an agent hires an agent." />
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            <Way title="MCP server" badge="22 tools · 3 prompts" text="Add CoinGraph to Claude, Claude Code or Cursor and ask in plain words: “Can I safely buy $5K of LINK?”">
              <Snippet title="Claude Code" code={`claude mcp add --transport http coingraph ${MCP_URL}`} />
            </Way>
            <Way title="REST API" badge="12 endpoints · OpenAPI" text="Discover, understand, decide, watch, trust. Every response: { object, id, as_of, data, sources }. No key needed to start.">
              <Snippet title="Check a token" code={`curl ${BASE_URL}/api/v1/evaluate/chainlink`} />
            </Way>
            <Way title="Agents" badge="10 agents · REST + MCP" text="Whole jobs in one call: pre-trade checks, wallet safety, due diligence, crowding, whales, treasury rules.">
              <Snippet title="Trade Gatekeeper" code={`curl -X POST ${BASE_URL}/api/v1/agents/trade-gatekeeper \\\n  -H 'content-type: application/json' \\\n  -d '{"token":"solana","size_usd":5000}'`} />
            </Way>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 text-[13px]">
            {[["OpenAPI spec", "/openapi.json"], ["llms.txt", "/llms.txt"], ["MCP connect page", "/mcp"], ["Docs", DOCS_URL], ["Source on GitHub", GITHUB_URL]].map(([n, h]) => (
              <a key={n} href={h} className="rounded-lg border border-edge bg-slab px-3 py-1.5 text-mist transition-colors hover:border-brand/40 hover:text-brand" {...(h.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{n} →</a>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- Proof */}
        <section className="border-t border-edge bg-ink/40">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-8">
            <SectionHead id="proof" eyebrow="Trust" title="Sourced, fingerprinted," accent="graded in public." lede="An agent can’t squint at a chart. So every answer says where each number came from and when it was true, carries a fingerprint nobody can quietly edit, and is scored against what happened next." />
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-edge bg-slab p-5">
                <p className="numerals text-[11px] uppercase tracking-[0.14em] text-mist">Public track record · 7 days</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Kpi value={stats?.calls != null ? compact(stats.calls) : "—"} label="calls on the record" />
                  <Kpi value={stats?.graded != null ? compact(stats.graded) : "—"} label="graded against the price" />
                </div>
                <ul className="mt-4 space-y-1.5 text-[13px] text-mist">
                  {(["signal", "brief"] as const).map((k) => {
                    const b = stats?.byKind?.[k];
                    return b && b.graded ? (
                      <li key={k}><span className="text-bone">{k === "signal" ? "Signals" : "Briefs"}:</span> next-day direction right {b.right} of {b.graded} times ({b.hit_rate_pct}%)</li>
                    ) : null;
                  })}
                </ul>
                <p className="mt-3 text-[13px] leading-relaxed text-mist">Every check, signal and brief is compared with the price 1 hour, 24 hours and 7 days later. Signals are alerts, not calls; briefs are the directional product. The record started on 6 October 2026; misses stay on it.</p>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- JSON API route, not a page */}
                <a href="/api/v1/record" className="mt-3 inline-block text-[13px] text-brand hover:underline">See the full record →</a>
              </div>
              <div className="rounded-2xl border border-edge bg-slab p-5">
                <p className="numerals flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-mist">
                  <span className="throb h-1.5 w-1.5 rounded-full bg-life text-life" /> Latest signals
                </p>
                <ul className="mt-3 divide-y divide-edge">
                  {(feed ?? []).map((f) => (
                    <li key={f.id} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
                      <span className="min-w-0 truncate">
                        <span className={f.severity >= 3 ? "text-blood" : "text-ember"}>{f.direction === "up" ? "▲" : f.direction === "down" ? "▼" : "•"}</span>{" "}
                        <span className="font-semibold text-bone">{f.symbol}</span> <span className="text-mist">{SIGNAL_LABEL[f.kind] ?? f.kind}</span>
                        {f.briefId && <Link href={`/briefs/${f.briefId}`} className="ml-1 text-brand hover:underline">brief</Link>}
                      </span>
                      <span className="numerals shrink-0 text-[11px] text-mist">{ago(f.at, now)}</span>
                    </li>
                  ))}
                  {!feed?.length && <li className="py-2 text-[13px] text-mist">Quiet right now.</li>}
                </ul>
              </div>
              <div className="rounded-2xl border border-edge bg-slab p-5">
                <p className="numerals text-[11px] uppercase tracking-[0.14em] text-mist">Check any answer</p>
                <p className="mt-3 text-[13px] leading-relaxed text-mist">Paste an id from any check, answer, agent run or brief to see the exact object, its SHA-256 fingerprint and the source calls behind it.</p>
                <ProofForm />
                {brief && (
                  <Link href={`/briefs/${brief.id}`} className="mt-5 block rounded-xl border border-edge bg-ink p-3 transition-colors hover:border-brand/40">
                    <p className="numerals text-[10px] uppercase tracking-[0.14em] text-mist">Latest brief · {ago(brief.at, now)}</p>
                    <p className="mt-1 text-[13px] leading-snug text-bone"><span className="text-brand">{brief.symbol}</span> {brief.headline}</p>
                  </Link>
                )}
              </div>
            </div>
            <Comparison />
          </div>
        </section>

        {/* ---------------------------------------------------------------- Pricing */}
        <section className="mx-auto max-w-6xl px-4 py-24 sm:px-8">
          <SectionHead id="pricing" eyebrow="Business model" title="One intelligence layer." accent="Paid for by humans and agents." lede="Agents pay per call with x402, apps by contract with an API key, people by subscription. The free tier earns trust; change and depth are what people pay for." />
          <div className="mt-12 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <Tier name="Free" price="0" usd="$0" items={["Token list and search", "The standard check", "Latest brief", "Track record and proofs"]} />
            <Tier name="Data" price="2 tADA" usd="$0.01" note="25 free calls a day" items={["Full token state", "History and events", "Market overview"]} />
            <Tier name="Premium" price="5 tADA" usd="$0.05" highlight items={["Check sized to your order and rules", "Fresh investigation, questions", "Address lookups, webhooks", "6 agents incl. Trade Gatekeeper"]} />
            <Tier name="Pro" price="10 tADA" usd="$0.25" items={["Due Diligence Analyst", "Opportunity Scout", "Portfolio Checkup", "Treasury Steward"]} />
          </div>
          <p className="mt-4 text-[13px] text-mist">
            Live on Cardano preprod: paid calls answer 402 and settle in tADA via x402. Mainnet equivalents shown in USD. Design partners use an API key instead of paying per call.{" "}
            <Link href="/docs/access" className="text-brand hover:underline">How to get access →</Link>
          </p>
          <div className="mt-10 grid gap-3 md:grid-cols-3">
            {[
              ["Agents", "Pay per call", "x402 on Cardano, live now. No account, no key: the 402 reply says what to pay, the agent pays in tADA and retries. Real receipts: an x402 payment and a Masumi payout, both on chain (see Pricing & payments)."],
              ["Apps & businesses", "Pay by contract", "Wallets, exchanges, funds and risk teams embed the answer at volume with an API key."],
              ["People", "Subscribe", "Traders and holders get alerts, monitoring and deeper history. Coming after the hackathon."],
            ].map(([who, how, d]) => (
              <div key={who} className="rounded-2xl border border-edge bg-slab p-5">
                <p className="font-semibold">{who} <span className="numerals ml-1 rounded border border-brand/30 bg-brand/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-brand">{how}</span></p>
                <p className="mt-2 text-[13px] leading-relaxed text-mist">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- Origins */}
        <section className="border-t border-edge bg-ink/40">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-8">
            <SectionHead id="origins" eyebrow="TOKEN2049 Origins" title="Built for the hackathon," accent="on partner rails." lede="This build adds deep on-chain coverage, ten agents, machine payments and verifiable proofs to CoinGraph." />
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              <Track name="NOWNodes" status="Live" text="Full nodes for Ethereum, BNB Chain, Bitcoin, Solana and Cardano power exchange flows and reserves, whale transfers, holder concentration, fees, and live address lookups." stat={stats ? `${compact(stats.transfers)} large transfers tracked` : undefined} />
              <Track name="Cardano · x402 · Masumi" status="Live" text="Two ways to pay CoinGraph on Cardano. Per call: the API answers 402, the agent pays in tADA with x402 and gets the verdict in seconds (facilitated by CoinGraph's own facilitator). Per Task: CoinGraph Crypto Analyst is a Masumi Coworker on Sokosumi, paid into escrow with the result hash on chain." stat="x402 live on the API · Coworker registered on Masumi" />
              <Track name="Chainlink CRE" status="In progress" text="A Chainlink workflow attests each answer’s fingerprint, so anyone can confirm what CoinGraph said and when, without trusting CoinGraph." />
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Vision + founder */}
        <section className="relative mx-auto max-w-6xl px-4 py-24 sm:px-8">
          <div className="grid items-center gap-10 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <p className="numerals text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">The vision</p>
              <h2 className="mt-4 text-[clamp(30px,4.4vw,48px)] font-semibold leading-[1.05] tracking-[-0.03em]">
                Data was built for people. <span className="text-brand">Agents need an intelligence layer.</span>
              </h2>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-mist">
                The data layer already exists. CoinGraph is building the layer above it: tokens today, then wallets, protocols and events. The goal is simple. Every agent, app and person checks it before capital moves.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/agents" className="btn-glow rounded-lg bg-brand px-5 py-2.5 text-[14px] font-semibold text-brand-ink">Try an agent</Link>
                <a href="mailto:ajay@coingraph.ai?subject=CoinGraph%20design%20partner" className="rounded-lg border border-edge bg-slab px-5 py-2.5 text-[14px] font-semibold text-bone transition-colors hover:border-brand/40">Become a design partner</a>
              </div>
            </div>
            <div className="rounded-2xl border border-edge bg-slab p-6">
              <div className="flex items-center gap-3">
                <Image src="/brand/logo.png" alt="" width={36} height={36} className="rounded-lg" />
                <div>
                  <p className="font-semibold">Ajay Prashanth</p>
                  <p className="text-[13px] text-mist">Founder · Singapore</p>
                </div>
              </div>
              <ul className="mt-5 space-y-2 text-[13px] text-bone/90">
                <li>Co-founded bitsCrunch, an AI blockchain analytics company, from zero to 500K+ users</li>
                <li>50+ partnerships including Mastercard, Chainlink and Polygon</li>
                <li>ETHDenver hackathon winner · 10+ years in technology</li>
                <li>Built this CoinGraph platform end to end</li>
              </ul>
              <a href="mailto:ajay@coingraph.ai" className="mt-5 inline-block text-[13px] text-brand hover:underline">ajay@coingraph.ai</a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

/* ================================================================== Pieces */

// Seven dimensions feeding one state, which serves people and agents. Matches the deck's cover.
function Hub() {
  const cx = 260, cy = 196, r = 168;
  const nodes = DIMENSIONS.map((d, i) => {
    const a = Math.PI * (1.08 + (i * 0.84) / (DIMENSIONS.length - 1));
    return { d, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) * 0.92 };
  });
  return (
    <div className="rise rise-3 relative mx-auto w-full max-w-[540px]" aria-hidden>
      <svg viewBox="0 0 520 420" className="w-full">
        <defs>
          <radialGradient id="core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-brand)" stopOpacity="0" />
          </radialGradient>
        </defs>
        {[150, 112].map((rr) => <circle key={rr} cx={cx} cy={cy} r={rr} fill="none" stroke="var(--color-edge)" strokeDasharray="2 5" />)}
        <circle cx={cx} cy={cy} r={110} fill="url(#core)" />
        {nodes.map((n, i) => (
          <g key={n.d}>
            <line x1={n.x} y1={n.y} x2={cx} y2={cy} stroke="var(--color-brand)" strokeOpacity="0.35" strokeDasharray="1 6" strokeLinecap="round" strokeWidth="2">
              <animate attributeName="stroke-dashoffset" from="14" to="0" dur={`${1.4 + (i % 3) * 0.3}s`} repeatCount="indefinite" />
            </line>
            <circle cx={n.x} cy={n.y} r="7" fill="var(--color-void)" stroke="var(--color-brand)" strokeWidth="1.5" />
            <circle cx={n.x} cy={n.y} r="2.5" fill="var(--color-brand)" />
            <text x={n.x} y={n.y - 14} textAnchor="middle" fill="var(--color-bone)" fontSize="10.5" letterSpacing="1.4" style={{ fontFamily: "var(--font-mono)" }}>{n.d.toUpperCase()}</text>
          </g>
        ))}
        <path d={`M ${cx} ${cy + 58} C ${cx} ${cy + 120}, 150 ${cy + 110}, 150 ${cy + 172}`} fill="none" stroke="var(--color-mist)" strokeOpacity="0.5" />
        <path d={`M ${cx} ${cy + 58} C ${cx} ${cy + 120}, 370 ${cy + 110}, 370 ${cy + 172}`} fill="none" stroke="var(--color-brand)" strokeOpacity="0.6" />
        <circle cx={cx} cy={cy} r="58" fill="var(--color-ink)" stroke="var(--color-brand)" strokeWidth="1.5" />
        <text x={cx} y={cy + 4} textAnchor="middle" fill="var(--color-bone)" fontSize="17" fontWeight="600">CoinGraph</text>
        <text x={cx} y={cy + 22} textAnchor="middle" fill="var(--color-brand)" fontSize="9" letterSpacing="2" style={{ fontFamily: "var(--font-mono)" }}>ONE ANSWER</text>
        <g>
          <rect x={86} y={cy + 172} width={128} height={30} rx={15} fill="var(--color-slab)" stroke="var(--color-edge)" />
          <text x={150} y={cy + 191} textAnchor="middle" fill="var(--color-bone)" fontSize="10.5" letterSpacing="1.2" style={{ fontFamily: "var(--font-mono)" }}>HUMANS READ IT</text>
          <rect x={306} y={cy + 172} width={128} height={30} rx={15} fill="var(--color-slab)" stroke="var(--color-brand)" strokeOpacity="0.6" />
          <text x={370} y={cy + 191} textAnchor="middle" fill="var(--color-brand)" fontSize="10.5" letterSpacing="1.2" style={{ fontFamily: "var(--font-mono)" }}>AGENTS CALL IT</text>
        </g>
      </svg>
    </div>
  );
}

function Stat({ value, label: l }: { value: string; label: string }) {
  return (
    <div className="bg-ink/0 px-2 py-6">
      <p className="numerals text-[26px] font-semibold tracking-tight text-bone">{value}</p>
      <p className="mt-1 text-[12px] leading-snug text-mist">{l}</p>
    </div>
  );
}

function Kpi({ value, label: l }: { value: string; label: string }) {
  return (
    <div>
      <p className="numerals text-[24px] font-semibold text-bone">{value}</p>
      <p className="text-[11px] text-mist">{l}</p>
    </div>
  );
}

const DIM_ICON: Record<string, string> = { ok: "✓", caution: "!", avoid: "✕" };
const DIM_TONE: Record<string, string> = { ok: "text-life border-life/30", caution: "text-ember border-ember/40", avoid: "text-blood border-blood/40" };

function LiveExample({ ex, now }: { ex: Example; now: Date }) {
  const flagged = ex.dimensions.filter((d) => d.rating !== "ok");
  const tone = toneOf(ex.verdict);
  const firstReason = (d: Example["dimensions"][number]) => d.reasons.find((r) => !r.info) ?? d.reasons[0];
  const forYou = [
    ...ex.reasons.slice(0, 4).map((r) => ({ text: r.text, warn: true })),
    ...ex.dimensions.filter((d) => d.rating === "ok").slice(0, Math.max(0, 5 - Math.min(4, ex.reasons.length))).map((d) => ({ text: firstReason(d)?.text ?? `${d.key}: ok`, warn: false })),
  ];
  return (
    <div className="mt-12 space-y-4">
      <div className="rounded-2xl border border-edge bg-slab p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[15px]">
            <span className="numerals mr-2 text-[11px] uppercase tracking-[0.14em] text-brand">Live · {ex.symbol}</span>
            <span className="font-semibold">{ex.name}:</span>{" "}
            <span className={TONE_TEXT[tone]}>{flagged.length} of {ex.dimensions.length} dimensions flag a risk.</span>
          </p>
          <span className="numerals text-[11px] text-mist">checked {ago(ex.at, now)}</span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(7,1fr)_1.2fr]">
          {ex.dimensions.map((d) => {
            const r = firstReason(d);
            return (
              <div key={d.key} className="flex flex-col rounded-xl border border-edge bg-ink p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-semibold capitalize text-bone">{d.key}</p>
                  {r ? (
                    <span className={`grid h-5 w-5 place-items-center rounded-md border text-[11px] font-bold ${DIM_TONE[d.rating] ?? DIM_TONE.ok}`}>{DIM_ICON[d.rating] ?? "·"}</span>
                  ) : (
                    <span className="grid h-5 w-5 place-items-center rounded-md border border-edge text-[11px] text-mist" title="unassessed">–</span>
                  )}
                </div>
                <p className="mt-2 line-clamp-4 flex-1 text-[11.5px] leading-snug text-mist">{r?.text ?? <span className="text-ember">unassessed: no data, so no guess</span>}</p>
                {r?.source && <p className="numerals mt-2 truncate text-[10px] text-mist/70">{r.source.split(":")[0]}</p>}
              </div>
            );
          })}
          <div className={`flex flex-col items-center justify-center rounded-xl border p-3 text-center ${TONE_CHIP[tone]}`}>
            <p className="numerals text-[10px] uppercase tracking-[0.14em] opacity-80">One call</p>
            <p className="numerals mt-1 text-[22px] font-bold uppercase">{ex.verdict}</p>
            {ex.confidence != null && <p className="text-[11px] opacity-80">confidence {Math.round(ex.confidence * 100)}%</p>}
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-edge bg-slab p-5">
          <p className="numerals text-[11px] uppercase tracking-[0.14em] text-mist">¶ For you · the report</p>
          <ul className="mt-4 space-y-2.5">
            {forYou.map((x, i) => (
              <li key={i} className="flex gap-2.5 text-[14px] leading-snug">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${x.warn ? "bg-ember" : "bg-life"}`} />
                <span className="text-bone/90">{x.text}</span>
              </li>
            ))}
            <li className="flex gap-2.5 text-[14px]">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone === "bad" ? "bg-blood" : tone === "warn" ? "bg-ember" : "bg-life"}`} />
              <span>Verdict: <span className={`font-semibold ${TONE_TEXT[tone]}`}>{ex.verdict}</span>. Every reason listed, every source named.</span>
            </li>
          </ul>
        </div>
        <div className="instrument min-w-0 overflow-hidden rounded-2xl border border-edge bg-ink">
          <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
            <p className="numerals text-[11px] uppercase tracking-[0.14em] text-brand">⌁ For your agent · the object</p>
            <p className="numerals text-[11px] text-mist">GET /v1/evaluate/{ex.token}</p>
          </div>
          <pre className="numerals overflow-x-auto px-4 py-3 text-[12px] leading-[1.7]">
            <span className="j-p">{"{"}</span>{"\n"}
            {"  "}<span className="j-k">&quot;id&quot;</span>: <span className="j-s">&quot;{ex.id}&quot;</span>,{"\n"}
            {"  "}<span className="j-k">&quot;verdict&quot;</span>: <span className="j-b">&quot;{ex.verdict}&quot;</span>,{"\n"}
            {"  "}<span className="j-k">&quot;dimensions&quot;</span>: <span className="j-p">{"{"}</span>{"\n"}
            {ex.dimensions.map((d) => (
              <span key={d.key}>
                {"    "}<span className="j-k">&quot;{d.key}&quot;</span>: <span className={d.rating === "ok" ? "j-n" : "j-b"}>&quot;{d.rating}&quot;</span>,{"  "}<span className="j-p">{"// "}{firstReason(d)?.source?.split(":")[0] ?? "coingraph"}</span>{"\n"}
              </span>
            ))}
            {"  "}<span className="j-p">{"}"}</span>,{"\n"}
            {"  "}<span className="j-k">&quot;verify_url&quot;</span>: <span className="j-s">&quot;…/verify/{ex.id}&quot;</span>{"\n"}
            <span className="j-p">{"}"}</span>
          </pre>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <Link href={`/proof/${ex.id}`} className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 font-semibold text-brand hover:bg-brand/20">See the proof for this check →</Link>
        <span className="text-mist">Anything not measured says <span className="text-ember">unassessed</span>, never a guess. CoinGraph never executes, holds funds or advises: the caller decides.</span>
      </div>
    </div>
  );
}

function Way({ title, badge, text, children }: { title: string; badge: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-edge bg-slab p-5">
      <div>
        <p className="flex flex-wrap items-center gap-2 font-semibold">{title} <span className="numerals rounded border border-edge bg-ink px-1.5 py-0.5 text-[10px] font-normal text-mist">{badge}</span></p>
        <p className="mt-2 text-[13px] leading-relaxed text-mist">{text}</p>
      </div>
      <div className="mt-auto">{children}</div>
    </div>
  );
}

function Tier({ name, price, usd, items, note, highlight }: { name: string; price: string; usd: string; items: string[]; note?: string; highlight?: boolean }) {
  return (
    <div className={`flex flex-col rounded-2xl border p-5 ${highlight ? "border-brand/50 bg-brand/[0.05]" : "border-edge bg-slab"}`}>
      <p className="numerals text-[11px] uppercase tracking-[0.14em] text-mist">{name}</p>
      <p className="numerals mt-2 text-[28px] font-semibold text-bone">{price}</p>
      <p className="text-[12px] text-mist">per call · mainnet {usd}</p>
      {note && <p className="numerals mt-2 text-[11px] text-brand">{note}</p>}
      <ul className="mt-4 space-y-1.5 text-[13px] text-bone/90">
        {items.map((i) => <li key={i} className="flex gap-2"><span className="text-brand">›</span>{i}</li>)}
      </ul>
    </div>
  );
}

function Track({ name, status, text, stat }: { name: string; status: "Live" | "In progress"; text: string; stat?: string }) {
  return (
    <div className="rounded-2xl border border-edge bg-slab p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{name}</p>
        <span className={`numerals rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${status === "Live" ? "border-life/35 bg-life/10 text-life" : "border-ember/35 bg-ember/10 text-ember"}`}>{status}</span>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-mist">{text}</p>
      {stat && <p className="numerals mt-3 text-[12px] text-brand">{stat}</p>}
    </div>
  );
}

// The deck's comparison, as published. Filled = core, half = partial, empty = not a focus.
function Comparison() {
  const cols = ["Price aggregators", "Dune", "Nansen", "CoinGraph"];
  const rows: [string, number[]][] = [
    ["Shows where every number came from", [0, 1, 1, 2]],
    ["Says “unknown” instead of guessing", [0, 0, 0, 2]],
    ["Built for agents to call", [1, 2, 2, 2]],
    ["Stays neutral: never executes", [2, 2, 0, 2]],
    ["Graded against the price 1h/24h/7d later, in public", [0, 0, 0, 2]],
    ["Historical depth and custom SQL", [1, 2, 2, 0]],
  ];
  const dot = (v: number, us: boolean) => (
    <span className={`inline-block h-3 w-3 rounded-full border ${us ? "border-brand" : "border-mist/60"}`} style={{ background: v === 2 ? (us ? "var(--color-brand)" : "var(--color-bone)") : v === 1 ? `linear-gradient(90deg, ${us ? "var(--color-brand)" : "var(--color-bone)"} 50%, transparent 50%)` : "transparent" }} />
  );
  return (
    <div className="mt-10 rounded-2xl border border-edge bg-slab p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold">Bloomberg was built for traders. <span className="text-brand">CoinGraph is built for their agents.</span></p>
        <p className="text-[11px] text-mist">What an agent needs before it acts · from public product pages, Oct 2026</p>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-mist">
              <th className="py-2 text-left font-medium" />
              {cols.map((c) => <th key={c} className={`px-2 py-2 text-center font-medium ${c === "CoinGraph" ? "text-brand" : ""}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([q, vals]) => (
              <tr key={q} className="border-t border-edge">
                <td className="py-2.5 pr-3 text-bone">{q}</td>
                {vals.map((v, i) => <td key={i} className={`px-2 text-center ${i === 3 ? "bg-brand/[0.06]" : ""}`}>{dot(v, i === 3)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
