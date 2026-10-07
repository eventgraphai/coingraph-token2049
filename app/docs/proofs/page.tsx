import type { Metadata } from "next";
import Link from "next/link";
import { CodeTabs } from "../_ui/client";
import { C, Callout, DocPage, Example, H2, H3, P, Step, Steps, Table, example } from "../_ui/kit";

export const metadata: Metadata = { title: "Proofs & track record", description: "How CoinGraph fingerprints every answer, records its sources and grades its calls in public." };

export default function Proofs() {
  const id = (example("verify")?.response as { data?: { id?: string } } | undefined)?.data?.id ?? "eval_…";
  return (
    <DocPage href="/docs/proofs" lede="An agent can't squint at a chart. So every answer CoinGraph gives is stored exactly as issued, fingerprinted, tied to the data calls behind it, and graded against what happened next.">
      <H2>What gets a proof</H2>
      <Table
        head={["Object", "Id", "Where it comes from"]}
        rows={[
          ["Check", <C key="1">eval_…</C>, <Link key="a" href="/docs/api/evaluate">Evaluate</Link>],
          ["Answer or claim verdict", <C key="2">ans_…</C>, <Link key="b" href="/docs/api/ask">Ask</Link>],
          ["Agent run", <C key="3">run_…</C>, <Link key="c" href="/docs/agents">Agents</Link>],
          ["Brief", <C key="4">a number</C>, <Link key="d" href="/docs/api/explain">Explain</Link>],
        ]}
      />

      <H2>How a proof works</H2>
      <Steps>
        <Step title="Store the exact object"><P>The object returned to you is saved as it was, with its id and time.</P></Step>
        <Step title="Fingerprint it"><P>CoinGraph writes the object as canonical JSON (keys sorted, no spaces) and takes its SHA-256. Change one character and the fingerprint changes completely.</P></Step>
        <Step title="Record the sources"><P>The data-source calls made around the issue time are listed with provider, endpoint, time, latency and outcome.</P></Step>
        <Step title="Attest it"><P>A Chainlink CRE workflow (<C>cre/verify-investigation</C>) runs every few minutes: it fetches each new proof from <C>/v1/verify</C>, recomputes the SHA-256 on every node, requires the nodes to agree, and posts the attestation back. CoinGraph re-hashes the object before storing it, so neither side can attest a fingerprint the object does not hash to. The attestation records the workflow, the consensus rule and the time. Today it runs on the CRE simulator (<C>mode: &quot;simulation&quot;</C>), as agreed with the Chainlink team; a DON deployment is next. Until the workflow has reached a new proof, its status is <C>pending</C> and the fingerprint itself is the commitment.</P></Step>
      </Steps>

      <H2>Check a proof</H2>
      <H3>In a browser</H3>
      <P>Open <Link href={`/proof/${id}`}><C>/proof/{id}</C></Link>: the verdict, the fingerprint, whether it matches, the attestation status and the source calls.</P>
      <H3>Over the API</H3>
      <Example id="verify" />
      <H3>Recompute it yourself</H3>
      <CodeTabs samples={[{ label: "Node.js", code: `import crypto from "node:crypto";\n\nconst res = await fetch("https://token2049.coingraph.ai/api/v1/verify/${id}");\nconst { data } = await res.json();\n\n// Canonical JSON: keys sorted at every level, no whitespace.\nconst canon = (v) => Array.isArray(v) ? \`[\${v.map(canon).join(",")}]\`\n  : v && typeof v === "object" ? \`{\${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",")}}\`\n  : JSON.stringify(v);\n\nconst sha = crypto.createHash("sha256").update(canon(data.object)).digest("hex");\nconsole.log(sha === data.sha256); // true` }]} />

      <H2>The public track record</H2>
      <P>Every check, signal and brief is compared with the price 1 hour, 24 hours and 7 days after it was issued. Misses stay on the record.</P>
      <Table
        head={["Call", "Graded right when"]}
        rows={[
          ["Signal or brief pointing up / down", "The 24-hour return has the same sign (1-hour if 24 hours have not passed)."],
          ["Check: proceed / avoid", "Graded as up / down on the same rule."],
          [<>Check: <C key="c">caution</C></>, "The price moved 2% or more either way within 24 hours."],
          ["Neutral calls", "Listed, not graded."],
        ]}
      />
      <Callout kind="note" title="An honest caveat">
        <p>The record started on 6 October 2026, so samples are small. Grading checks as price calls is a simplification: a check says whether it is safe to act, not where the price goes. A risk-based grading method is planned.</p>
      </Callout>
      <P>Read it with <Link href="/docs/api/record">Track record</Link> or the MCP tool <C>get_track_record</C>.</P>
    </DocPage>
  );
}
