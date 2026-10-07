import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { verifyObject } from "@/lib/api/verify";
import { BASE_URL } from "@/lib/api/respond";
import { SiteFooter, SiteHeader } from "@/app/_site/chrome";
import { CopyButton, Snippet } from "@/app/_site/copy";
import { label, TONE_CHIP, toneOf } from "@/lib/site/verdict";

export const metadata: Metadata = {
  title: "Proof — CoinGraph",
  description: "The exact object CoinGraph issued, its SHA-256 fingerprint and the source calls behind it.",
};

type Obj = Record<string, unknown>;

// Pull the human headline out of whichever kind of object this is.
function gist(kind: string, o: Obj): { verdict?: string; text?: string } {
  if (kind.startsWith("agent_run")) return { verdict: String(o.verdict ?? ""), text: String(o.summary ?? "") };
  if (kind === "evaluation") {
    const reasons = (o.reasons as { text: string }[] | undefined) ?? [];
    return { verdict: String(o.verdict ?? ""), text: reasons.length ? reasons.slice(0, 2).map((r) => r.text).join(" · ") : "No dimension flagged a risk." };
  }
  if (kind === "brief") return { text: String(o.headline ?? "") };
  if (kind === "answer") return { verdict: o.verdict ? String(o.verdict) : undefined, text: String(o.answer ?? o.claim ?? "") };
  return {};
}

const KIND_NAME = (k: string) =>
  k.startsWith("agent_run:") ? `Agent run · ${k.slice(10).replace(/-/g, " ")}` : k === "evaluation" ? "Token check" : k === "brief" ? "Brief" : k === "answer" ? "Answer" : k;

