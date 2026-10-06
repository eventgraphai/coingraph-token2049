import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteFooter, SiteHeader } from "@/app/_site/chrome";
import { ProofForm } from "@/app/_site/proof-form";

export const metadata: Metadata = { title: "Check a proof — CoinGraph" };

// /proof?id=… forwards to /proof/{id}; without an id it shows the lookup form.
export default async function ProofLookup({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const id = String((await searchParams).id ?? "").trim();
  if (id) redirect(`/proof/${encodeURIComponent(id)}`);
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight">Check a proof</h1>
        <p className="mt-3 text-mist">Paste any id CoinGraph gave you: a check (eval_…), an answer (ans_…), an agent run (run_…) or a brief number.</p>
        <ProofForm />
      </main>
      <SiteFooter />
    </>
  );
}
