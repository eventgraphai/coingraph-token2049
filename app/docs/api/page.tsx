import type { Metadata } from "next";
import Link from "next/link";
import { ENDPOINT_DOCS } from "../_content/endpoints";
import { API, Badge, C, Callout, DocPage, H2, P, Request, Table } from "../_ui/kit";

export const metadata: Metadata = { title: "API reference", description: "CoinGraph REST API: base URL, requests, responses, errors, limits and every endpoint." };

const GROUPS = [
  ["Discover", "Find what CoinGraph covers and whether it is healthy."],
  ["Understand", "Everything CoinGraph knows, as data."],
  ["Decide", "Ask CoinGraph to think. Creates objects with ids that go on the public record."],
  ["Watch", "Get told when something changes."],
  ["Trust", "Check CoinGraph's record and prove what you were told."],
  ["Agents", "Whole jobs in one call."],
] as const;

const TIER_TONE = { Free: "good", Data: "mist", Premium: "brand", "Free · Premium": "good", "Premium · Pro": "brand" } as const;

export default function ApiOverview() {
  return (
    <DocPage href="/docs/api" title="API reference" lede="A JSON API over HTTPS. Every response is sourced and timed, and anything that goes on the record carries an id you can prove.">
      <H2>Base URL</H2>
      <P><C>{API}</C></P>
      <P>No key is needed to start. Paths in this reference are shown as <C>/v1/…</C>; append them to the base URL without the <C>/v1</C>.</P>
      <Request method="GET" path="/state/cardano?sections=market" title="Your first request" />

      <H2>Requests and responses</H2>
      <ul className="my-3 list-disc space-y-1.5 pl-5">
        <li>Send JSON bodies with <C>content-type: application/json</C>. Bodies are limited to 16 KB.</li>
        <li>Tokens can be given as a CoinGecko id (<C>cardano</C>), a symbol (<C>LINK</C>) or a contract address.</li>
        <li>Every response is <C>{"{ object, id, as_of, data, sources }"}</C>. See <Link href="/docs/concepts">Core concepts</Link>.</li>
        <li>CORS is open, so browsers can call the API directly.</li>
      </ul>

      <H2>Endpoints</H2>
      {GROUPS.map(([g, d]) => (
        <div key={g} className="mt-6">
          <p className="text-[15px] font-semibold text-bone">{g} <span className="font-normal text-mist">· {d}</span></p>
          <Table
            head={["Endpoint", "What it answers", "Tier"]}
            rows={ENDPOINT_DOCS.filter((e) => e.group === g).map((e) => [
              <Link key="l" href={`/docs/api/${e.slug}`} className="font-medium">{e.title}</Link>,
              <span key="d">{e.lede}<br /><span className="numerals text-[12px] text-mist">{e.operations.map((o) => `${o.method} ${o.path}`).join(" · ")}</span></span>,
              <Badge key="t" tone={TIER_TONE[e.tier]}>{e.tier}</Badge>,
            ])}
          />
        </div>
      ))}

      <H2>Machine-readable</H2>
      <Table
        head={["Resource", "Use"]}
        rows={[
          [<a key="o" href="/openapi.json">/openapi.json</a>, "OpenAPI 3.1 for code generators and agent frameworks."],
          [<a key="l" href="/llms.txt">/llms.txt</a>, "A short guide for language models."],
          [<Link key="m" href="/docs/mcp">/mcp</Link>, "The same capabilities as MCP tools."],
        ]}
      />
      <Callout kind="note" title="Payments">
        <p>Discover and Trust calls are free. Data calls have a daily free allowance; Premium and Pro calls are paid per call with x402 on Cardano preprod. Design partners use an API key. See <Link href="/docs/pricing">Pricing & payments</Link>.</p>
      </Callout>
    </DocPage>
  );
}
