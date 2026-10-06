import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { GITHUB_URL } from "@/app/_site/chrome";
import { Sidebar, ThemeToggle, Toc } from "./_ui/client";

export const metadata: Metadata = {
  title: { template: "%s · CoinGraph Docs", default: "CoinGraph Docs" },
  description: "Documentation for CoinGraph: the REST API, the MCP server and ten ready-made agents for verified crypto intelligence.",
};

// White reading surface by default. A reader's dark preference is stamped on <html> (data-docs-theme) before
// first paint by the root layout, and globals.css re-applies the dark tokens to #docs-root.

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div id="docs-root" className="theme-light min-h-screen bg-void text-bone">
      <header className="sticky top-0 z-40 border-b border-edge bg-void/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" aria-label="CoinGraph home">
            <Image src="/brand/logo.png" alt="" width={26} height={26} className="rounded-md" />
            <span className="text-[15px] font-semibold tracking-tight">CoinGraph</span>
          </Link>
          <Link href="/docs" className="rounded-md border border-edge px-2 py-0.5 text-[12px] font-medium text-mist hover:text-bone">Docs</Link>
          <nav className="ml-auto hidden items-center gap-5 text-[13px] text-mist md:flex" aria-label="Docs sections">
            <Link href="/docs/api" className="hover:text-bone">API</Link>
            <Link href="/docs/mcp" className="hover:text-bone">MCP</Link>
            <Link href="/docs/agents" className="hover:text-bone">Agents</Link>
            <Link href="/agents" className="hover:text-bone">Playground</Link>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-bone">GitHub</a>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <ThemeToggle />
            <Link href="/agents" className="hidden rounded-lg bg-brand px-3 py-1.5 text-[13px] font-semibold text-brand-ink sm:inline-block">Try an agent</Link>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-x-10 px-4 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_200px]">
        <Sidebar />
        <main className="min-w-0">{children}</main>
        <Toc />
      </div>
      <footer className="border-t border-edge">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-[12.5px] text-mist sm:px-6">
          <span>© 2026 CoinGraph · Information, not investment advice. The caller decides.</span>
          <span className="flex gap-4">
            <Link href="/" className="hover:text-bone">Home</Link>
            <a href="/openapi.json" className="hover:text-bone">OpenAPI</a>
            <a href="/llms.txt" className="hover:text-bone">llms.txt</a>
            <a href="mailto:ajay@coingraph.ai" className="hover:text-bone">ajay@coingraph.ai</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