export default async function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = decodeURIComponent((await params).id).trim();
  if (!/^(eval_|ans_|run_)[a-f0-9]{8,40}$|^\d{1,9}$/.test(id)) notFound();
  const proof = await verifyObject(id).catch(() => null);
  if (!proof) notFound();
  const obj = proof.object as Obj;
  const g = gist(proof.kind, obj);
  const att = proof.attestation as { status?: string; note?: string; mode?: string; attested_at?: string; workflow?: { name?: string; id?: string | null }; consensus?: { aggregation?: string; nodes?: number | null }; served_sha256?: string } | null;
  const attested = att?.status === "attested";
  const api = `${BASE_URL}/api/v1/verify/${id}`;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
        <p className="numerals text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">Proof · {KIND_NAME(proof.kind)}</p>
        <h1 className="mt-3 text-[clamp(24px,3.4vw,34px)] font-semibold leading-tight tracking-tight">
          What CoinGraph said{proof.token ? <> about <span className="text-brand">{proof.token}</span></> : null}, exactly as issued.
        </h1>
        <p className="mt-2 text-sm text-mist">
          Issued {new Date(proof.issued_at).toISOString().replace("T", " ").slice(0, 19)} UTC · id <span className="numerals text-bone">{id}</span>
        </p>

        {(g.verdict || g.text) && (
          <div className="mt-6 rounded-xl border border-edge bg-slab p-5">
            {g.verdict && <span className={`numerals inline-block rounded-md border px-2 py-0.5 text-[12px] font-semibold uppercase ${TONE_CHIP[toneOf(g.verdict)]}`}>{label(g.verdict)}</span>}
            {g.text && <p className="mt-3 text-[15px] leading-relaxed text-bone">{g.text}</p>}
            {proof.kind === "brief" && <Link href={`/briefs/${id}`} className="mt-3 inline-block text-[13px] text-brand hover:underline">Read the full brief →</Link>}
          </div>
        )}

        <section className="mt-8 grid gap-3 sm:grid-cols-3">
          <Check ok={proof.hash_matches_stored !== false} title="Fingerprint" detail={proof.hash_matches_stored === null ? "Computed from the stored object" : proof.hash_matches_stored ? "Matches the one stored at issue time" : "Does NOT match the stored fingerprint"} />
          <Check ok title="Sources" detail={`${proof.provenance.length} source calls recorded around issue time`} />
          <Check ok={attested} pending={!attested} title="Chainlink CRE attestation" detail={attested ? `Re-hashed by the CRE workflow${att?.mode === "simulation" ? " (simulator)" : " (DON)"}${att?.attested_at ? ` · ${new Date(att.attested_at).toISOString().replace("T", " ").slice(0, 16)} UTC` : ""}` : "Pending: the workflow attests new proofs every few minutes; the fingerprint above is the commitment"} />
        </section>

        {attested && (
          <section className="mt-6 rounded-xl border border-edge bg-slab p-4 text-[13px] leading-relaxed text-mist">
            <p className="font-semibold text-bone">What the Chainlink CRE workflow did</p>
            <p className="mt-1">
              <span className="numerals text-bone">{att?.workflow?.name ?? "verify-investigation"}</span> fetched this proof from <span className="numerals">/api/v1/verify/{id}</span>, recomputed the SHA-256 on every node, reached <span className="text-bone">{att?.consensus?.aggregation ?? "identical"}</span> consensus and posted the attestation; CoinGraph re-hashed the object before storing it.
              {att?.mode === "simulation" ? " This run was on the CRE simulator (a local DON), as agreed with the Chainlink team; a DON deployment is next." : ""}
            </p>
            <p className="numerals mt-2 text-[12px]">Workflow fingerprint: {att?.served_sha256 && att.served_sha256 === proof.sha256 ? "matches the one above" : proof.sha256}</p>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-mist">SHA-256 fingerprint</h2>
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-edge bg-ink px-3 py-2.5">
            <code className="numerals min-w-0 flex-1 break-all text-[13px] text-brand">{proof.sha256}</code>
            <CopyButton text={proof.sha256} />
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-mist">
            The fingerprint is the SHA-256 of the object below written as canonical JSON (keys sorted, no spaces). Change one character and it changes completely, so nobody, including CoinGraph, can quietly edit what was said.
          </p>
          <div className="mt-4">
            <Snippet title="Check it yourself" code={`curl -s ${api}`} />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-mist">Source calls behind it</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-edge">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead className="bg-slab text-[11px] uppercase tracking-wider text-mist">
                <tr><th className="px-3 py-2 font-medium">Provider</th><th className="px-3 py-2 font-medium">Endpoint</th><th className="px-3 py-2 font-medium">At (UTC)</th><th className="px-3 py-2 text-right font-medium">Latency</th><th className="px-3 py-2 text-right font-medium">OK</th></tr>
              </thead>
              <tbody>
                {proof.provenance.slice(0, 25).map((p) => (
                  <tr key={p.call_id} className="border-t border-edge">
                    <td className="px-3 py-1.5 text-bone">{p.provider}</td>
                    <td className="numerals px-3 py-1.5 text-mist">{p.endpoint}</td>
                    <td className="numerals px-3 py-1.5 text-mist">{new Date(p.at).toISOString().slice(11, 19)}</td>
                    <td className="numerals px-3 py-1.5 text-right text-mist">{p.latency_ms ?? "—"} ms</td>
                    <td className={`px-3 py-1.5 text-right ${p.ok ? "text-life" : "text-blood"}`}>{p.ok ? "✓" : "✕"}</td>
                  </tr>
                ))}
                {!proof.provenance.length && <tr><td colSpan={5} className="px-3 py-3 text-mist">No source calls in the recorded window.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <details className="mt-10 rounded-xl border border-edge bg-slab">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-bone">The exact object ({proof.canonical_bytes.toLocaleString()} bytes)</summary>
          <pre className="numerals max-h-[520px] overflow-auto border-t border-edge px-4 py-3 text-[12px] leading-relaxed text-mist">{JSON.stringify(obj, null, 2)}</pre>
        </details>
      </main>
      <SiteFooter />
    </>
  );
}

function Check({ ok, pending, title, detail }: { ok: boolean; pending?: boolean; title: string; detail: string }) {
  const tone = pending ? "text-ember" : ok ? "text-life" : "text-blood";
  return (
    <div className="rounded-xl border border-edge bg-slab p-4">
      <p className={`text-[13px] font-semibold ${tone}`}>{pending ? "◷" : ok ? "✓" : "✕"} {title}</p>
      <p className="mt-1 text-[13px] leading-snug text-mist">{detail}</p>
    </div>
  );
}
