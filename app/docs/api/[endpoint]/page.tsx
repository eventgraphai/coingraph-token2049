import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ENDPOINT_BY_SLUG, ENDPOINT_DOCS } from "../../_content/endpoints";
import { Badge, C, Callout, DocPage, Endpoint, Example, H2, H3, JsonBlock, P, Params, Request, Table, example } from "../../_ui/kit";

export const dynamicParams = false;
export function generateStaticParams() {
  return ENDPOINT_DOCS.map((e) => ({ endpoint: e.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ endpoint: string }> }): Promise<Metadata> {
  const e = ENDPOINT_BY_SLUG[(await params).endpoint];
  return e ? { title: `${e.title} · API`, description: e.lede } : {};
}

const TIER_NOTE: Record<string, string> = {
  Free: "Free, always.",
  Data: "Data tier: 25 free calls a day, then 2 tADA per call (mainnet $0.01).",
  Premium: "Premium tier: 5 tADA per call (mainnet $0.05).",
  "Free · Premium": "GET is free. POST is Premium: 5 tADA per call (mainnet $0.05).",
  "Premium · Pro": "Listing is free. Runs are Premium (5 tADA) or Pro (10 tADA) depending on the agent.",
};

export default async function EndpointPage({ params }: { params: Promise<{ endpoint: string }> }) {
  const e = ENDPOINT_BY_SLUG[(await params).endpoint];
  if (!e) notFound();
  const href = `/docs/api/${e.slug}`;
  return (
    <DocPage href={href} title={e.title} lede={e.lede} eyebrow={`API reference · ${e.group}`}>
      <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone={e.tier.startsWith("Free") ? "good" : "brand"}>{e.tier}</Badge>
        {e.mcp && <span className="text-mist">MCP tool: <Link href={e.mcp.startsWith("run_") ? "/docs/mcp/tools#agents" : `/docs/mcp/tools#${e.mcp}`}><C>{e.mcp}</C></Link></span>}
      </div>
      <P>{e.intro}</P>

      {e.operations.map((op) => (
        <section key={op.method + op.path}>
          <H2 id={`${op.method.toLowerCase()}-${op.path.replace(/[^a-z]+/gi, "-").replace(/(^-|-$)/g, "")}`} toc={`${op.method} ${op.summary}`}>{op.summary}</H2>
          <Endpoint method={op.method} path={op.path} />
          <Params rows={op.params} />
          {op.example ? (
            <Example id={op.example} label={op.exampleLabel} />
          ) : (
            <Request
              method={op.method}
              path={op.path.replace("/v1", "").replace("{token}", "chainlink").replace("{id}", op.path.includes("explain") ? "46" : op.path.includes("agents") ? "trade-gatekeeper" : "mon_fc71a6d43e785693a658")}
              body={op.method === "POST" && op.path === "/v1/explain" ? { token: "chainlink", hours: 2 } : undefined}
              headers={op.path.startsWith("/v1/monitor") ? { "X-Monitor-Secret": "whsec_your_secret" } : undefined}
            />
          )}
        </section>
      ))}

      <H2 id="returns">Response</H2>
      <P>Inside <C>data</C>:</P>
      <Table head={["Field", "Contents"]} rows={e.returns.map(([k, v]) => [<C key="k">{k}</C>, v])} />

      {e.notes === "claim" && (
        <>
          <H3>Checking a claim</H3>
          <Example id="ask_claim" label="“SOL futures are heavily crowded on the long side right now”" />
        </>
      )}
      {e.notes === "webhook" && (
        <>
          <H2 id="webhooks">Webhook messages</H2>
          <P>Each message is a POST with a JSON body and an <C>X-CoinGraph-Signature</C> header: the HMAC-SHA256 of the raw body, keyed with your monitor secret, in hex. <C>kind</C> is <C>signal</C> or <C>brief</C>; a brief message carries its headline, direction, severity, summary and a link to the full brief.</P>
          <JsonBlock value={{ monitor_id: "mon_…", kind: "signal", token: "chainlink", object: { id: 241, kind: "exchange_inflow", direction: "down", severity: 2, value: 4200000, ratio: 3.4, at: "2026-10-07T01:15:00Z", details: { "…": "rule-specific detail" } }, as_of: "2026-10-07T01:15:04Z" }} title="Example message" />
          <H3>Verify the signature (Node.js)</H3>
          <JsonBlock value={`import crypto from "node:crypto";\n\nexport function isFromCoinGraph(rawBody, signature, secret) {\n  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");\n  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));\n}`} title="verify.js" />
          <Callout kind="warn">Reject messages whose signature does not match, and never log the secret.</Callout>
        </>
      )}
      {e.notes && typeof e.notes !== "string" && <Callout kind="note">{e.notes}</Callout>}

      <H2 id="pricing">Pricing</H2>
      <P>{TIER_NOTE[e.tier]} Free during the hackathon preview. <Link href="/docs/pricing">How payment works</Link>.</P>
      {e.slug === "agents" && example("agent:trade-gatekeeper:reduce") && <P>See every agent&apos;s inputs and real examples under <Link href="/docs/agents">Agents</Link>.</P>}
    </DocPage>
  );
}
