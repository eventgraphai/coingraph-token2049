import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BriefView, loadBrief } from "@/app/_site/brief-view";
import { SiteFooter, SiteHeader } from "@/app/_site/chrome";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const row = await loadBrief(Number((await params).id), true).catch(() => null);
  return { title: row ? `${row.symbol}: ${row.headline} — CoinGraph` : "Brief — CoinGraph", description: row?.brief?.summary };
}

// Public brief: why a token moved, every claim linked to its evidence.
export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const row = await loadBrief(Number((await params).id), true);
  if (!row) notFound();
  return (
    <>
      <SiteHeader />
      <BriefView row={row} back={{ href: "/#proof", label: "CoinGraph" }} />
      <SiteFooter />
    </>
  );
}
