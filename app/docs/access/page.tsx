import type { Metadata } from "next";
import Link from "next/link";
import { CodeTabs } from "../_ui/client";
import { API, Badge, C, Callout, DocPage, H2, P, Step, Steps, Table } from "../_ui/kit";

export const metadata: Metadata = { title: "Get access", description: "How agents, companies and people get CoinGraph: pay per call with x402, hire the Coworker on Sokosumi, use a design-partner key, or connect over MCP." };

const MCP_URL = API.replace("/api/v1", "/mcp");

export default function Access() {
  return (
    <DocPage href="/docs/access" title="Get access" lede="No sign-up. Pick the path that fits you: an agent pays per call from its own wallet, a company hires the Coworker on Sokosumi, a design partner uses a key, and anyone can read for free.">
      <Table
        head={["You are", "Path", "You pay", "Setup time"]}
        rows={[
          ["An AI agent or a bot", <Link key="1" href="#agent">Pay per call with x402</Link>, "tADA per call, from your wallet", "5 minutes"],
          ["A company or team", <Link key="2" href="#sokosumi">Hire the Coworker on Sokosumi</Link>, "1 test USDM per Task, from workspace credits", "10 minutes"],
          ["A builder integrating CoinGraph", <Link key="3" href="#partner">Design-partner key</Link>, "By contract, no per-call payment", "One email"],
          ["A person with Claude or Cursor", <Link key="4" href="#mcp">Connect over MCP</Link>, "Free during the preview", "2 minutes"],
          ["Anyone", <Link key="5" href="/docs/api">Free endpoints</Link>, "Free: token list, standard check, briefs, record, proofs", "None"],
        ]}
      />

      <H2 id="agent">1. Agents: pay per call with x402</H2>
      <P>Your agent needs a Cardano preprod wallet with a little tADA. Nothing else: no account, no key.</P>
      <Steps>
        <Step title="Get a wallet and test ADA">
          <P>Any Cardano wallet works. For a headless agent, generate a mnemonic and fund its address at the <a href="https://docs.cardano.org/cardano-testnets/tools/faucet" target="_blank" rel="noreferrer">preprod faucet</a> (network: Preprod). 50 tADA covers ten Premium runs or five Pro runs.</P>
        </Step>
        <Step title="Install the x402 client">
          <CodeTabs samples={[{ label: "Terminal", code: "npm install @x402/fetch@2.26.0 @x402/cardano@2.26.0 @x402/core@2.26.0" }]} />
        </Step>
        <Step title="Call any paid endpoint">
          <P>The client handles 402 → pay → retry for you; set a spending cap per payment. Full code on <Link href="/docs/pricing#pay-from-code">Pricing & payments</Link>, or run the repository&apos;s buyer:</P>
          <CodeTabs samples={[{ label: "Terminal", code: `npx tsx scripts/x402-buyer.ts ${API.replace("/api/v1", "")} trade-gatekeeper '{"token":"chainlink","size_usd":5000}'` }]} />
        </Step>
      </Steps>
      <P>Prices: Data calls 2 tADA after 25 free a day, Premium 5 tADA, Pro 10 tADA. Every answer comes with a receipt (the Cardano transaction id) and a proof link.</P>

      <H2 id="sokosumi">2. Companies: hire the Coworker on Sokosumi</H2>
      <Steps>
        <Step title="Sign in to Sokosumi"><P><a href="https://preprod.sokosumi.com" target="_blank" rel="noreferrer">preprod.sokosumi.com</a>, then buy test credits (Stripe test mode on preprod, no real charge: card 4242 4242 4242 4242).</P></Step>
        <Step title="Create a Task for CoinGraph Crypto Analyst"><P>Write the request in plain words: “Check LINK before I buy $5K”, “Is this address safe to send to?”, “Due diligence on Cardano”.</P></Step>
        <Step title="Read the result on the Task"><P>About a minute later. Payment sits in Masumi escrow until the result is delivered; the result hash is on chain.</P></Step>
      </Steps>
      <P>Details and on-chain evidence: <Link href="/docs/sokosumi">Hire on Sokosumi</Link>.</P>

      <H2 id="partner">3. Builders: design-partner key</H2>
      <P>If you are integrating CoinGraph into an agent, a wallet, a treasury tool or a product, we issue a key so your calls skip per-call payment. Send it on every request:</P>
      <CodeTabs samples={[{ label: "cURL", code: `curl -X POST "${API}/agents/wallet-guard" \\\n  -H "Authorization: Bearer cg_your_key" \\\n  -H "content-type: application/json" \\\n  -d '{"token":"chainlink","amount_usd":5000,"to_address":"0x28c6c06298d514db089934071355e5743bf21d60","chain":"eth"}'` }]} />
      <P>Request one: <a href="mailto:ajay@coingraph.ai?subject=CoinGraph%20design%20partner%20key">ajay@coingraph.ai</a>. Say what you are building and roughly how many calls a day. Hackathon judges have a key in the submission.</P>
      <Callout kind="note">Self-service accounts (create a key, see usage, buy prepaid packs) are on the roadmap; today keys are issued by hand.</Callout>

      <H2 id="mcp">4. People: connect over MCP</H2>
      <P>Add <C>{MCP_URL}</C> as a custom connector in Claude, or in Claude Code:</P>
      <CodeTabs samples={[{ label: "Terminal", code: `claude mcp add --transport http coingraph ${MCP_URL}` }]} />
      <P>Then ask in plain words. MCP calls are free during the preview. Full guide: <Link href="/docs/mcp">Connect</Link>.</P>

      <H2>What you get, whichever path</H2>
      <div className="my-4 flex flex-wrap gap-2"><Badge tone="good">Sourced and timed</Badge><Badge tone="good">Proof id on every answer</Badge><Badge tone="good">Graded in public</Badge><Badge tone="mist">Never advice; you decide</Badge></div>
      <P>The same engine answers all four paths, so a verdict seen in Claude, bought with x402 or delivered on Sokosumi can be verified at the same <Link href="/docs/proofs">proof</Link> link.</P>
    </DocPage>
  );
}
