import Image from "next/image";

const FLOW = ["Discover", "Pay", "Investigate", "Verify", "Explain"];

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[640px]">
        <div className="hero-glow absolute inset-0" />
        <div className="dot-grid absolute inset-0 opacity-60" />
      </div>

      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-3">
            <Image src="/brand/logo.png" alt="" width={32} height={32} className="rounded-lg" />
            <span className="text-[17px] font-semibold tracking-tight">CoinGraph</span>
          </div>
          <span className="numerals rounded-full border border-brand/30 bg-brand/5 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-brand">
            TOKEN2049 Origins
          </span>
        </header>

        <section className="pt-20 pb-24">
          <p className="rise numerals text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
            Verifiable crypto signals for AI agents
          </p>
          <h1 className="rise rise-1 mt-5 max-w-3xl text-[clamp(34px,5vw,54px)] font-semibold leading-[1.06] tracking-[-0.03em]">
            Data providers tell agents what happened.
            <br />
            <span className="text-brand">CoinGraph tells them what matters.</span>
          </h1>
          <p className="rise rise-2 mt-5 max-w-xl text-[16px] leading-relaxed text-mist">
            Monitor the Top 100, investigate unusual activity onchain, and return a
            structured, verified signal that an agent can pay for and act on.
          </p>

          <ol className="rise rise-3 mt-10 flex flex-wrap items-center gap-2">
            {FLOW.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="numerals rounded-lg border border-edge bg-slab px-3 py-2 text-[12px] text-bone">
                  <span className="text-brand">0{i + 1}</span> {step}
                </span>
                {i < FLOW.length - 1 && <span className="text-mist/60">→</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}
