import type { Metadata } from "next";
import Link from "next/link";
import { CodeTabs } from "../_ui/client";
import { Badge, C, Callout, DocPage, H2, P, Step, Steps, Table, highlightJson } from "../_ui/kit";

export const metadata: Metadata = { title: "Pricing & payments", description: "CoinGraph tiers, x402 pay-per-call on Cardano, and design-partner API keys." };

const PAYMENT_REQUIRED = JSON.stringify({ x402Version: 2, error: "payment_required", accepts: [{ scheme: "exact", network: "cardano:preprod", asset: "lovelace", amount: "5000000", payTo: "addr_test1…", resource: "https://token2049.coingraph.ai/api/v1/agents/trade-gatekeeper", description: "Trade Gatekeeper run" }] }, null, 2);

export default function Pricing() {
  return (
    <DocPage href="/docs/pricing" lede="Agents pay per call with x402 on Cardano, with no account and no key. Apps use an API key on a contract. The free tier stays free.">
      <Callout kind="tip" title="Free during the hackathon preview">
        <p>Every endpoint and agent is free to use right now. Payments switch on for the paid tiers with x402 on the Cardano preprod testnet; the prices below are what will apply.</p>
      </Callout>

      <H2>Tiers</H2>
      <Table
        head={["Tier", "Testnet", "Mainnet", "Includes"]}
        rows={[
          [<Badge key="f" tone="good">Free</Badge>, "0", "$0", "Token list and search, status, the standard check (GET evaluate), the latest brief (GET explain), track record and proofs."],
          [<Badge key="d" tone="mist">Data</Badge>, "2 tADA", "$0.01", "Token state, history and market overview. The first 25 calls each day are free."],
          [<Badge key="p" tone="brand">Premium</Badge>, "5 tADA", "$0.05", "Checks sized to your order and rules, fresh investigations, questions, address lookups, monitors, and six agents."],
          [<Badge key="r" tone="brand">Pro</Badge>, "10 tADA", "$0.25", "Due Diligence Analyst, Opportunity Scout, Portfolio Checkup and Treasury Steward: agents that check many tokens or rules in one run."],
        ]}
      />
      <P>Mainnet prices sit at market rates: $0.01 matches common per-call data pricing, and a Pro run costs less than the five to twenty calls it replaces.</P>

      <H2>How x402 works</H2>
      <P>x402 uses the HTTP status <C>402 Payment Required</C>. An agent needs only a Cardano wallet:</P>
      <Steps>
        <Step title="Call the endpoint"><P>Without payment, a paid endpoint answers 402 with what to pay, in what asset, and to which address.</P></Step>
        <Step title="Pay"><P>The agent signs a Cardano payment for the exact amount. Client libraries such as <C>@x402/fetch</C> with <C>@x402/cardano</C> do this automatically within a spending cap you set.</P></Step>
        <Step title="Retry with proof of payment"><P>The agent repeats the request with the <C>X-Payment</C> header. CoinGraph verifies it through a facilitator and returns the answer.</P></Step>
      </Steps>
      <CodeTabs title="402 response (illustrative)" samples={[{ label: "JSON", code: PAYMENT_REQUIRED, node: highlightJson(PAYMENT_REQUIRED) }]} />
      <Callout kind="note">On Cardano every payment output must carry a minimum amount of ADA, which is why testnet prices start at 2 tADA. On mainnet, small calls are bought as prepaid packs.</Callout>

      <H2>Masumi</H2>
      <P>Trade Gatekeeper, Wallet Guard and Due Diligence Analyst are listed on Masumi, the agent network on Cardano. Other agents can discover and hire them there, with payment held in escrow until the result is delivered.</P>

      <H2>Design partners</H2>
      <P>Teams building agents, wallets or treasuries can use an API key instead of paying per call: send it as <C>Authorization: Bearer cg_…</C>. Keys also let assistants such as Claude use paid tools. Write to <a href="mailto:ajay@coingraph.ai?subject=CoinGraph%20design%20partner">ajay@coingraph.ai</a>.</P>
      <P>Current prices and the payment address are always published at <Link href="/docs/api/status">/v1/status</Link>.</P>
    </DocPage>
  );
}
