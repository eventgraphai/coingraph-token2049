import Image from "next/image";
import Link from "next/link";

export const GITHUB_URL = "https://github.com/eventgraphai/coingraph-token2049";
export const DOCS_URL = "/docs";

const NAV: [string, string][] = [
  ["Product", "/#product"],
  ["Agents", "/agents"],
  ["Use cases", "/use-cases"],
  ["Developers", "/#developers"],
  ["Proof", "/#proof"],
  ["Pricing", "/#pricing"],
  ["Docs", DOCS_URL],
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-edge/70 bg-void/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="CoinGraph home">
          <Image src="/brand/logo.png" alt="" width={28} height={28} className="rounded-md" priority />
          <span className="text-[16px] font-semibold tracking-tight">CoinGraph</span>
        </Link>
        <nav className="hidden items-center gap-6 text-[13px] text-mist md:flex" aria-label="Main">
          {NAV.map(([name, href]) => (
            <a key={name} href={href} className="transition-colors hover:text-bone" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
              {name}
            </a>
          ))}
        </nav>
        <Link href="/agents" className="btn-glow rounded-lg bg-brand px-3.5 py-1.5 text-[13px] font-semibold text-brand-ink">
          Try an agent
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-edge">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <Image src="/brand/logo.png" alt="" width={24} height={24} className="rounded-md" />
            <span className="font-semibold">CoinGraph</span>
          </div>
          <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-mist">
            The check before they act. Sourced, timed and graded in public. CoinGraph never trades, holds funds or gives financial advice.
          </p>
        </div>
        <FooterCol title="Product" links={[["Agents", "/agents"], ["Use cases", "/use-cases"], ["Get access", "/docs/access"], ["Live example", "/#product"], ["Track record", "/#proof"], ["Pricing", "/#pricing"]]} />
        <FooterCol title="Developers" links={[["REST API", "/#developers"], ["MCP server", "/mcp"], ["OpenAPI", "/openapi.json"], ["llms.txt", "/llms.txt"], ["Docs", DOCS_URL], ["GitHub", GITHUB_URL]]} />
        <FooterCol title="Company" links={[["coingraph.ai", "https://coingraph.ai"], ["ajay@coingraph.ai", "mailto:ajay@coingraph.ai"], ["TOKEN2049 Origins", "/#origins"]]} />
      </div>
      <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 pb-8 text-[11px] text-mist sm:px-8">
        <span className="numerals uppercase tracking-[0.12em]">CoinGraph · TOKEN2049 Origins build · Oct 2026</span>
        <span>Information, not investment advice. The caller decides.</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="numerals text-[11px] uppercase tracking-[0.14em] text-mist">{title}</p>
      <ul className="mt-3 space-y-2 text-[13px]">
        {links.map(([name, href]) => (
          <li key={name}>
            <a href={href} className="text-bone/80 transition-colors hover:text-brand" {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
              {name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Section heading in the deck's voice: a spaced eyebrow, a headline with an optional green second half, a short lede.
export function SectionHead({ eyebrow, title, accent, lede, id }: { eyebrow: string; title: string; accent?: string; lede?: string; id?: string }) {
  return (
    <div id={id} className="scroll-mt-24">
      <p className="numerals flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
        {eyebrow}
        <span className="h-px w-16 bg-edge" />
      </p>
      <h2 className="mt-4 max-w-3xl text-[clamp(28px,4vw,42px)] font-semibold leading-[1.08] tracking-[-0.025em]">
        {title} {accent && <span className="text-brand">{accent}</span>}
      </h2>
      {lede && <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-mist">{lede}</p>}
    </div>
  );
}
