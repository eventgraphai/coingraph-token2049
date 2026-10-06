import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { BriefView, loadBrief } from "@/app/_site/brief-view";

export const metadata: Metadata = { title: "Investigation — CoinGraph" };

// Private ops view (any status, incl. failed). The public page is /briefs/{id}.
export default async function InvestigationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const token = process.env.STATUS_TOKEN;
  if (token && (await searchParams).token !== token) notFound();
  const row = await loadBrief(Number((await params).id), false);
  if (!row) notFound();
  return <BriefView row={row} back={{ href: "/signals", label: "Signals" }} />;
}
