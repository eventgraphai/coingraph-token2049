import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.COINGRAPH_PUBLIC_URL ?? "https://token2049.coingraph.ai"),
  title: "CoinGraph — the check before AI agents act",
  description:
    "Verified crypto intelligence for agents, apps and people. One call checks a token across market, liquidity, leverage, onchain, supply, contract and context, with every number sourced, timed and fingerprinted.",
  openGraph: {
    title: "CoinGraph — the check before AI agents act",
    description: "Fragmented crypto data in. One verifiable answer out. Ten ready-made agents, a REST API and an MCP server.",
    siteName: "CoinGraph",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-void font-sans text-bone">{children}</body>
    </html>
  );
}
